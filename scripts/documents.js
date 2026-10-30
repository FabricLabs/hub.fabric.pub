#!/usr/bin/env node
'use strict';

/**
 * Sell and buy documents between Hubs from the command line (inventory HTLC).
 *
 *   node scripts/documents.js publish  --file <path> | --text <string> [--name n] [--mime m] --price <sats> --instance seller
 *   node scripts/documents.js publish  --id <documentId> --price <sats> --instance owner     (re-list a bought copy)
 *   node scripts/documents.js list     --instance <name>
 *   node scripts/documents.js refresh  --instance buyer [--wait 10]   (ask connected peers for their listings)
 *   node scripts/documents.js offers   [documentId] --instance buyer
 *   node scripts/documents.js buy      <documentId> --from <seller instance|origin> --instance buyer [--via <relay>] [--max <sats>] [--lock <blocks>] [--pay-only] [--wait 120]
 *   node scripts/documents.js open     <documentId> --instance buyer [--preimage <hex>] [--out <path>]
 *   node scripts/documents.js purchases --instance buyer
 *   node scripts/documents.js refund   <settlementId> --instance buyer [--to <address>] [--fee <sats>]
 *   node scripts/documents.js settlement <settlementId> --instance seller
 *   node scripts/documents.js confirm  <settlementId> --txid <txid> --instance seller   (check the payment and deliver)
 *   node scripts/documents.js claim    <settlementId> --instance seller [--to <address>] [--fee <sats>]
 *
 * `buy` asks the seller for its inventory with this Hub's refund key, has this
 * Hub check the quote (refundable to it, at the listed price, `--max`, time left
 * before the lock) and pay it, asks the seller to confirm (the seller then sends
 * the sealed file and the key), and opens it here. `--via` routes the request
 * through a connected relay Hub; `--lock` asks for a refund lock that many blocks
 * out; `--pay-only` stops after paying. A purchase never delivered can be
 * refunded after the lock; the seller must `claim` before it. `--amount <sats>`
 * pays that much without the checks (rehearsing a seller refusing a short payment).
 * Target a Hub with `--hub <origin> --token-file <path>` or `--instance <name>
 * [--network regtest]` from the deploy profile. Add `--json` for raw output.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('./lib/localNetwork');

const COMMANDS = ['publish', 'list', 'refresh', 'offers', 'buy', 'open', 'purchases', 'refund', 'settlement', 'confirm', 'claim', 'help'];

function parseArgs (argv) {
  const out = { command: 'help', positional: [], network: 'regtest', json: false, payOnly: false };
  const takes = new Set(['--hub', '--token-file', '--instance', '--network', '--root', '--file', '--text', '--name', '--mime', '--price', '--id', '--from', '--via', '--txid', '--wait', '--max', '--lock', '--amount', '--preimage', '--out', '--to', '--fee']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--pay-only') out.payOnly = true;
    else if (a === '--help' || a === '-h') out.command = 'help';
    else if (takes.has(a)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      out[a.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase())] = value;
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option ${a}`);
    } else if (out.positional.length === 0 && out.command === 'help' && COMMANDS.includes(a)) {
      out.command = a;
    } else {
      out.positional.push(a);
    }
  }
  return out;
}

function profileInstance (args, name) {
  const root = net.networkRoot(args.network, args.root);
  const profile = net.readJson(path.join(root, 'network-profile.json'));
  if (!profile) throw new Error(`no network profile under ${root}; run npm run deploy first`);
  const inst = (profile.instances || []).find((x) => x.name === name);
  if (!inst) throw new Error(`no instance ${name} (have ${(profile.instances || []).map((x) => x.name).join(', ')})`);
  return inst;
}

/** This Hub (admin token required). */
function target (args) {
  if (args.instance) {
    const inst = profileInstance(args, args.instance);
    return { hub: inst.http, token: fs.readFileSync(inst.adminTokenFile, 'utf8').trim() };
  }
  if (!args.hub) throw new Error('pass --hub <origin> or --instance <name>');
  let token = process.env.FABRIC_HUB_ADMIN_TOKEN || '';
  if (args.tokenFile) token = fs.readFileSync(args.tokenFile, 'utf8').trim();
  if (!token) throw new Error('pass --token-file <path> or set FABRIC_HUB_ADMIN_TOKEN');
  return { hub: String(args.hub).replace(/\/+$/, ''), token };
}

