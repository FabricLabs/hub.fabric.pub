'use strict';

const path = require('path');
const webpack = require('webpack');
const merge = require('lodash.merge');
const { JSDOM } = require('jsdom');

// Use a non-opaque origin so features like localStorage are available during SSR.
// Opaque origins (e.g. about:blank) cause jsdom to throw SecurityError on window.localStorage.
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://hub.fabric.local'
});

// Browser Polyfills
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.HTMLElement;

// Provide a safe in-memory localStorage for SSR builds.
// jsdom's default localStorage throws on some origins; we don't need persistence here.
try {
  const store = {};
  const safeStorage = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    }
  };

  // Attempt to override any throwing accessor with a safe implementation.
  try {
    // Direct assignment (works when property is writable).
    global.window.localStorage = safeStorage;
  } catch (e) {
    // Fallback: define property if direct assignment fails.
    try {
      Object.defineProperty(global.window, 'localStorage', {
        value: safeStorage,
        configurable: true,
        enumerable: false,
        writable: false
      });
    } catch (_) {
      // Swallow; worst case, components must guard localStorage access.
    }
  }
} catch (_) {
  // If anything goes wrong, don't block the build.
}

// Fabric Types
// const Service = require('@fabric/core/types/service');
const HTTPCompiler = require('@fabric/http/types/compiler');
const HTTPComponent = require('@fabric/http/types/component');
// const HTTPSite = require('@fabric/http/types/site');

// Types
const HTTPSite = require('./site');
const { compilerActorSettings } = require('../functions/compilerActorSettings');

/**
 * Builder for {@link Fabric}-based applications.
 */
class Compiler extends HTTPCompiler {
  /**
   * Create an instance of the compiler.
   * @param {Object} [settings] Map of settings.
   * @param {HTTPComponent} [settings.document] Document to use.
   * @param {boolean} [settings.skipWebpack] When true, do not construct a
   *     webpack Compiler (SPA bundle already built). Required after
   *     `webpack(config).run()` because plugins retain circular `compiler.root`.
   */
  constructor (settings = {}) {
    const actorSettings = compilerActorSettings(settings);
    const document = settings.document || null;
    const skipWebpack = settings.skipWebpack === true;
    super(actorSettings);

    this.settings = merge({
      document: document || new HTTPComponent(actorSettings),
      site: {
        name: actorSettings.site.name
      },
      state: {
        title: actorSettings.state.title
      },
      // Use provided webpack config if present, otherwise use default
      webpack: skipWebpack
        ? { mode: settings.mode || 'production', watch: false }
        : (settings.webpack || {
        mode: settings.mode || 'production',
        entry: path.resolve('./scripts/browser.js'),
        experiments: {
          asyncWebAssembly: true
        },
        resolve: {
          fallback: {
            crypto: require.resolve('crypto-browserify'),
            path: require.resolve('path-browserify'),
            buffer: require.resolve('buffer'),
            process: require.resolve('process/browser')
          },
          symlinks: false
        },
        target: 'web',
        output: {
          path: path.resolve('./assets/bundles'),
          filename: 'browser.min.js',
          clean: {
            dry: true
          }
        },
        module: {
          rules: [
            {
              test: /\.(js|jsx)$/,
              exclude: /node_modules/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: ['@babel/preset-env', '@babel/preset-react']
                }
              }
            },
            {
              test: /\.css$/,
              use: ['style-loader', 'css-loader']
            }
          ]
        },
        plugins: [
          new webpack.DefinePlugin({
            'process.env': JSON.stringify(process.env)
          }),
          new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
            process: 'process/browser'
          })
        ],
        watch: false
      })
    }, actorSettings);

    this.component = document || this.settings.document || null;
    const resolvedTitle = actorSettings.title;
    this.site = new HTTPSite(merge({}, this.settings.site, {
      title: resolvedTitle,
      state: {
        title: resolvedTitle
      }
    }));

    this._state = {
      content: this.settings.state
    };

    if (skipWebpack) {
      this.packer = {
        run (cb) {
          if (typeof cb === 'function') cb(null, { fullhash: 'prebuilt' });
        }
      };
    } else {
      this.packer = webpack(this.settings.webpack);
    }

    return this;
  }
}

module.exports = Compiler;
