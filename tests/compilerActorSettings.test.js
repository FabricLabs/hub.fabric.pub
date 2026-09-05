'use strict';

const assert = require('assert');
const { compilerActorSettings } = require('../functions/compilerActorSettings');

describe('compilerActorSettings', function () {
  it('returns JSON-safe title/site/state only', function () {
    const webpack = { plugins: [] };
    const compiler = { name: 'webpack.Compiler' };
    compiler.root = compiler;
    webpack.plugins.push({ _compiler: compiler });

    const document = { render () { return null; } };
    document._owner = document;

    const out = compilerActorSettings({
      title: 'Hub',
      webpack,
      document,
      skipWebpack: true,
      bitcoin: { rpc: {} },
      peers: [webpack]
    });

    assert.deepStrictEqual(out, {
      title: 'Hub',
      site: { name: 'Default Fabric Application' },
      state: { title: 'Hub' }
    });
    assert.strictEqual(Object.prototype.hasOwnProperty.call(out, 'webpack'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(out, 'document'), false);
    JSON.stringify(out);
  });

  it('defaults title to hub.fabric.pub', function () {
    const out = compilerActorSettings({});
    assert.strictEqual(out.title, 'hub.fabric.pub');
    assert.strictEqual(out.state.title, 'hub.fabric.pub');
  });
});

describe('Hub Compiler skipWebpack', function () {
  this.timeout(20000);

  let saved;

  before(function () {
    saved = {
      window: global.window,
      document: global.document,
      HTMLElement: global.HTMLElement
    };
  });

  after(function () {
    global.window = saved.window;
    global.document = saved.document;
    global.HTMLElement = saved.HTMLElement;
  });

  it('constructs when a used webpack config has circular Compiler.root', function () {
    const Compiler = require('../types/compiler');
    function WebpackCompiler () {}
    const inst = new WebpackCompiler();
    inst.root = inst;
    const webpackConfig = {
      mode: 'production',
      plugins: [{ _compiler: inst }]
    };
    const compiler = new Compiler({
      document: { _getHTML: () => '<p>ok</p>' },
      webpack: webpackConfig,
      skipWebpack: true,
      bitcoin: { enable: true }
    });
    assert.ok(compiler);
    assert.strictEqual(typeof compiler.packer.run, 'function');
  });
});
