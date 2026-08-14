'use strict';

/**
 * Copy local/fabric-operator-identity.json into sibling apps for shared local
 * automation. Prefer exporting FABRIC_XPRV (or FABRIC_SEED) in each process
 * environment so Hub and applications share one operator key.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_PRIMARY = path.join(ROOT, 'local', 'fabric-operator-identity.json');
const SRC_LEGACY = path.join(ROOT, 'local', 'cursor-agent-fabric-identity.json');
const TARGETS = [
  path.resolve(ROOT, '..', 'star-citizen-live', 'local', 'fabric-operator-identity.json')
];

const SRC = fs.existsSync(SRC_PRIMARY) ? SRC_PRIMARY : SRC_LEGACY;

if (!fs.existsSync(SRC)) {
  console.error('[operator-identity] Missing', SRC_PRIMARY, '— run npm run operator-identity:init');
  console.error('[operator-identity] Or set FABRIC_XPRV / FABRIC_SEED in the environment (preferred).');
  process.exit(1);
}

for (const dest of TARGETS) {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(SRC, dest);
  fs.chmodSync(dest, 0o600);
  console.log('[operator-identity] Copied identity to', dest);
}
