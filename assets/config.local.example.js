'use strict';

// Copy to `assets/config.local.js` (created automatically from this example when missing),
// or run: npm run cursor-agent:emit-hub-config (after npm run cursor-agent:init).
//
// Optional: mirror the hub mnemonic so this browser unlocks without the encryption password.
// Prefer hub FABRIC_SEED when set; FABRIC_MNEMONIC is the usual env name. Sharing node keys with the
// browser is discouraged outside isolated regtest (see Identity → Import mnemonic).
// Loaded before the app bundle (types/spa.js). Alternative: FABRIC_DEV_PUSH_BROWSER_IDENTITY=1 on the
// hub embeds the phrase into HTML (never on a shared host).
// window.FABRIC_DEV_BROWSER_SEED = 'word1 word2 …';
// window.FABRIC_DEV_BROWSER_PASSPHRASE = ''; // optional BIP39 extension phrase if the wallet used one
// window.FABRIC_DEV_BROWSER_IDENTITY = 'force'; // replace existing fabric.identity.local

window.FABRIC_EDGE_AUTHORITY = 'http://localhost:8080';
