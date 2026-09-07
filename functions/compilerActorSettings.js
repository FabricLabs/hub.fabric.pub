'use strict';

/**
 * JSON-safe Actor/Service settings for Hub {@link Compiler}.
 * Webpack configs and React documents are not JSON (webpack.Compiler.root is
 * circular after `.run()`). Never pass those through `super()` into Fabric Actor.
 *
 * @param {Object} [settings]
 * @returns {{ title: string, site: { name: string }, state: { title: string } }}
 */
function compilerActorSettings (settings = {}) {
  const site = settings.site && typeof settings.site === 'object' ? settings.site : {};
  const state = settings.state && typeof settings.state === 'object' ? settings.state : {};
  const title = String(
    settings.title
    || state.title
    || site.title
    || site.name
    || 'hub.fabric.pub'
  );
  const name = String(site.name || 'Default Fabric Application');
  return {
    title,
    site: { name },
    state: { title }
  };
}

module.exports = {
  compilerActorSettings
};
