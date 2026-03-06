'use strict';

const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: 'production',
  devtool: 'eval-source-map',
  entry: './scripts/browser.js',
  output: {
    path: path.resolve(__dirname, 'assets/bundles'),
    filename: 'browser.min.js',
    publicPath: '/bundles/'
  },
  experiments: {
    asyncWebAssembly: true
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
    // Prefer hub's node_modules so linked @fabric/core uses the same copies of
    // readable-stream, hash-base, md5.js, etc. Avoids "call is not a function"
    // from duplicate or mis-resolved modules when npm linking.
    modules: [path.resolve(__dirname, 'node_modules'), 'node_modules'],
    // Explicit aliases so fabric's ecc.js (from ../fabric) and any consumers
    // (like elliptic via browserify-sign) can resolve @noble/curves regardless
    // of subpath form used in requires.
    alias: {
      '@noble/curves/secp256k1': path.resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js'),
      '@noble/curves/secp256k1.js': path.resolve(__dirname, 'node_modules/@noble/curves/secp256k1.js'),
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
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    })
  ],
  watch: true
};
