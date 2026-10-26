#!/usr/bin/env node
'use strict';

/**
 * Passport v2 cutover, step 0: list every vault whose keys change, with its
 * balance, before the new builds deploy.
 *
 * Reads the federations this Hub knows from its store (`named-federations/`:
 * federations it is a member of, plus descriptors from mailbox invites such as
 * goon.vc Market orders) and asks the running Hub for each vault's confirmed
 * balance (`GET /services/federations/:id/vault`), then the Beacon vault
 * (`GET /services/distributed/vault/utxos`).
 *
 *   node scripts/passport-cutover-vaults.js [--hub http://127.0.0.1:8080] [--store stores/hub] [--json] [--all]
 *
 * `--all` also lists empty vaults. Exits 1 while any vault still holds coins
 * or can't be read, so the runbook can gate step 1 on it.
 */

const fs = require('fs');
const path = require('path');

function parseArgs (argv) {
  const out = { hub: process.env.FABRIC_HUB_ORIGIN || 'http://127.0.0.1:8080', store: null, json: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hub') out.hub = argv[++i];
    else if (a === '--store') out.store = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--all') out.all = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  out.hub = String(out.hub || '').replace(/\/+$/, '');
  if (!out.store) out.store = path.resolve(process.env.FABRIC_HUB_USER_DATA || process.cwd(), 'stores/hub');
  return out;
}

function readJson (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Every federation descriptor in a Hub store, keyed by federation id.
 * @param {string} store Hub store root (contains `named-federations/`)
 * @returns {Map<string, { id: string, descriptor: object, source: string }>}
 */
function knownFederations (store) {
  const dir = path.join(store, 'named-federations');
  const found = new Map();
  const index = readJson(path.join(dir, 'index.json'));
  for (const id of (index && Array.isArray(index.ids)) ? index.ids : []) {
    const record = readJson(path.join(dir, `${id}.json`));
    if (record && record.descriptor) found.set(id, { id, descriptor: record.descriptor, source: 'member' });
  }
  const mailbox = readJson(path.join(dir, 'mailbox.json'));
  for (const [id, descriptor] of Object.entries((mailbox && mailbox.descriptors) || {})) {
    if (!found.has(id) && descriptor) found.set(id, { id, descriptor, source: 'invite' });
  }
  return found;
}

function kindOf (descriptor) {
  const name = String((descriptor && descriptor.name) || '');
  if (/market order/i.test(name)) return 'Market order';
  if (name) return name;
  return 'Federation';
}

async function getJson (url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `HTTP ${res.status}`);
  return body;
}

async function collect (opts) {
  const rows = [];
  for (const { id, descriptor, source } of knownFederations(opts.store).values()) {
    const row = {
      kind: kindOf(descriptor),
      id,
      source,
      network: descriptor.network || null,
      signers: `${descriptor.threshold || '?'}-of-${Array.isArray(descriptor.validators) ? descriptor.validators.length : '?'}`,
      address: null,
      balanceSats: null,
      utxos: null,
      error: null
    };
    try {
      const vault = await getJson(`${opts.hub}/services/federations/${id}/vault`);
      row.address = vault.address;
      row.balanceSats = Number(vault.balanceSats) || 0;
      row.utxos = Array.isArray(vault.utxos) ? vault.utxos.length : 0;
    } catch (err) {
      row.error = err.message;
    }
    rows.push(row);
  }
  const beacon = { kind: 'Beacon vault', id: null, source: 'hub', network: null, signers: null, address: null, balanceSats: null, utxos: null, error: null };
  try {
    const vault = await getJson(`${opts.hub}/services/distributed/vault/utxos`);
    beacon.address = vault.address || null;
    beacon.network = vault.network || null;
    beacon.balanceSats = Number(vault.totalSats) || 0;
    beacon.utxos = Array.isArray(vault.utxos) ? vault.utxos.length : 0;
    if (!vault.address) beacon.error = vault.message || 'no vault address';
  } catch (err) {
    beacon.error = err.message;
  }
  rows.push(beacon);
  return rows;
}

function table (rows) {
  const lines = [
    '| Vault | Federation | Signers | Network | Address | Balance (sats) | Coins |',
    '|---|---|---|---|---|---:|---:|'
  ];
  for (const r of rows) {
    const balance = r.error ? `error: ${r.error}` : String(r.balanceSats);
    lines.push(`| ${r.kind} | ${r.id ? r.id.slice(0, 12) : '—'} | ${r.signers || '—'} | ${r.network || '—'} | ${r.address || '—'} | ${balance} | ${r.utxos == null ? '—' : r.utxos} |`);
  }
  return lines.join('\n');
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log('Usage: node scripts/passport-cutover-vaults.js [--hub <origin>] [--store <dir>] [--json] [--all]');
    return 0;
  }
  const rows = await collect(opts);
  const shown = opts.all ? rows : rows.filter((r) => r.error || r.balanceSats > 0);
  const funded = rows.filter((r) => r.balanceSats > 0);
  const totalSats = funded.reduce((sum, r) => sum + r.balanceSats, 0);
  if (opts.json) {
    console.log(JSON.stringify({ hub: opts.hub, store: opts.store, totalSats, vaults: shown }, null, 2));
  } else {
    console.log(`Hub ${opts.hub}, store ${opts.store}: ${rows.length} vault(s) known, ${funded.length} funded, ${totalSats} sats in total.\n`);
    console.log(shown.length ? table(shown) : 'Every vault is empty.');
  }
  return (funded.length || rows.some((r) => r.error)) ? 1 : 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code), (err) => {
    console.error(`[CUTOVER] ${err.message}`);
    process.exit(2);
  });
}

module.exports = { knownFederations, kindOf, table };
