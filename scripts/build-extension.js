#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const ext = path.join(root, 'extension');
const vendor = path.join(ext, 'vendor');
const extThemes = path.join(ext, 'themes');

function ensureDir (d) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function fabricHttpAssetsDir () {
  const entry = require.resolve('@fabric/http');
  return path.join(path.resolve(path.dirname(entry), '..'), 'assets');
}

ensureDir(vendor);

const httpAssets = fabricHttpAssetsDir();

function resolveFabricHttpSemantic (fileName) {
  const fromHub = path.join(root, 'assets', fileName);
  if (fs.existsSync(fromHub)) return fromHub;
  const atRoot = path.join(httpAssets, fileName);
  if (fs.existsSync(atRoot)) return atRoot;
  const legacyDir = fileName.endsWith('.css') ? 'styles' : 'scripts';
  return path.join(httpAssets, legacyDir, fileName);
}

const copies = [
  [resolveFabricHttpSemantic('semantic.min.css'), path.join(vendor, 'semantic.min.css')],
  [resolveFabricHttpSemantic('semantic.min.js'), path.join(vendor, 'semantic.min.js')],
  [path.join(httpAssets, 'scripts', 'jquery-3.4.1.js'), path.join(vendor, 'jquery-3.4.1.js')],
  [path.join(root, 'extension', 'scripts', 'content.js'), path.join(ext, 'content.js')],
  [path.join(root, 'extension', 'scripts', 'page-bridge.js'), path.join(ext, 'page-bridge.js')]
];

for (const [from, to] of copies) {
  if (!fs.existsSync(from)) {
    console.error('[build-extension] Missing source file:', from);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
}

const srcThemes = path.join(httpAssets, 'themes');
if (!fs.existsSync(srcThemes)) {
  console.error('[build-extension] Missing @fabric/http themes (run npm run build:semantic there):', srcThemes);
  process.exit(1);
}
fs.rmSync(extThemes, { recursive: true, force: true });
fs.cpSync(srcThemes, extThemes, { recursive: true });

execSync(`${path.join(root, 'node_modules', '.bin', 'webpack')} --config webpack.extension.config.js`, {
  cwd: root,
  stdio: 'inherit'
});

console.log('[build-extension] Done. Load the unpacked extension from', ext);
