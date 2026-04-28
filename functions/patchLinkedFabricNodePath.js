'use strict';

/**
 * When @fabric/core (and optionally @fabric/http) are `npm link`ed, their
 * dependencies live under the clone's node_modules, not the hub's. Prepend those
 * paths to NODE_PATH so build.js / hub.js can require() hub components that pull
 * in bip32, level, etc. before webpack runs.
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const hubRoot = path.resolve(__dirname, '..');
const nm = path.join(hubRoot, 'node_modules');

/**
 * Some `@fabric/core` tarballs omit `functions/fabricDocumentOfferEnvelope.js` while `types/peer.js`
 * still `require`s it. The hub repo carries the canonical implementation — link it in so the hub
 * and tests can boot without a custom `npm link` checkout of core.
 */
function ensureCoreFabricDocumentOfferEnvelopeSymlink () {
  try {
    const coreFnDir = path.join(nm, '@fabric', 'core', 'functions');
    const hubEnvelope = path.join(hubRoot, 'functions', 'fabricDocumentOfferEnvelope.js');
    const coreEnvelope = path.join(coreFnDir, 'fabricDocumentOfferEnvelope.js');
    if (!fs.existsSync(hubEnvelope) || !fs.existsSync(coreFnDir)) return;
    if (fs.existsSync(coreEnvelope)) return;
    const rel = path.relative(coreFnDir, hubEnvelope);
    fs.symlinkSync(rel, coreEnvelope, 'file');
  } catch (_) {}
}
ensureCoreFabricDocumentOfferEnvelopeSymlink();

function realPackageRoot (pkg) {
  const p = path.join(nm, pkg);
  try {
    if (!fs.existsSync(p)) return null;
    return fs.realpathSync(p);
  } catch (_) {
    return null;
  }
}

const roots = [];
const LINKED_FABRIC_PKGS = new Set(['@fabric/core', '@fabric/http']);
for (const pkg of LINKED_FABRIC_PKGS) {
  const root = realPackageRoot(pkg);
  if (!root) continue;
  const sub = path.join(root, 'node_modules');
  if (fs.existsSync(sub)) roots.push(sub);
}

if (roots.length) {
  const extra = roots.join(path.delimiter);
  process.env.NODE_PATH = process.env.NODE_PATH
    ? extra + path.delimiter + process.env.NODE_PATH
    : extra;
  Module._initPaths();
}
