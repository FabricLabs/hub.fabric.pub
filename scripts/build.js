'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveFabricHttpRoots,
  syncSemanticAssetsFromRoot
} = require('../functions/fabricHttpSemantic');

require('../functions/patchLinkedFabricNodePath');

require('@babel/register');

(function ensureConfigLocalJs () {
  const target = path.join(__dirname, '..', 'assets', 'config.local.js');
  const example = path.join(__dirname, '..', 'assets', 'config.local.example.js');
  try {
    if (!fs.existsSync(target) && fs.existsSync(example)) {
      fs.copyFileSync(example, target);
    }
  } catch (e) {
    console.warn('[BUILD:SITE] Could not seed assets/config.local.js from example:', e && e.message ? e.message : e);
  }
})();

const React = require('react');
const ReactDOM = require('react-dom');
const ReactDOMServer = require('react-dom/server');
const webpack = require('webpack');

// Settings
const settings = require('../settings/local');

// Fabric HTTP Types
// const Compiler = require('@fabric/http/types/compiler');

const Compiler = require('../types/compiler');
const webpackConfigModule = require('../webpack.config');

// Components
const HubInterface = require('../components/HubInterface');

function syncSemanticAssetsFromFabricHttp () {
  const root = path.join(__dirname, '..');
  const roots = resolveFabricHttpRoots(root);
  const sourceRoot = roots.withAssets || roots.withSources;
  if (!sourceRoot) {
    console.warn('[BUILD:SITE] @fabric/http assets not found, skipping Semantic asset sync.');
    return;
  }
  syncSemanticAssetsFromRoot(sourceRoot, root);
}

function resolveWebpackConfig () {
  return typeof webpackConfigModule === 'function'
    ? webpackConfigModule({}, { mode: 'development' })
    : webpackConfigModule;
}

// Program Body
async function main (input = {}) {
  syncSemanticAssetsFromFabricHttp();
  const site = new HubInterface(input);
  const buildWebpackConfig = Object.assign({}, resolveWebpackConfig(), { watch: false });
  const compiler = new Compiler({
    document: site,
    webpack: buildWebpackConfig,
    ...input
  });

  await compiler.compileTo('assets/index.html');

  return {
    site: site.id
  };
}

// Run Program
main(settings).catch((exception) => {
  console.error('[BUILD:SITE]', '[EXCEPTION]', exception);
  if (exception && exception.stack) {
    console.error('[BUILD:SITE]', '[STACK]', exception.stack);
  }
}).then((output) => {
  console.log('[BUILD:SITE]', '[OUTPUT]', output);
});
