'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const strings = require('../locales/en');

function walk (node, prefix, visit) {
  for (const [key, value] of Object.entries(node)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) walk(value, at, visit);
    else visit(at, value);
  }
}

describe('locales/en', function () {
  it('every module under locales/en is exported from index.js', function () {
    const dir = path.join(__dirname, '..', 'locales', 'en');
    const index = fs.readFileSync(path.join(dir, 'index.js'), 'utf8');
    for (const file of fs.readdirSync(dir)) {
      if (file === 'index.js' || !file.endsWith('.js')) continue;
      assert.ok(index.includes(`'./${file.replace(/\.js$/, '')}'`), `${file} is not required from index.js`);
    }
  });

  it('repeats no key within one object (a later section object would replace a label)', function () {
    const { parse } = require('@babel/parser');
    const dir = path.join(__dirname, '..', 'locales', 'en');
    const duplicates = [];
    const visit = (node, file) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'ObjectExpression') {
        const seen = {};
        for (const p of node.properties) {
          if (p.type !== 'ObjectProperty' || p.computed) continue;
          const key = p.key.name || p.key.value;
          if (seen[key]) duplicates.push(`${file}: '${key}' on lines ${seen[key]} and ${p.loc.start.line}`);
          else seen[key] = p.loc.start.line;
        }
      }
      for (const [name, value] of Object.entries(node)) {
        if (name === 'loc') continue;
        if (Array.isArray(value)) value.forEach((child) => visit(child, file));
        else if (value && typeof value.type === 'string') visit(value, file);
      }
    };
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.js')) continue;
      visit(parse(fs.readFileSync(path.join(dir, file), 'utf8')).program, file);
    }
    assert.deepStrictEqual(duplicates, []);
  });

  it('holds only non-empty strings, string arrays, and functions', function () {
    walk(strings, '', (at, value) => {
      if (typeof value === 'function') return;
      const list = Array.isArray(value) ? value : [value];
      assert.ok(list.length > 0, `${at} is an empty list`);
      for (const item of list) {
        assert.strictEqual(typeof item, 'string', `${at} must be a string, string array, or function`);
        assert.ok(item.trim().length > 0, `${at} is empty`);
      }
    });
  });

  it('has no placeholder or sloppy text', function () {
    walk(strings, '', (at, value) => {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) {
        if (typeof item !== 'string') continue;
        assert.ok(!/\b(TODO|FIXME|TBD|lorem)\b/i.test(item), `${at} has placeholder text`);
        assert.ok(!/ {2}/.test(item), `${at} has a double space`);
        assert.strictEqual(item, item.trim(), `${at} has leading or trailing whitespace`);
      }
    });
  });

  it('formats counts and amounts', function () {
    assert.strictEqual(strings.common.plural(1, 'peer'), '1 peer');
    assert.strictEqual(strings.common.plural(3, 'peer'), '3 peers');
    assert.strictEqual(strings.common.plural(2, 'entry', 'entries'), '2 entries');
    assert.strictEqual(strings.common.sats(1000), '1,000 sats');
  });
});
