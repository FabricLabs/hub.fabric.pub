'use strict';

const path = require('path');
const {
  resolveFabricHttpRoots,
  runBuildSemantic,
  syncSemanticAssetsFromRoot
} = require('../functions/fabricHttpSemantic');

function main () {
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
}

try {
  main();
} catch (err) {
  // eslint-disable-next-line no-console
  console.error('[hub] build-semantic-assets failed:', err && err.message ? err.message : err);
  process.exit(1);
}
