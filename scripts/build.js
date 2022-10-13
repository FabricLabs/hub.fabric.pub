'use strict';

// Settings
const settings = require('../settings/local');

// Types
const Site = require('@fabric/http/types/site');
const Compiler = require('@fabric/http/types/compiler');

// Program Body
async function main (input = {}) {
  const site = new Site(input);
  const compiler = new Compiler({
    document: site
  });

  await compiler.compileTo('assets/hub.html');

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
