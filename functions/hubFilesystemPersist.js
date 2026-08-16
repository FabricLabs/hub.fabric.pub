'use strict';

/**
 * @fileoverview Hub Filesystem writes must not use `@fabric/core` `Filesystem.publish`
 * on the npm git pin: that retains every body in `_state.documents` and
 * `synchronize()`s the tree (desktop Electron ~3.7 GiB OOM; playnet PM2 loop).
 */

/**
 * @param {*} document
 * @returns {string|Buffer}
 */
function serializePublishBody (document) {
  if (typeof document === 'string' || Buffer.isBuffer(document)) return document;
  return JSON.stringify(document);
}

/**
 * Drop in-memory body copies left by an unpatched `Filesystem.publish`.
 * @param {object} fs
 * @returns {void}
 */
function dropFilesystemBodyCache (fs) {
  if (!fs || !fs._state || typeof fs._state !== 'object') return;
  fs._state.documents = {};
  fs._state.actors = {};
}

/**
 * Replace `fs.publish` with `writeFile` (no body retain, no tree sync).
 * Callers (Payjoin, federation registry, contract queue, identity cluster)
 * keep using `publish`; the guard is installed once on Hub construction.
 * @param {object} fs
 * @returns {object} fs
 */
function installFilesystemPublishHeapGuard (fs) {
  if (!fs || fs._hubPublishHeapGuard) return fs;
  const origPublish = typeof fs.publish === 'function' ? fs.publish.bind(fs) : null;
  const origWrite = typeof fs.writeFile === 'function' ? fs.writeFile.bind(fs) : null;
  if (!origPublish && !origWrite) return fs;
  fs._hubPublishHeapGuard = true;
  fs.publish = async function hubPublishWithoutRetain (name, document) {
    const content = serializePublishBody(document);
    if (origWrite) {
      const ok = origWrite(name, content);
      if (typeof fs._notePublishedName === 'function') {
        try { fs._notePublishedName(name); } catch (_) { /* npm pin without helper */ }
      }
      dropFilesystemBodyCache(fs);
      return { ok: !!ok, name };
    }
    if (origPublish) {
      const out = await origPublish(name, document);
      dropFilesystemBodyCache(fs);
      return out;
    }
    return { ok: false, name };
  };
  return fs;
}

/**
 * @param {object} fs
 * @param {string} name
 * @param {*} value
 * @returns {boolean|Promise}
 */
function persistFilesystemJson (fs, name, value) {
  if (!fs || typeof name !== 'string' || !name) return false;
  if (typeof fs.publish === 'function') {
    const p = fs.publish(name, value);
    if (p && typeof p.then === 'function') return p;
    return true;
  }
  if (typeof fs.writeFile === 'function') {
    return !!fs.writeFile(name, serializePublishBody(value));
  }
  return false;
}

module.exports = {
  installFilesystemPublishHeapGuard,
  persistFilesystemJson,
  dropFilesystemBodyCache,
  serializePublishBody
};
