'use strict';

const fs = require('fs');
const path = require('path');
const webpack = require('webpack');

/** When @fabric/* is npm-linked, transitive deps live under the clone; webpack must see them too. */
function linkedFabricResolvePaths () {
  const hubs = path.join(__dirname, 'node_modules');
  const out = [];
  for (const pkg of ['@fabric/core', '@fabric/http']) {
    let p = path.join(hubs, pkg);
    try {
      p = fs.realpathSync(p);
    } catch (_) {
      continue;
    }
    const nested = path.join(p, 'node_modules');
    if (fs.existsSync(nested)) out.push(nested);
  }
  return out;
}
const TerserPlugin = require('terser-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = (env, argv) => {
  const mode = argv.mode || 'development';
  const hubProxyOrigin = process.env.FABRIC_HUB_DEV_PROXY
    || `http://127.0.0.1:${process.env.FABRIC_HUB_PORT || 8080}`;
  return {
  mode,
  devtool: 'eval-source-map',
  entry: './scripts/browser.js',
  // Sequential processing to avoid intermittent race conditions (concatenateModules
  // is already disabled for similar reasons with @msgpack/msgpack). Trades build speed for reliability.
  parallelism: 1,
  output: {
    path: path.resolve(__dirname, 'assets/bundles'),
    filename: 'browser.min.js',
    publicPath: '/bundles/'
  },
  cache: false,
  experiments: {
    asyncWebAssembly: true
  },
  optimization: {
    // Disable module concatenation to avoid intermittent "Cannot read properties of undefined (reading 'module')"
    // when bundling ESM packages like @msgpack/msgpack
    concatenateModules: false,
    minimize: true,
    minimizer: [
      new TerserPlugin({ parallel: false })
    ]
  },
  module: {
    rules: [
      {
        test: /\.wasm$/,
        type: 'webassembly/async'
      },
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env', '@babel/preset-react']
          }
        }
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      }
    ]
  },
  resolve: {
    extensions: ['.js', '.jsx'],
    // Prefer CJS over ESM when resolving package exports (avoids secp256k1 "exports is not defined")
    // 'browser' before 'node' so @noble/hashes uses crypto.js not cryptoNode.js (avoids node:crypto error)
    // Include 'browser' so react-dom/server resolves to server.browser.js (avoids TextEncoder error)
    // Omit 'node' so @noble/hashes/crypto resolves to browser crypto.js not cryptoNode.js
    conditionNames: ['require', 'browser', 'import'],
    // Allow imports without extensions (fixes process/browser in @msgpack/msgpack ESM)
    fullySpecified: false,
    // Prefer hub's node_modules so linked @fabric/core uses the same copies of
    // readable-stream, hash-base, md5.js, etc. Avoids "call is not a function"
    // from duplicate or mis-resolved modules when npm linking.
    modules: [path.resolve(__dirname, 'node_modules'), ...linkedFabricResolvePaths(), 'node_modules'],
    // Match @fabric/core: Hub pins @noble/hashes@2 (see package.json). bitcoinjs-lib, bip32, and
    // bs58check still require @noble/hashes/* entrypoints that existed in noble-hashes@1 only;
    // map those names to the v2 modules (no duplicate noble versions).
    alias: {
      '@noble/hashes/sha256': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/sha512': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/hmac': path.resolve(__dirname, 'node_modules/@noble/hashes/hmac.js'),
      '@noble/hashes/ripemd160': path.resolve(__dirname, 'node_modules/@noble/hashes/legacy.js'),
      '@noble/hashes/sha1': path.resolve(__dirname, 'node_modules/@noble/hashes/legacy.js'),
      'node:crypto': require.resolve('crypto-browserify'),
      'react-dom/server': path.resolve(__dirname, 'node_modules/react-dom/server.browser.js')
    },
    fallback: {
      // @fabric/core/functions/fabricNativeAccel lazy-requires fs only on Node; stub in browser bundle
      "fs": false,
      "crypto": require.resolve("crypto-browserify"),
      "node:crypto": require.resolve("crypto-browserify"),
      "path": require.resolve("path-browserify"),
      "buffer": require.resolve("buffer"),
      // Use stream-browserify for Node.js stream polyfill in the browser
      "stream": require.resolve("stream-browserify"),
      "process": require.resolve("process/browser"),
      // asn1.js (via parse-asn1 / crypto-browserify) expects Node's vm in some paths
      "vm": require.resolve("vm-browserify")
    }
  },
  devServer: {
    historyApiFallback: true,
    hot: true,
    port: 3000,
    static: [
      {
        directory: path.join(__dirname, 'assets'),
        publicPath: '/',
        watch: true
      }
    ],
    // Proxy backend services when running via webpack-dev-server
    // so WebSocket / JSON-RPC and other HTTP APIs hit the real hub.
    proxy: [
      { context: ['/services'], target: hubProxyOrigin, changeOrigin: true, ws: true },
      { context: ['/api'], target: hubProxyOrigin, changeOrigin: true, ws: true },
      { context: ['/settings'], target: hubProxyOrigin, changeOrigin: true }
    ],
    // Watch source directories for changes to rebuild
    watchFiles: [
      'components/**/*.js',
      'services/**/*.js',
      'reducers/**/*.js',
      'actions/**/*.js',
      'functions/**/*.js',
      'types/**/*.js',
      'settings/**/*.js'
    ],
    // Explicitly adding liveReload for better compatibility
    liveReload: true,
    // Compress output for faster loading
    compress: true,
    client: {
      overlay: true,
      progress: true,
      logging: 'info'
    }
  },
  // Optimization for rebuild speed during development
  watchOptions: {
    aggregateTimeout: 300,
    poll: 1000,
    ignored: /node_modules/
  },
  plugins: [
    new webpack.DefinePlugin({
      // Must match `mode` or webpack reports conflicting process.env.NODE_ENV
      'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development')
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    }),
    // Stub optional fabric.node (dynamic require). Matches npm package and file:../fabric-clean symlink layout.
    new webpack.NormalModuleReplacementPlugin(
      /[\\/](@fabric[\\/]core|fabric-clean)[\\/]functions[\\/]fabricNativeAccel\.js$/,
      path.resolve(__dirname, 'shims/fabricNativeAccel.browser.js')
    ),
    // ecc.js optional self-test module is missing from some @fabric/core publishes; keep browser bundle working.
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]types[\\/]ecc\.selftest(\.js)?$/,
      path.resolve(__dirname, 'shims/ecc-selftest-browser.js')
    ),
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE ? 'server' : 'disabled',
      openAnalyzer: true
    })
  ],
  // devServer handles watching; avoid watch:true with `webpack serve` (webpack-cli warning).
  watch: false
  };
};
