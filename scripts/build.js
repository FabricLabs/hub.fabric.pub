'use strict';

// Settings
const settings = require('../settings/local');

// Types
const Compiler = require('@fabric/http/types/compiler');

// Components
const Interface = require('../components/interface');

// Program Body
async function main (input = {}) {
  const site = new Interface(input);
  const compiler = new Compiler({
    document: site
  });

  await compiler.compileTo('assets/index.html');

  return {
    site: site.id
  };
}

// Run Program
main(settings).catch((exception) => {
  console.error('[BUILD:HUB]', '[EXCEPTION]', exception);
}).then((output) => {
  console.log('[BUILD:HUB]', '[OUTPUT]', output);
});
