'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SEMANTIC_FILES = [
  'semantic.min.css',
  'semantic.css',
  'semantic.rtl.min.css',
  'semantic.rtl.css',
  'semantic.min.js',
  'semantic.js'
];

const SEMANTIC_DIRS = [
  'themes',
  'scripts'
];

function dedupePaths (items = []) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item) continue;
    const full = path.resolve(item);
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(full);
  }
  return out;
}

function hasFomanticSources (root) {
  return fs.existsSync(path.join(root, 'libraries', 'fomantic', 'gulpfile.js'));
}

function hasSemanticAssets (root) {
  return fs.existsSync(path.join(root, 'assets', 'semantic.min.css'));
}

function resolveCandidates (hubRoot) {
  return dedupePaths([
    path.join(hubRoot, 'node_modules', '@fabric', 'http'),
    process.env.FABRIC_HTTP,
    path.join(hubRoot, '..', 'fabric-http')
  ]).filter((p) => fs.existsSync(p));
}

function resolveFabricHttpRoots (hubRoot) {
  const candidates = resolveCandidates(hubRoot);
  const withSources = candidates.find(hasFomanticSources) || null;
  const withAssets = candidates.find(hasSemanticAssets) || null;
  return {
    candidates,
    withSources,
    withAssets
  };
}

function runBuildSemantic (fabricHttpRoot) {
  const result = spawnSync('npm', ['run', 'build:semantic', '--prefix', fabricHttpRoot], {
    stdio: 'inherit',
    env: process.env
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`build:semantic failed for ${fabricHttpRoot} (exit ${result.status})`);
  }
}

function copyIfExists (fromPath, toPath) {
  if (!fs.existsSync(fromPath)) return;
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.copyFileSync(fromPath, toPath);
}

function syncSemanticAssetsFromRoot (fabricHttpRoot, hubRoot) {
  const sourceAssets = path.join(fabricHttpRoot, 'assets');
  const hubAssets = path.join(hubRoot, 'assets');

  if (!fs.existsSync(sourceAssets)) {
    throw new Error(`@fabric/http assets not found at ${sourceAssets}`);
  }

  for (const rel of SEMANTIC_FILES) {
    copyIfExists(path.join(sourceAssets, rel), path.join(hubAssets, rel));
  }

  for (const relDir of SEMANTIC_DIRS) {
    const srcDir = path.join(sourceAssets, relDir);
    const dstDir = path.join(hubAssets, relDir);
    if (!fs.existsSync(srcDir)) continue;
    fs.rmSync(dstDir, { recursive: true, force: true });
    fs.cpSync(srcDir, dstDir, { recursive: true });
  }
}

module.exports = {
  resolveFabricHttpRoots,
  runBuildSemantic,
  syncSemanticAssetsFromRoot
};