/** Another Hub, spoken to without a token. */
function remote (args, spec) {
  if (/^https?:\/\//.test(spec)) return { hub: String(spec).replace(/\/+$/, ''), token: null };
  return { hub: profileInstance(args, spec).http, token: null };
}

async function rpc (t, method, params = {}, positional = null) {
  const auth = t.token ? { adminToken: t.token } : {};
  const res = await fetch(`${t.hub}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: positional || [{ ...auth, ...params }] }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  const result = body.result;
  if (!result || result.status === 'error') {
    const err = new Error((result && result.message) || `${method} failed (HTTP ${res.status})`);
    err.result = result;
    throw err;
  }
  return result;
}

async function sendPayment (t, to, amountSats, memo) {
  const res = await fetch(`${t.hub}/services/bitcoin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ method: 'sendpayment', to, amountSats, adminToken: t.token, memo }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await res.json().catch(() => ({}));
  const txid = body && body.payment && body.payment.txid ? String(body.payment.txid).trim() : '';
  if (!txid) throw new Error(`payment failed: ${(body && (body.message || body.error)) || `HTTP ${res.status}`}`);
  return txid;
}

function sats (n) {
  return `${Number(n || 0).toLocaleString()} sats`;
}

async function waitFor (seconds, fn) {
  const until = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  for (;;) {
    const found = await fn();
    if (found || Date.now() >= until) return found;
    await net.sleep(2000);
  }
}

async function peerId (args, spec, t) {
  if (/^id1[0-9a-z]+$/.test(spec) || /^0[23][0-9a-fA-F]{64}$/.test(spec)) return spec;
  if (t && /^https?:\/\//.test(spec)) {
    // A public Hub's Peer key need not be the key it reports over HTTP; use the id this Hub is connected to.
    const host = new URL(spec).hostname;
    const listed = await rpc(t, 'ListPeers', {}, []).catch(() => ({}));
    const peers = Array.isArray(listed.peers) ? listed.peers : Object.values(listed.peers || {});
    const match = peers.find((p) => p && p.status === 'connected' && /^id1/.test(p.id || '') &&
      String(p.address || '').split(':')[0] === host);
    if (match) return match.id;
  }
  const s = await rpc(remote(args, spec), 'GetNetworkStatus', {}, []);
  const id = s.fabricIdentityId || s.fabricPeerId;
  if (!id) throw new Error(`${spec} reports no Fabric identity`);
  return id;
}

async function buy (args, t) {
  const documentId = args.positional[0];
  if (!documentId || !args.from) throw new Error('buy <documentId> --from <seller instance|origin>');
  const log = (line) => { if (!args.json) console.log(line); };
  const wait = args.wait != null ? Number(args.wait) : 120;
  const seller = remote(args, args.from);

  const mine = await rpc(t, 'GetNetworkStatus', {}, []);
  if (!mine.fabricPeerId) throw new Error('this Hub reports no Fabric key for the refund path');
  const sellerStatus = await rpc(seller, 'GetNetworkStatus', {}, []);
  if (!sellerStatus.fabricIdentityId) throw new Error('the seller Hub does not report fabricIdentityId (update it)');
  const via = args.via ? await peerId(args, args.via, t) : null;

  const askedAt = Date.now();
  await rpc(t, 'RequestPeerInventory', {}, [via || sellerStatus.fabricIdentityId, 'documents', {
    buyerRefundPublicKey: mine.fabricPeerId,
    ...(via ? { inventoryTarget: sellerStatus.fabricIdentityId } : {}),
    ...(args.lock != null ? { htlcLocktimeBlocks: Number(args.lock) } : {})
  }]);
  log(`asked ${args.from}${via ? ` via ${args.via}` : ''} for its inventory`);

  const offer = await waitFor(wait, async () => {
    const r = await rpc(t, 'ListDocumentOffers', { documentId });
    return (r.offers || []).find((o) => o.htlc && o.htlc.settlementId && Date.parse(o.receivedAt) >= askedAt - 1000) || null;
  });
  if (!offer) throw new Error(`no HTLC offer for ${documentId} within ${wait}s (published and priced on the seller?)`);
  const h = offer.htlc;
  log(`offer  ${offer.name}  ${sats(h.amountSats)} → ${h.paymentAddress}  refund lock ${h.refundLockHeight}`);

  let txid;
  if (args.amount != null) {
    txid = await sendPayment(t, h.paymentAddress, Math.round(Number(args.amount)), `document ${documentId.slice(0, 16)}`);
    log(`paid   ${txid}  (${sats(args.amount)}, unchecked)`);
  } else {
    const paid = await rpc(t, 'PayInventoryHtlc', {
      settlementId: h.settlementId,
      ...(args.max != null ? { maxSats: Number(args.max) } : {})
    });
    txid = paid.purchase.fundedTxid;
    log(`paid   ${txid}  (quote checked)`);
  }
  if (args.payOnly) {
    const result = { documentId, paidSats: Number(args.amount != null ? args.amount : h.amountSats), txid, settlementId: h.settlementId, refundLockHeight: h.refundLockHeight };
    if (args.json) return console.log(JSON.stringify(result, null, 2));
    return log(`not asking the seller to confirm; refund after block ${h.refundLockHeight} with: node scripts/documents.js refund ${h.settlementId}`);
  }

  let confirmed = null;
  let lastError = null;
  await waitFor(wait, async () => {
    try {
      confirmed = await rpc(seller, 'ConfirmInventoryHtlcPayment', { settlementId: h.settlementId, txid });
      return true;
    } catch (err) {
      lastError = err.message;
      return false;
    }
  });
  if (!confirmed) throw new Error(`seller did not confirm: ${lastError}`);
  log('seller confirmed, sending the file and key');

  let opened = null;
  await waitFor(wait, async () => {
    try {
      opened = await rpc(t, 'OpenPurchasedDocument', { id: documentId });
      return true;
    } catch (err) {
      lastError = err.message;
      return false;
    }
  });
  if (!opened) throw new Error(`could not open ${documentId}: ${lastError}`);
  const plain = Buffer.from(opened.document.contentBase64, 'base64');
  const sha256 = crypto.createHash('sha256').update(plain).digest('hex');
  if (args.out) fs.writeFileSync(args.out, plain);
  const result = {
    documentId,
    name: opened.document.name,
    bytes: plain.length,
    sha256,
    matchesId: sha256 === documentId,
    paidSats: Number(h.amountSats),
    txid,
    settlementId: h.settlementId,
    refundLockHeight: h.refundLockHeight
  };
  if (args.json) return console.log(JSON.stringify(result, null, 2));
  log(`opened ${result.name}  ${result.bytes} bytes  sha256 ${sha256}${result.matchesId ? '  (matches the id)' : ''}`);
  log(`seller claims with: node scripts/documents.js claim ${h.settlementId} --instance <seller> (before block ${h.refundLockHeight})`);
}

async function main () {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    const lines = fs.readFileSync(__filename, 'utf8').split('\n');
    console.log(lines.slice(4, lines.indexOf(' */')).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    return;
  }
  const t = target(args);
  const out = (value, print) => (args.json ? console.log(JSON.stringify(value, null, 2)) : print(value));

  switch (args.command) {
    case 'publish': {
      if (args.id && args.price != null) {
        const r = await rpc(t, 'PublishDocument', { id: args.id, purchasePriceSats: Number(args.price) });
        const d = r.document || {};
        return out({ id: args.id, name: d.name || null, purchasePriceSats: Number(args.price) },
          (x) => console.log(`published ${x.id}${x.name ? `  ${x.name}` : ''}  ${sats(x.purchasePriceSats)}`));
      }
      if ((!args.file && args.text == null) || args.price == null) throw new Error('publish --file <path> | --text <string> --price <sats>');
      const content = args.file ? fs.readFileSync(args.file) : Buffer.from(String(args.text));
      const created = await rpc(t, 'CreateDocument', {
        name: args.name || (args.file ? path.basename(args.file) : 'note.txt'),
        mime: args.mime || (args.file ? 'application/octet-stream' : 'text/plain'),
        contentBase64: content.toString('base64')
      });
      const id = created.document.id;
      await rpc(t, 'PublishDocument', { id, purchasePriceSats: Number(args.price) });
      return out({ id, name: created.document.name, size: created.document.size, purchasePriceSats: Number(args.price) },
        (d) => console.log(`published ${d.id}  ${d.name}  ${d.size} bytes  ${sats(d.purchasePriceSats)}`));
    }
    case 'list': {
      const r = await rpc(t, 'ListDocuments');
      return out(r.documents, (docs) => {
        if (!docs.length) console.log('no documents');
        for (const d of docs) {
          console.log(`${d.id}  ${d.name}  ${d.size} bytes${d.published ? `  published ${sats(d.purchasePriceSats)}` : ''}${d.local === false ? '  (peer offer)' : ''}`);
        }
      });
    }
    case 'offers': {
      const r = await rpc(t, 'ListDocumentOffers', args.positional[0] ? { documentId: args.positional[0] } : {});
      return out(r.offers, (offers) => {
        if (!offers.length) console.log('no offers');
        for (const o of offers) {
          console.log(`${o.documentId}  ${o.name}  ${sats(o.purchasePriceSats)}  from ${o.peerAlias || o.peerAddress || o.peerPubkey}${o.htlc ? `  htlc ${o.htlc.settlementId}` : ''}`);
        }
      });
    }
    case 'refresh': {
      const r = await rpc(t, 'RefreshDocumentMarket', {}, []);
      if (!r.requested && r.message) throw new Error(r.message);
      await net.sleep(Math.max(0, Number(args.wait != null ? args.wait : 10)) * 1000);
      const listed = await rpc(t, 'ListDocumentOffers');
      return out({ requested: r.requested, offers: listed.offers }, (x) => {
        console.log(`asked ${x.requested} peer(s)`);
        for (const o of x.offers) console.log(`${o.documentId}  ${o.name}  ${sats(o.purchasePriceSats)}  from ${o.peerAlias || o.peerAddress || o.peerPubkey}`);
      });
    }
    case 'buy':
      return buy(args, t);
    case 'purchases': {
      const r = await rpc(t, 'ListInventoryPurchases');
      return out(r.purchases, (list) => {
        if (!list.length) console.log('no purchases');
        for (const p of list) {
          console.log(`${p.settlementId}  ${p.status}  ${p.name || p.documentId}  ${sats(p.amountSats)}  lock ${p.refundLockHeight}${p.refundTxid ? `  refund ${p.refundTxid}` : `  funded ${p.fundedTxid}`}`);
        }
      });
    }
    case 'refund': {
      if (!args.positional[0]) throw new Error('refund <settlementId>');
      const r = await rpc(t, 'RefundInventoryHtlc', {
        settlementId: args.positional[0],
        ...(args.to ? { toAddress: args.to } : {}),
        ...(args.fee != null ? { feeSats: Number(args.fee) } : {})
      });
      return out(r, (x) => console.log(`${x.message || 'refunded'} ${x.refundTxid || (x.purchase && x.purchase.refundTxid) || ''}${x.toAddress ? ` → ${x.toAddress}` : ''}`));
    }
    case 'open': {
      if (!args.positional[0]) throw new Error('open <documentId>');
      const r = await rpc(t, 'OpenPurchasedDocument', { id: args.positional[0], ...(args.preimage ? { preimageHex: args.preimage } : {}) });
      const plain = Buffer.from(r.document.contentBase64, 'base64');
      if (args.out) fs.writeFileSync(args.out, plain);
      const sha256 = crypto.createHash('sha256').update(plain).digest('hex');
      return out({ id: r.document.id, name: r.document.name, bytes: plain.length, sha256 },
        (d) => console.log(`opened ${d.name}  ${d.bytes} bytes  sha256 ${d.sha256}${args.out ? `  → ${args.out}` : ''}`));
    }
    case 'settlement': {
      if (!args.positional[0]) throw new Error('settlement <settlementId>');
      const r = await rpc(t, 'GetInventoryHtlcSellerReveal', { settlementId: args.positional[0] });
      const view = {
        settlementId: r.settlementId,
        documentId: r.documentId,
        status: r.htlcStatus,
        amountSats: r.amountSats,
        paymentAddress: r.paymentAddress,
        refundLockHeight: r.refundLockHeight,
        fundedTxid: r.fundedTxid || null,
        claimTxid: r.claimTxid || null
      };
      return out(view, (s) => console.log(`${s.settlementId}  ${s.status}  ${sats(s.amountSats)} → ${s.paymentAddress}\n  document ${s.documentId}\n  refund lock ${s.refundLockHeight}${s.fundedTxid ? `\n  funded ${s.fundedTxid}` : ''}${s.claimTxid ? `\n  claimed ${s.claimTxid}` : ''}`));
    }
    case 'confirm': {
      if (!args.positional[0] || !args.txid) throw new Error('confirm <settlementId> --txid <txid>');
      const r = await rpc(t, 'ConfirmInventoryHtlcPayment', { settlementId: args.positional[0], txid: args.txid });
      return out(r, (x) => console.log(`${x.message || 'confirmed; sending the file and key'}  ${x.documentId || ''}`));
    }
    case 'claim': {
      if (!args.positional[0]) throw new Error('claim <settlementId>');
      const r = await rpc(t, 'ClaimInventoryHtlcOnChain', {
        settlementId: args.positional[0],
        ...(args.to ? { toAddress: args.to } : {}),
        ...(args.fee != null ? { feeSats: Number(args.fee) } : {})
      });
      return out(r, (x) => console.log(`claimed ${x.claimTxid || x.txid}${x.toAddress ? ` → ${x.toAddress}` : ''}`));
    }
    default:
      throw new Error(`unknown command ${args.command}`);
  }
}

main().catch((err) => {
  console.error(`[DOCUMENTS] ${err && err.message ? err.message : err}`);
  process.exit(1);
});
