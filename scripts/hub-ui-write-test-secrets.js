#!/usr/bin/env node
'use strict';

/**
 * Writes local/hub-ui-test-secrets.json (gitignored) with a Fabric browser identity
 * derived from a BIP39 mnemonic, for manual or scripted Hub UI testing.
 *
 * Usage:
 *   node scripts/hub-ui-write-test-secrets.js
 *   node scripts/hub-ui-write-test-secrets.js "your twelve or twenty four words here"
 *   FABRIC_UI_TEST_MNEMONIC="..." FABRIC_HUB_ADMIN_TOKEN="..." node scripts/hub-ui-write-test-secrets.js
 *
 * Options:
 *   --print-inject   After writing, print a DevTools snippet to apply identity on the hub origin.
 *
 * File mode 0o600 on POSIX. Never commit local/hub-ui-test-secrets.json.
 */

const fs = require('fs');
const path = require('path');
const bip39 = require('bip39');
const Identity = require('@fabric/core/types/identity');

const root = path.join(__dirname, '..');
const localDir = path.join(root, 'local');
const outPath = path.join(localDir, 'hub-ui-test-secrets.json');

function main () {
  const printInject = process.argv.includes('--print-inject');
  const argMnemonic = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0];
  const fromEnv = process.env.FABRIC_UI_TEST_MNEMONIC || process.env.FABRIC_MNEMONIC;
  const phraseRaw = (fromEnv || argMnemonic || '').trim();
  const phrase = phraseRaw || bip39.generateMnemonic(256);
  const generatedNew = !phraseRaw;

  let ident;
  try {
    ident = new Identity({ seed: phrase });
  } catch (e) {
    console.error('Identity derivation failed:', e && e.message ? e.message : e);
    process.exit(1);
  }

  const fabricIdentityLocal = {
    id: String(ident.id),
    xpub: ident.key.xpub,
    xprv: ident.key.xprv,
    passwordProtected: false
  };

  const adminToken = String(process.env.FABRIC_HUB_ADMIN_TOKEN || '').trim();

  const payload = {
    generatedAt: new Date().toISOString(),
    mnemonic: phrase,
    mnemonicGenerated: generatedNew,
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
  console.log('Identity id (prefix):', String(fabricIdentityLocal.id).slice(0, 18) + '…');

  if (printInject) {
    const o = JSON.stringify(fabricIdentityLocal);
    console.log('\n--- Paste in DevTools on your Hub tab (same origin), then Enter ---\n');
    console.log(`(function(){var o=${o};localStorage.setItem('fabric.identity.local',JSON.stringify(o));try{sessionStorage.setItem('fabric.identity.unlocked',JSON.stringify(o));}catch(e){}${adminToken ? `localStorage.setItem('fabric.hub.adminToken',${JSON.stringify(adminToken)});` : ''}location.reload();})();`);
    console.log('\n--- end snippet ---\n');
  }
}

main();
