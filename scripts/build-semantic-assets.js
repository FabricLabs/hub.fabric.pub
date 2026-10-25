'use strict';

const fs = require('fs');
const path = require('path');
const {
  resolveFabricHttpRoots,
  runBuildSemantic,
  syncSemanticAssetsFromRoot
} = require('../functions/fabricHttpSemantic');

async function main () {
  const hubRoot = path.join(__dirname, '..');
  const roots = resolveFabricHttpRoots(hubRoot);
  const sourceRoot = roots.withSources || roots.withAssets;

  if (!sourceRoot) {
    throw new Error(
      'Could not find @fabric/http with semantic assets. Checked: node_modules/@fabric/http, FABRIC_HTTP, ../fabric-http'
    );
  }

  if (roots.withSources) {
    // Full source checkout (linked or sibling clone): rebuild deterministically first.
    runBuildSemantic(roots.withSources);
  } else {
    // Packaged dependency: rely on shipped assets.
    // eslint-disable-next-line no-console
    console.log(`[hub] Using shipped @fabric/http semantic assets from ${sourceRoot}`);
  }

  syncSemanticAssetsFromRoot(sourceRoot, hubRoot);
  // eslint-disable-next-line no-console
  console.log(`[hub] Synced semantic assets from ${sourceRoot} → ${path.join(hubRoot, 'assets')}`);

  // The CSS draws flags and emoji from these SVGs; @fabric/http doesn't ship them in git installs.
  const twemoji = path.join(sourceRoot, 'functions', 'twemoji.js');
  if (!fs.existsSync(twemoji)) throw new Error(`@fabric/http at ${sourceRoot} has no functions/twemoji.js`);
  const destination = path.join(hubRoot, 'assets', 'themes', 'fabric', 'assets', 'twemoji');
  const result = await require(twemoji).importTwemoji(destination);
  // eslint-disable-next-line no-console
  console.log(`[hub] Twemoji ${result.tag}: ${result.count} SVGs ${result.skipped ? 'already in' : 'imported into'} ${destination}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[hub] build-semantic-assets failed:', err && err.message ? err.message : err);
  process.exit(1);
});
