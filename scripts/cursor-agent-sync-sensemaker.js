'use strict';

/**
 * Copy local/cursor-agent-fabric-identity.json into Sensemaker (sibling repo) for FABRIC_MNEMONIC workflows.
 * Target: ../sensemaker/local/cursor-agent-fabric-identity.json (gitignored there).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'local', 'cursor-agent-fabric-identity.json');
const SM = path.resolve(ROOT, '..', 'sensemaker', 'local', 'cursor-agent-fabric-identity.json');

if (!fs.existsSync(SRC)) {
  console.error('[cursor-agent] Missing', SRC, '— run npm run cursor-agent:init');
  process.exit(1);
}
const dir = path.dirname(SM);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(SRC, SM);
fs.chmodSync(SM, 0o600);
console.log('[cursor-agent] Copied identity to', SM);
