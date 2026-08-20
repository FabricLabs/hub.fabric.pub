'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveFabricHttpRoots,
  runBuildSemantic,
  syncSemanticAssetsFromRoot
} = require('../functions/fabricHttpSemantic');

require('../functions/patchLinkedFabricNodePath');

require('@babel/register')({
  // Default extensions include .cjs. Compiling bip174/bitcoinjs-lib .cjs under
  // NODE_ENV=production rewrites `require('./global/globalXpub.cjs')` and the
  // relative file no longer resolves. SSR only needs JSX in this tree.
  extensions: ['.js', '.jsx'],
  ignore: [/node_modules/, /\.cjs$/]
});

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

function syncSemanticAssetsFromFabricHttp () {
  const root = path.join(__dirname, '..');
  const roots = resolveFabricHttpRoots(root);
  const sourceRoot = roots.withAssets || roots.withSources;
  if (!sourceRoot) {
    console.warn('[BUILD:SITE] @fabric/http assets not found, skipping Semantic asset sync.');
    return;
  }
  try {
    if (roots.withSources && !roots.withAssets) {
      runBuildSemantic(roots.withSources);
    }
    syncSemanticAssetsFromRoot(sourceRoot, root);
  } catch (e) {
    console.warn('[BUILD:SITE] Semantic asset sync failed:', e && e.message ? e.message : e);
  }
}

function resolveWebpackMode () {
  // `npm start` / `desktop` / `ci` call this script without NODE_ENV=production.
  // Default minify; `webpack serve --mode development` stays the HMR path.
  return process.env.NODE_ENV === 'development' ? 'development' : 'production';
}

function resolveWebpackConfig () {
  const mode = resolveWebpackMode();
  console.log('[BUILD:SITE] webpack mode=' + mode);
  return typeof webpackConfigModule === 'function'
    ? webpackConfigModule({}, { mode })
    : webpackConfigModule;
}

function runWebpack (config) {
  return new Promise((resolve, reject) => {
    webpack(config).run((err, stats) => {
      if (err) return reject(err);
      if (stats && stats.hasErrors()) {
        const info = stats.toJson({ all: false, errors: true });
        const msg = (info.errors || []).map((e) => e.message || e).join('\n');
        return reject(new Error(msg || stats.toString({ colors: false })));
      }
      if (stats) {
        console.log(stats.toString({ colors: true, chunks: false, modules: false }));
        try {
          fs.writeFileSync(
            '/tmp/hub-webpack-stats.json',
            JSON.stringify(stats.toJson({
              all: false,
              assets: true,
              chunks: true,
              modules: true,
              nestedModules: false,
              source: false
            }))
          );
          console.log('[BUILD:SITE] wrote webpack stats to /tmp/hub-webpack-stats.json');
        } catch (writeErr) {
          console.warn('[BUILD:SITE] could not write webpack stats:', writeErr.message);
        }
      }
      resolve(stats);
    });
  });
}

async function main (input = {}) {
  syncSemanticAssetsFromFabricHttp();
  const buildWebpackConfig = Object.assign({}, resolveWebpackConfig(), { watch: false });
  await runWebpack(buildWebpackConfig);

  // HubInterface pulls bitcoinjs-lib at load (Payjoin / Sidechain). Node 24
  // enforces bip174 package exports, so SSR can fail even when webpack succeeds.
  let site = null;
  try {
    const HubInterface = require('../components/HubInterface');
    site = new HubInterface(input);
    const compiler = new Compiler({
      document: site,
      webpack: buildWebpackConfig,
      ...input
    });
    compiler.compileBundle = async () => ({ fullhash: 'prebuilt' });
    await compiler.compileTo('assets/index.html');
  } catch (ssrErr) {
    console.warn(
      '[BUILD:SITE] SPA bundle is ready; HTML SSR skipped:',
      ssrErr && ssrErr.message ? ssrErr.message : ssrErr
    );
  }

  return {
    site: site && site.id,
    webpack: true
  };
}

main(settings).then((output) => {
  console.log('[BUILD:SITE]', '[OUTPUT]', output);
}).catch((exception) => {
  console.error('[BUILD:SITE]', '[EXCEPTION]', exception);
  if (exception && exception.stack) {
    console.error('[BUILD:SITE]', '[STACK]', exception.stack);
  }
  process.exitCode = 1;
});
