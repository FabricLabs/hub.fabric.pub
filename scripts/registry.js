'use strict';

const Registry = require('../contracts/registry');

async function main () {
  const registry = new Registry();
  await registry.start();
  return {
    registry: registry.id
  };
}

main().catch((exception) => {
  console.error('[SCRIPTS:REGISTRY]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:REGISTRY]', 'Main Process Output:', output);
});
