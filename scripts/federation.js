#!/usr/bin/env node
'use strict';

/**
 * Named federations from the command line (admin JSON-RPC on a Hub).
 *
 *   npm run federation -- list     --hub http://127.0.0.1:30181 --token-file <path>
 *   npm run federation -- accept   [federationId] --instance hub-goon-vc [--wait 60]
 *   npm run federation -- approve  [requestId]    --instance hub-goon-vc [--wait 60]
 *   npm run federation -- create   --name Launch --threshold 2 --member <url|pubkey> --member …
 *   npm run federation -- deposit  <federationId> --amount <sats> [--fee-rate 2]
 *   npm run federation -- withdraw <federationId> --to <address> --amount <sats> [--fee-rate 2 | --fee <sats>]
 *   npm run federation -- show     <federationId>
 *   npm run federation -- decline  <federationId>
 *   npm run federation -- broadcast <federationId> <requestId>
 *   npm run federation -- identity | wallet
 *
 * Target a Hub with `--hub <origin> --token-file <path>` (or `FABRIC_HUB_ADMIN_TOKEN`),
 * or with `--instance <name> [--network regtest]` from the deploy script's
 * `network-profile.json`. `accept` / `approve` without an id act on the only
 * pending item and fail when there are several. Add `--json` for raw output.
 */

const fs = require('fs');
const path = require('path');
const net = require('./lib/localNetwork');

const COMMANDS = ['list', 'show', 'identity', 'wallet', 'create', 'accept', 'decline', 'deposit', 'withdraw', 'approve', 'broadcast', 'help'];

function parseArgs (argv) {
  const out = { command: 'help', positional: [], members: [], network: 'regtest', json: false };
  const takes = new Set(['--hub', '--token-file', '--instance', '--network', '--name', '--threshold', '--member', '--amount', '--fee-rate', '--fee', '--to', '--federation', '--wait', '--root', '--csv-blocks']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.command = 'help';
    else if (takes.has(a)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${a} needs a value`);
      const key = a.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      if (key === 'member') out.members.push(value);
      else out[key] = value;
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

function target (args) {
  if (args.instance) {
    const root = net.networkRoot(args.network, args.root);
    const profile = net.readJson(path.join(root, 'network-profile.json'));
    if (!profile) throw new Error(`no network profile under ${root}; run npm run deploy first`);
    const inst = (profile.instances || []).find((x) => x.name === args.instance);
    if (!inst) throw new Error(`no instance ${args.instance} (have ${(profile.instances || []).map((x) => x.name).join(', ')})`);
    return { hub: inst.http, token: fs.readFileSync(inst.adminTokenFile, 'utf8').trim() };
  }
  if (!args.hub) throw new Error('pass --hub <origin> or --instance <name>');
  let token = process.env.FABRIC_HUB_ADMIN_TOKEN || '';
  if (args.tokenFile) token = fs.readFileSync(args.tokenFile, 'utf8').trim();
  if (!token) throw new Error('pass --token-file <path> or set FABRIC_HUB_ADMIN_TOKEN');
  return { hub: String(args.hub).replace(/\/+$/, ''), token };
}

async function rpc (t, method, params = {}) {
  const res = await fetch(`${t.hub}/services/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [{ adminToken: t.token, ...params }] }),
    signal: AbortSignal.timeout(60000)
  });
  const body = await res.json().catch(() => ({}));
  if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
  const result = body.result;
  if (!result || result.status === 'error') throw new Error((result && result.message) || `${method} failed (HTTP ${res.status})`);
  return result;
}

function sats (n) {
  return `${Number(n || 0).toLocaleString()} sats`;
}

function printFederation (f) {
  console.log(`${f.name}  [${f.status}]  ${f.threshold}-of-${f.validators.length}`);
  console.log(`  id     ${f.id}`);
  console.log(`  vault  ${f.vaultAddress}${f.balanceSats != null ? `  (${sats(f.balanceSats)})` : ''}`);
  for (const m of f.members) {
    console.log(`  ${m.self ? '*' : ' '} ${m.status.padEnd(8)} ${m.pubkey}${m.alias || m.url ? `  ${m.alias || m.url}` : ''}`);
  }
  for (const w of f.withdrawals || []) {
    console.log(`  withdrawal ${w.requestId.slice(0, 16)}…  ${w.status}  ${sats(w.amountSats)} → ${w.destinationAddress}  ${w.signers.length}/${f.threshold}${w.txid ? `  tx ${w.txid}` : ''}${w.error ? `  (${w.error})` : ''}`);
  }
}

async function waitFor (seconds, fn) {
  const until = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
  for (;;) {
    const found = await fn();
    if (found || Date.now() >= until) return found;
    await net.sleep(2000);
  }
}

async function pickPending (t, args, kind) {
  const pickOne = async () => {
    const r = await rpc(t, 'ListNamedFederations');
    let items = kind === 'invite' ? r.pending.invites : r.pending.withdrawals;
    const id = args.positional[0];
    if (id) {
      items = items.filter((x) => (kind === 'invite' ? x.id : x.requestId).startsWith(id));
    }
    if (args.federation) items = items.filter((x) => (kind === 'invite' ? x.id : x.federation.id).startsWith(args.federation));
    return items.length ? items : null;
  };
  const items = await waitFor(args.wait, pickOne);
  if (!items) throw new Error(`no pending ${kind}${args.positional[0] ? ` matching ${args.positional[0]}` : ''}`);
  if (items.length > 1) {
    const ids = items.map((x) => (kind === 'invite' ? `${x.id}  ${x.name}` : `${x.requestId}  ${x.federation.name}`));
    throw new Error(`several pending; pass an id:\n  ${ids.join('\n  ')}`);
  }
  return items[0];
}

