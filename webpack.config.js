'use strict';

const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;

module.exports = {
  mode: 'development',
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
    // when bundling ESM packages like @msgpack/msgpack via peerjs
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
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
    // Explicit aliases so fabric's ecc.js (from ../fabric) and any consumers
    // (like elliptic via browserify-sign) can resolve @noble/curves regardless
    // of subpath form used in requires.
    alias: {
      // Use the browser UMD bundle of PeerJS to avoid ESM + msgpack bundling issues
      peerjs: path.resolve(__dirname, 'node_modules/peerjs/dist/peerjs.min.js'),
      // Force @noble/hashes to use browser crypto (avoids node:crypto UnhandledSchemeError)
      '@noble/hashes/crypto': path.resolve(__dirname, 'node_modules/@noble/hashes/esm/crypto.js'),
      // Redirect cryptoNode.js when package exports resolve to it (e.g. from nested @noble/hashes in elliptic)
      '@noble/hashes/esm/cryptoNode.js': path.resolve(__dirname, 'node_modules/@noble/hashes/esm/crypto.js'),
      // Ensure sha2.js subpath is always resolvable for @fabric/core's hash256.js and taggedHash.js,
      // independent of how webpack interprets @noble/hashes exports or conditions.
      '@noble/hashes/sha2.js': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      '@noble/hashes/sha2': path.resolve(__dirname, 'node_modules/@noble/hashes/sha2.js'),
      // node: scheme imports - must resolve to browser polyfills
      'node:crypto': require.resolve('crypto-browserify'),
      // Use browser build of react-dom/server (avoids TextEncoder error from Node build)
      'react-dom/server': path.resolve(__dirname, 'node_modules/react-dom/server.browser.js'),
      // Use ESM build to avoid CJS "exports is not defined" (CJS file uses exports at top level)
      '@noble/curves/secp256k1': path.resolve(__dirname, 'node_modules/@noble/curves/esm/secp256k1.js'),
      '@noble/curves/secp256k1.js': path.resolve(__dirname, 'node_modules/@noble/curves/esm/secp256k1.js'),
      // NIST curves shim for noble-curves v1.x
      '@noble/curves/nist': path.resolve(__dirname, 'shims/noble-nist.js'),
      '@noble/curves/nist.js': path.resolve(__dirname, 'shims/noble-nist.js'),
      // ed25519 curve module
      '@noble/curves/ed25519.js': path.resolve(__dirname, 'node_modules/@noble/curves/ed25519.js'),
      // utils shim used by @soatok/elliptic
      '@noble/curves/utils.js': path.resolve(__dirname, 'shims/noble-utils.js')
    },
    fallback: {
      "crypto": require.resolve("crypto-browserify"),
      "node:crypto": require.resolve("crypto-browserify"),
      "path": require.resolve("path-browserify"),
      "buffer": require.resolve("buffer"),
      // Use stream-browserify for Node.js stream polyfill in the browser
      "stream": require.resolve("stream-browserify"),
      "process": require.resolve("process/browser")
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
    // so WebRTC signaling (/services/peering) and other HTTP APIs
    // hit the real hub server instead of the dev server.
    proxy: {
      '/services/peering': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      },
      '/services': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      },
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        ws: true
      }
    },
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
      'process.env.NODE_ENV': JSON.stringify('production')
    }),
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    }),
    // Force ESM build for secp256k1 regardless of resolution path (avoids CJS "exports is not defined")
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]@noble[\\/]curves[\\/]secp256k1(\.js)?$/,
      path.resolve(__dirname, 'node_modules/@noble/curves/esm/secp256k1.js')
    ),
    new BundleAnalyzerPlugin({
      analyzerMode: process.env.ANALYZE ? 'server' : 'disabled',
      openAnalyzer: true
    })
  ],
  watch: true
};
