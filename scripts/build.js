'use strict';

require('@babel/register');

const React = require('react');
const ReactDOM = require('react-dom');
const ReactDOMServer = require('react-dom/server');
const webpack = require('webpack');

// Settings
const settings = require('../settings/local');

// Fabric HTTP Types
// const Compiler = require('@fabric/http/types/compiler');

const Compiler = require('../types/compiler');
const webpackConfig = require('../webpack.config');

// Components
const HubInterface = require('../components/HubInterface');

// Program Body
async function main (input = {}) {
  const site = new HubInterface(input);
  const compiler = new Compiler({
    document: site,
    webpack: webpackConfig,
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
