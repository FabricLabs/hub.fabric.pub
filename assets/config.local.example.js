'use strict';

// Copy to `assets/config.local.js` (created automatically from this example when missing).
//
// Operator identity for the Hub *node* is FABRIC_XPRV (preferred) or FABRIC_SEED /
// FABRIC_MNEMONIC in the process environment — any Fabric suite app should use the same.
//
// Optional browser unlock for local/regtest only (mirrors node key into the SPA):
// Loaded before the app bundle (types/spa.js). Alternative: FABRIC_DEV_PUSH_BROWSER_IDENTITY=1
// embeds the phrase into HTML (never on a shared host).
//
// Desktop auto-faucet (`npm run desktop`) is regtest/local only — funds the unlocked
// local key once from the Hub Beacon faucet. Set FABRIC_DESKTOP_AUTO_FAUCET = false to skip.
// window.FABRIC_DEV_BROWSER_SEED = 'word1 word2 …';
// window.FABRIC_DEV_BROWSER_PASSPHRASE = ''; // optional BIP39 extension phrase if the wallet used one
// window.FABRIC_DEV_BROWSER_IDENTITY = 'force'; // replace existing fabric.identity.local
// window.FABRIC_DESKTOP_AUTO_FAUCET = true; // default on in Electron; set false to skip

window.FABRIC_EDGE_AUTHORITY = 'http://localhost:8080';

// Optional seed Hubs for HTML-only / CDN builds (comma-separated env: FABRIC_HUB_SEEDS).
// Used for HTTP OPTIONS feature detection, WebRTC signaling, Fabric peering probes,
// and document inventories. HTTPS pages cannot reach http:// seeds (mixed content).
// window.FABRIC_HUB_SEEDS = ['https://hub.fabric.pub'];
