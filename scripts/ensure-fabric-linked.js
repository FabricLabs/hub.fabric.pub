'use strict';

/**
 * Preflight for `npm run desktop` / hub startup: deep imports must resolve.
 * Distributed execution helpers are vendored under `functions/fabricDistributedExecution*.js`
 * so plain `npm install` works when git tarballs omit `@fabric/core` / `@fabric/http` files.
 * Optional: `npm run link:fabric` for full local monorepo development.
 */

const path = require('path');

const root = path.join(__dirname, '..');
const paths = [
  path.join(root, 'functions', 'fabricDistributedExecution.js'),
  path.join(root, 'functions', 'fabricDistributedExecutionHttp.js'),
  '@fabric/core/types/key'
];

let ok = true;
for (const p of paths) {
  try {
    require.resolve(p);
  } catch (e) {
    ok = false;
    console.error(`[hub] Cannot resolve "${p}" (${e && e.code ? e.code : 'MODULE_NOT_FOUND'}).`);
  }
}

if (!ok) {
  console.error('');
  console.error('[hub] Run `npm install` from the hub repo root. For local Fabric development:');
  console.error('  npm run link:fabric');
  console.error('');
  console.error('  Defaults: FABRIC_CORE=~/fabric-clean  FABRIC_HTTP=~/fabric-http');
  console.error('  Override: FABRIC_CORE=/path FABRIC_HTTP=/path npm run link:fabric');
  process.exit(1);
}
