'use strict';

const fs = require('fs');
const path = require('path');

const { HUB_SETUP_APPLY_MIN_MS } = require('./hubBitcoinSetup');

const HUB_SETUP_COLLECTION_NAMES = Object.freeze([
  'messages',
  'documents',
  'contracts',
  'chain'
]);

function ensureDir (dir) {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Seed Hub STATE collections + peers LevelDB dir so the next process boot
 * has the same files a configured node expects (not just IS_CONFIGURED).
 *
 * @param {Object} hub Hub instance
 * @returns {{ ok: boolean, configured: boolean, peersDir: string|null, settingsPath: string|null }}
 */
function seedHubStoresAfterSetup (hub) {
  const empty = { ok: false, configured: false, peersDir: null, settingsPath: null };
  if (!hub || !hub._state) return empty;

  hub._state.content = hub._state.content || {};
  hub._state.content.collections = hub._state.content.collections || {};
  for (const name of HUB_SETUP_COLLECTION_NAMES) {
    if (!hub._state.content.collections[name] || typeof hub._state.content.collections[name] !== 'object') {
      hub._state.content.collections[name] = {};
    }
  }
  if (!hub._state.content.chain || typeof hub._state.content.chain !== 'object') {
    hub._state.content.chain = {};
  }
  if (!hub._state.content.services || typeof hub._state.content.services !== 'object') {
    hub._state.content.services = {};
  }

  if (hub.setup && typeof hub.setup.listSettings === 'function') {
    hub._state.content.settings = hub.setup.listSettings();
  }

  let peersDir = null;
  if (hub.settings && hub.settings.peersDb) {
    peersDir = path.isAbsolute(hub.settings.peersDb)
      ? hub.settings.peersDb
      : path.resolve(process.cwd(), hub.settings.peersDb);
  } else if (hub.fs && hub.fs.path) {
    peersDir = path.join(hub.fs.path, 'peers');
  }
  if (peersDir) ensureDir(peersDir);

  const settingsPath = hub.fs && hub.fs.path ? path.join(hub.fs.path, 'STATE') : null;

  if (typeof hub.commit === 'function') hub.commit();

  const settings = hub._state.content.settings || {};
  const configured = settings.IS_CONFIGURED === true || settings.IS_CONFIGURED === 'true';

  return {
    ok: true,
    configured,
    peersDir,
    settingsPath
  };
}

function sleepMs (ms) {
  const n = Number(ms);
  const wait = Number.isFinite(n) && n > 0 ? n : 0;
  return new Promise((resolve) => setTimeout(resolve, wait));
}

module.exports = {
  HUB_SETUP_APPLY_MIN_MS,
  HUB_SETUP_COLLECTION_NAMES,
  seedHubStoresAfterSetup,
  sleepMs
};