async function resolveMember (t, spec) {
  if (/^0[23][0-9a-fA-F]{64}$/.test(spec)) return { pubkey: spec.toLowerCase() };
  const r = await rpc(t, 'ResolveHubIdentity', { url: spec });
  return { pubkey: r.pubkey, url: r.url, alias: r.alias };
}

async function main () {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(4, 21).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    return;
  }
  const t = target(args);
  const out = (value, print) => (args.json ? console.log(JSON.stringify(value, null, 2)) : print(value));

  switch (args.command) {
    case 'identity': {
      const r = await rpc(t, 'GetHubIdentity');
      return out(r, (x) => console.log(`${x.pubkey}  (${x.network})`));
    }
    case 'wallet': {
      const r = await rpc(t, 'GetHubWallet');
      return out(r.wallet, (w) => console.log(`${w.address}\n  available ${sats(w.trustedSats)}  unconfirmed ${sats(w.pendingSats)}  immature ${sats(w.immatureSats)}`));
    }
    case 'list': {
      const r = await rpc(t, 'ListNamedFederations');
      return out(r, (x) => {
        console.log(`this Hub: ${x.self}  (${x.network})`);
        if (!x.federations.length) console.log('no federations');
        for (const f of x.federations) printFederation(f);
        console.log(`pending: ${x.pending.invites.length} invite(s), ${x.pending.withdrawals.length} withdrawal(s) to approve`);
      });
    }
    case 'show': {
      if (!args.positional[0]) throw new Error('show <federationId>');
      const r = await rpc(t, 'GetNamedFederation', { federationId: args.positional[0] });
      return out(r.federation, printFederation);
    }
    case 'create': {
      if (!args.members.length) throw new Error('create needs at least one --member <url|pubkey>');
      const members = [];
      for (const m of args.members) members.push(await resolveMember(t, m));
      const r = await rpc(t, 'CreateNamedFederation', {
        name: args.name,
        threshold: Number(args.threshold || 2),
        csvBlocks: args.csvBlocks != null ? Number(args.csvBlocks) : undefined,
        members
      });
      return out(r.federation, printFederation);
    }
    case 'accept': {
      const invite = await pickPending(t, args, 'invite');
      const r = await rpc(t, 'AcceptFederationInvite', { federationId: invite.id });
      return out(r.federation, printFederation);
    }
    case 'decline': {
      const invite = await pickPending(t, args, 'invite');
      const r = await rpc(t, 'DeclineFederationInvite', { federationId: invite.id });
      return out(r.federation, printFederation);
    }
    case 'deposit': {
      if (!args.positional[0] || !args.amount) throw new Error('deposit <federationId> --amount <sats>');
      const r = await rpc(t, 'DepositToFederation', {
        federationId: args.positional[0],
        amountSats: Number(args.amount),
        feeRateSatVb: args.feeRate != null ? Number(args.feeRate) : undefined
      });
      return out(r.deposit, (d) => console.log(`deposit ${d.txid}  ${sats(d.amountSats)} → ${d.vaultAddress}`));
    }
    case 'withdraw': {
      if (!args.positional[0] || !args.to || !args.amount) throw new Error('withdraw <federationId> --to <address> --amount <sats>');
      const r = await rpc(t, 'CreateFederationWithdrawal', {
        federationId: args.positional[0],
        destinationAddress: args.to,
        amountSats: Number(args.amount),
        feeSats: args.fee != null ? Number(args.fee) : undefined,
        feeRateSatVb: args.feeRate != null ? Number(args.feeRate) : undefined
      });
      return out(r.withdrawal, (w) => console.log(`withdrawal ${w.requestId}  ${w.status}  ${w.signers.length} signature(s)`));
    }
    case 'approve': {
      const w = await pickPending(t, args, 'withdrawal');
      if (!args.json) console.log(`approving ${sats(w.amountSats)} → ${w.destinationAddress} (fee ${sats(w.feeSats)}) from ${w.federation.name}`);
      const r = await rpc(t, 'ApproveFederationWithdrawal', { federationId: w.federation.id, requestId: w.requestId });
      return out(r.withdrawal, (x) => console.log(`withdrawal ${x.requestId}  ${x.status}${x.txid ? `  tx ${x.txid}` : ''}`));
    }
    case 'broadcast': {
      const [federationId, requestId] = args.positional;
      if (!federationId || !requestId) throw new Error('broadcast <federationId> <requestId>');
      const r = await rpc(t, 'BroadcastFederationWithdrawal', { federationId, requestId });
      return out(r.withdrawal, (x) => console.log(`withdrawal ${x.requestId}  ${x.status}${x.txid ? `  tx ${x.txid}` : ''}`));
    }
    default:
      throw new Error(`unknown command ${args.command}`);
  }
}

main().catch((err) => {
  console.error(`[FEDERATION] ${err && err.message ? err.message : err}`);
  process.exit(1);
});
