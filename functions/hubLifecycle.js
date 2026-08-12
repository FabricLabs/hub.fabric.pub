'use strict';

/**
 * Hub.start lifecycle phases for subclasses (GoonVC, downstream Hub apps) and compose-only apps.
 *
 * Light peers (LiveRelay / FabricNetwork) do not use this — they compose Peer directly.
 *
 * Subclass hooks (optional methods on the Hub instance):
 *   beforeRoutes / afterRoutes / beforeListen / afterListen / afterRuntime / …
 * Or settings.startHooks: { beforeRoutes: async (hub) => {}, … }
 *
 * Skip a phase: settings.skipStartPhases: ['bitcoin'] or settings.startPhases omit list.
 */

const HUB_START_PHASES = Object.freeze([
  'diagnostics',
  'filesystem',
  'bitcoin',
  'services',
  'state',
  'shell',
  'routes',
  'rpc',
  'listen',
  'runtime'
]);

function phaseToPascal (phase) {
  const s = String(phase || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hookMethodName (when, phase) {
  return `${when}${phaseToPascal(phase)}`;
}

/**
 * @param {object} hub
 * @returns {string[]}
 */
function resolveStartPhases (hub) {
  const settings = (hub && hub.settings) || {};
  if (Array.isArray(settings.startPhases) && settings.startPhases.length) {
    return settings.startPhases.map(String);
  }
  const skip = new Set(
    (Array.isArray(settings.skipStartPhases) ? settings.skipStartPhases : [])
      .map((p) => String(p))
  );
  return HUB_START_PHASES.filter((p) => !skip.has(p));
}

/**
 * @param {object} hub
 * @param {'before'|'after'} when
 * @param {string} phase
 * @returns {Promise<void>}
 */
async function callHubLifecycleHook (hub, when, phase) {
  const method = hookMethodName(when, phase);
  if (hub && typeof hub[method] === 'function') {
    await hub[method]();
  }
  const hooks = hub && hub.settings && hub.settings.startHooks;
  if (hooks && typeof hooks[method] === 'function') {
    await hooks[method](hub);
  }
}

/**
 * @param {object} hub
 * @param {string} phase
 * @param {() => Promise<void>|void} body
 * @returns {Promise<void>}
 */
async function runHubStartPhase (hub, phase, body) {
  await callHubLifecycleHook(hub, 'before', phase);
  if (hub && typeof hub.emit === 'function') {
    hub.emit('hub:start:phase', { phase, status: 'begin' });
  }
  if (typeof body === 'function') {
    await body.call(hub);
  }
  if (hub && typeof hub.emit === 'function') {
    hub.emit('hub:start:phase', { phase, status: 'end' });
  }
  await callHubLifecycleHook(hub, 'after', phase);
}

module.exports = {
  HUB_START_PHASES,
  phaseToPascal,
  hookMethodName,
  resolveStartPhases,
  callHubLifecycleHook,
  runHubStartPhase
};
