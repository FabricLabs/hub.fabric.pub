'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');

const ROOT = path.join(__dirname, '..');
const REQUIRE_RE = /require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g;

const BOOT_ENTRIES = [
  'scripts/desktop.js',
  'scripts/hub.js',
  'settings/local.js',
  'services/hub.js'
];

/**
 * electron-builder directory globs (for example contracts/**) include files in
 * that directory and below. Exact globs match a single relative path.
 * @param {string} glob
 * @param {string} relPosix
 * @returns {boolean}
 */
function matchFileSet (glob, relPosix) {
  if (!glob.includes('*') && !glob.includes('?') && !glob.includes('{')) {
    return glob === relPosix;
  }
  if (glob.endsWith('/**/*')) {
    const prefix = glob.slice(0, -'/**/*'.length);
    return relPosix === prefix || relPosix.startsWith(prefix + '/');
  }
  if (glob.startsWith('**/') && glob.endsWith('/**')) {
    const mid = glob.slice(3, -3);
    return relPosix === mid ||
      relPosix.startsWith(mid + '/') ||
      relPosix.includes('/' + mid + '/');
  }
  if (glob.startsWith('**/') && glob.includes('*') && !glob.slice(3).includes('/')) {
    const suffix = glob.slice(3).replace(/^\*/, '');
    return relPosix.endsWith(suffix);
  }
  return glob === relPosix;
}

/**
 * @param {string} relPosix
 * @param {Array<string|object>} files
 * @returns {boolean}
 */
function electronPackIncludes (relPosix, files) {
  let included = false;
  for (const entry of files) {
    if (typeof entry !== 'string') continue;
    if (entry.startsWith('!')) {
      if (matchFileSet(entry.slice(1), relPosix)) included = false;
    } else if (matchFileSet(entry, relPosix)) {
      included = true;
    }
  }
  return included;
}

/**
 * @param {string} fromFile
 * @param {string} spec
 * @returns {string|null}
 */
function resolveRelativeRequire (fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  const tries = [
    base,
    base + '.js',
    base + '.json',
    path.join(base, 'index.js'),
    path.join(base, 'index.json')
  ];
  for (const candidate of tries) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch (_err) {
      /* ignore */
    }
  }
  return null;
}

/**
 * @param {string[]} entryRels
 * @returns {string[]}
 */
function collectLocalBootFiles (entryRels) {
  const seen = new Set();
  const needed = [];
  const queue = entryRels.map((rel) => path.join(ROOT, rel));

  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    const rel = path.relative(ROOT, file);
    if (rel.startsWith('node_modules' + path.sep) || rel.split(path.sep)[0] === 'node_modules') {
      continue;
    }
    needed.push(rel.split(path.sep).join('/'));

    let src = '';
    try {
      src = fs.readFileSync(file, 'utf8');
    } catch (_err) {
      continue;
    }

    REQUIRE_RE.lastIndex = 0;
    let match = REQUIRE_RE.exec(src);
    while (match) {
      const spec = match[1];
      match = REQUIRE_RE.exec(src);
      if (!spec.startsWith('.')) continue;
      const resolved = resolveRelativeRequire(file, spec);
      if (!resolved) continue;
      const resolvedRel = path.relative(ROOT, resolved);
      if (resolvedRel.startsWith('..')) continue;
      if (resolvedRel.split(path.sep)[0] === 'node_modules') continue;
      queue.push(resolved);
    }
  }

  return needed.sort();
}

describe('electron-builder files', function () {
  it('packs Hub contract catalogs and root constants for the desktop asar', function () {
    const files = pkg.build.files;
    assert.ok(files.includes('contracts/**/*'), 'build.files must include contracts/**/*');
    assert.ok(files.includes('constants.js'), 'build.files must include constants.js');
    assert.ok(electronPackIncludes('contracts/beaconFederation.js', files));
    assert.ok(electronPackIncludes('contracts/liquid.js', files));
    assert.ok(electronPackIncludes('contracts/resources/index.js', files));
    assert.ok(electronPackIncludes('constants.js', files));
    assert.ok(electronPackIncludes('settings/local.js', files));
    assert.ok(electronPackIncludes('functions/desktopOpenAtLogin.js', files));
  });

  it('linux.desktop uses electron-builder 26 entry metadata (not flat Name/Comment)', async function () {
    const desktop = pkg.build.linux.desktop;
    assert.ok(desktop.entry, 'linux.desktop.entry is required in electron-builder 26+');
    assert.strictEqual(desktop.entry.Name, 'Fabric Hub');
    assert.strictEqual(desktop.Name, undefined);
    assert.strictEqual(desktop.Comment, undefined);

    const { validateConfiguration } = require('app-builder-lib/out/util/config/config');
    await validateConfiguration(pkg.build, { isEnabled: false, add () {} });
  });

  it('covers relative requires from desktop / hub boot', function () {
    const files = pkg.build.files;
    const needed = collectLocalBootFiles(BOOT_ENTRIES);
    assert.ok(needed.includes('contracts/beaconFederation.js'));
    assert.ok(needed.includes('constants.js'));

    const missing = needed.filter((rel) => !electronPackIncludes(rel, files));
    assert.deepStrictEqual(missing, [], 'asar would omit: ' + missing.join(', '));
  });
});
