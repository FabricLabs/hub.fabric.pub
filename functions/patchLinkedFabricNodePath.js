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
 * Some `@fabric/core` tarballs ship a stub `functions/fabricDocumentOfferEnvelope.js` (missing
 * `normalizeFabricDocumentOfferEnvelopeForHandlers`) while `types/peer.js` still requires it.
 * The hub carries the full module — symlink over core when missing or incomplete so Peer loads.
 * Full `@fabric/core` checkouts (e.g. npm link to fabric-clean) already export normalize — leave those.
 */
function ensureCoreFabricDocumentOfferEnvelopeSymlink () {
  try {
    const coreFnDir = path.join(nm, '@fabric', 'core', 'functions');
    const hubEnvelope = path.join(hubRoot, 'functions', 'fabricDocumentOfferEnvelope.js');
    const coreEnvelope = path.join(coreFnDir, 'fabricDocumentOfferEnvelope.js');
    if (!fs.existsSync(hubEnvelope) || !fs.existsSync(coreFnDir)) return;

    const hubReal = fs.realpathSync(hubEnvelope);
    let alreadyHub = false;
    try {
      if (fs.existsSync(coreEnvelope)) {
        alreadyHub = fs.realpathSync(coreEnvelope) === hubReal;
      }
    } catch (_) {}
    if (alreadyHub) return;

    let needsOverlay = false;
    if (!fs.existsSync(coreEnvelope)) {
      needsOverlay = true;
    } else {
      try {
        const resolved = require.resolve(coreEnvelope);
        delete require.cache[resolved];
        const m = require(coreEnvelope);
        needsOverlay = typeof m.normalizeFabricDocumentOfferEnvelopeForHandlers !== 'function';
      } catch (_) {
        needsOverlay = true;
      }
    }

    if (!needsOverlay) return;

    const rel = path.relative(coreFnDir, hubEnvelope);
    if (fs.existsSync(coreEnvelope)) fs.unlinkSync(coreEnvelope);
    fs.symlinkSync(rel, coreEnvelope, 'file');
    try {
      delete require.cache[require.resolve(coreEnvelope)];
    } catch (_) {}
  } catch (_) {}
}
ensureCoreFabricDocumentOfferEnvelopeSymlink();

/**
 * Some `@fabric/http` npm tarballs omit `functions/fabricDocumentPayment402.js` while
 * `functions/sendPaymentRequired402Response.js` still requires it. Overlay from hub when missing.
 */
function ensureHttpFabricDocumentPayment402Symlink () {
  try {
    const httpFnDir = path.join(nm, '@fabric', 'http', 'functions');
    const hubPay = path.join(hubRoot, 'functions', 'fabricDocumentPayment402.js');
    const httpPay = path.join(httpFnDir, 'fabricDocumentPayment402.js');
    if (!fs.existsSync(hubPay) || !fs.existsSync(httpFnDir)) return;
    if (fs.existsSync(httpPay)) return;

    const rel = path.relative(httpFnDir, hubPay);
    fs.symlinkSync(rel, httpPay, 'file');
  } catch (_) {}
}
ensureHttpFabricDocumentPayment402Symlink();

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
