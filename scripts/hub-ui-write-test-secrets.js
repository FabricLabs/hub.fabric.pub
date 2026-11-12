#!/usr/bin/env node
'use strict';

/**
 * Writes local/hub-ui-test-secrets.json (gitignored) with a sealed Fabric
 * account vault derived from a BIP39 mnemonic, for manual or scripted Hub UI
 * testing. The vault is what the browser stores under `fabric.identity.local`;
 * unlock it in the UI with the lock password.
 *
 * Usage:
 *   node scripts/hub-ui-write-test-secrets.js
 *   node scripts/hub-ui-write-test-secrets.js "your twelve or twenty four words here"
 *   FABRIC_UI_TEST_MNEMONIC="..." FABRIC_UI_TEST_LOCK_PASSWORD="..." FABRIC_HUB_ADMIN_TOKEN="..." node scripts/hub-ui-write-test-secrets.js
 *
 * Options:
 *   --network=<name>  Account network (default regtest).
 *   --print-inject    After writing, print a DevTools snippet that stores the vault on the hub origin.
 *
 * File mode 0o600 on POSIX. Never commit local/hub-ui-test-secrets.json.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bip39 = require('bip39');
const { masterFromMnemonic, createVault, STORAGE_KEY } = require('../functions/hubAccountVault');

const root = path.join(__dirname, '..');
const localDir = path.join(root, 'local');
const outPath = path.join(localDir, 'hub-ui-test-secrets.json');

function main () {
  const printInject = process.argv.includes('--print-inject');
  const networkArg = process.argv.find((a) => a.startsWith('--network='));
  const network = networkArg ? networkArg.slice('--network='.length) : 'regtest';
  const argMnemonic = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
  const fromEnv = process.env.FABRIC_UI_TEST_MNEMONIC || process.env.FABRIC_MNEMONIC;
  const phraseRaw = (fromEnv || argMnemonic || '').trim();
  const phrase = phraseRaw || bip39.generateMnemonic(256);
  const generatedNew = !phraseRaw;
  const lockPassword = String(process.env.FABRIC_UI_TEST_LOCK_PASSWORD || '').trim() ||
    crypto.randomBytes(12).toString('base64url');

  let created;
  try {
    created = createVault({
      master: masterFromMnemonic(phrase, String(process.env.FABRIC_UI_TEST_PASSPHRASE || '')),
      lockPassword,
      network
    });
  } catch (e) {
    console.error('Identity derivation failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  const fabricIdentityLocal = created.vault;

  const adminToken = String(process.env.FABRIC_HUB_ADMIN_TOKEN || '').trim();

  const payload = {
    generatedAt: new Date().toISOString(),
    mnemonic: phrase,
    mnemonicGenerated: generatedNew,
    lockPassword,
    network,
    identityId: created.identity.id,
    fabricIdentityLocal,
    fabricHubAdminToken: adminToken
  };

  if (!fs.existsSync(localDir)) {
    fs.mkdirSync(localDir, { recursive: true });
  }
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  try {
    fs.chmodSync(outPath, 0o600);
  } catch (_) {}

  console.log('Wrote', outPath);
  if (generatedNew) {
    console.log('Generated new 24-word mnemonic (save a backup if you keep this identity).');
  }
  console.log('Identity id (prefix):', String(created.identity.id).slice(0, 18) + '…');
  console.log('Unlock it in the Hub UI with the lockPassword saved in that file.');

  if (printInject) {
    const o = JSON.stringify(fabricIdentityLocal);
    console.log('\n--- Paste in DevTools on your Hub tab (same origin), then Enter ---\n');
    console.log(`(function(){var o=${o};localStorage.setItem(${JSON.stringify(STORAGE_KEY)},JSON.stringify(o));${adminToken ? `localStorage.setItem('fabric.hub.adminToken',${JSON.stringify(adminToken)});` : ''}location.reload();})();`);
    console.log('\n--- end snippet ---\n');
  }
}

main();
