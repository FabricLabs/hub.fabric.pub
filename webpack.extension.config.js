'use strict';

const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');

// MV3 popup bundle: same resolution rules as the main Hub browser build, different entry/output.
const baseFactory = require('./webpack.config.js');
const base = typeof baseFactory === 'function'
  ? baseFactory({}, { mode: 'production' })
  : baseFactory;

module.exports = {
  ...base,
  mode: 'production',
  devtool: false,
  entry: './extension/scripts/popup.js',
  watch: false,
  output: {
    path: path.resolve(__dirname, 'extension'),
    filename: 'popup.bundle.js',
    publicPath: ''
  },
  optimization: {
    ...base.optimization,
    minimizer: [
      new TerserPlugin({ parallel: false })
    ]
  },
  performance: {
    hints: false
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process/browser'
    }),
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]@noble[\\/]curves[\\/]secp256k1(\.js)?$/,
      path.resolve(__dirname, 'node_modules/@noble/curves/esm/secp256k1.js')
    )
  ]
};
