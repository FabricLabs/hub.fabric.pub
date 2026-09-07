'use strict';

/**
 * Browser-safe helpers for the Hub `/downloads` FileBrowser.
 * The listing is a flat `files[]` tree written at build time (`assets/downloads/index.json`).
 */

/** Names that live in `assets/downloads` but are not installer artifacts. */
const INDEX_META_NAMES = new Set([
  'index.json',
  'README.md',
  '.gitkeep',
  '.DS_Store'
]);

/**
 * Normalize a relative POSIX path. Rejects `..`, NUL, and empty segments used as traversal.
 * @param {string} input
 * @param {object} [opts]
 * @param {boolean} [opts.allowEmpty=true] When true, `''` is a valid root path.
 * @returns {string|null}
 */
function normalizeRelativePath (input, opts) {
  const allowEmpty = !opts || opts.allowEmpty !== false;
  const s = String(input == null ? '' : input).replace(/\\/g, '/').replace(/^\/+/, '');
  if (!s) return allowEmpty ? '' : null;
  if (s.indexOf('\0') >= 0) return null;
  const parts = [];
  const raw = s.split('/');
  for (let i = 0; i < raw.length; i++) {
    const seg = raw[i];
    if (!seg || seg === '.') continue;
    if (seg === '..') return null;
    parts.push(seg);
  }
  return parts.join('/');
}

/**
 * @param {string} pathname
 * @param {string} [rootPath]
 * @returns {{ path: string, invalid: boolean }}
 */
function relativePathFromLocation (pathname, rootPath) {
  const root = String(rootPath || '/downloads').replace(/\/+$/, '') || '';
  const raw = String(pathname || '');
  if (!root) return { path: '', invalid: false };
  if (raw === root || raw === `${root}/`) return { path: '', invalid: false };
  if (!raw.startsWith(`${root}/`)) return { path: '', invalid: false };
  const rest = normalizeRelativePath(raw.slice(root.length + 1), { allowEmpty: true });
  if (rest == null) return { path: '', invalid: true };
  return { path: rest, invalid: false };
}

/**
 * @param {string} rootPath
 * @param {string} relPath
 * @returns {string}
 */
function hrefForRootRelative (rootPath, relPath) {
  const root = String(rootPath || '').replace(/\/+$/, '') || '';
  const rel = normalizeRelativePath(relPath, { allowEmpty: true });
  if (!rel) return root || '/';
  const encoded = rel.split('/').map(encodeURIComponent).join('/');
  return `${root}/${encoded}`;
}

/**
 * @param {object|null|undefined} index
 * @returns {Array<{ path: string, size?: number, mtime?: string }>}
 */
function filesFromIndex (index) {
  if (!index || typeof index !== 'object') return [];
  const files = Array.isArray(index.files) ? index.files : [];
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!f || typeof f.path !== 'string') continue;
    const p = normalizeRelativePath(f.path, { allowEmpty: false });
    if (!p) continue;
    const base = p.split('/').pop();
    if (INDEX_META_NAMES.has(base)) continue;
    out.push({
      path: p,
      size: Number.isFinite(Number(f.size)) ? Number(f.size) : undefined,
      mtime: f.mtime != null ? String(f.mtime) : undefined
    });
  }
  return out;
}

/**
 * Immediate children of `relPath` (directories first, then files).
 * @param {Array<{ path: string, size?: number, mtime?: string }>} files
 * @param {string} relPath
 * @returns {Array<{ type: string, name: string, path: string, size?: number, mtime?: string }>}
 */
function entriesForPath (files, relPath) {
  const current = normalizeRelativePath(relPath, { allowEmpty: true });
  if (current == null) return [];
  const prefix = current ? `${current}/` : '';
  const dirs = new Map();
  const outFiles = [];
  const list = Array.isArray(files) ? files : [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const p = f && f.path ? normalizeRelativePath(f.path, { allowEmpty: false }) : null;
    if (!p) continue;
    if (current && p === current) continue;
    if (current && p.indexOf(prefix) !== 0) continue;
    if (!current && p.indexOf('/') < 0) {
      outFiles.push({
        type: 'file',
        name: p,
        path: p,
        size: f.size,
        mtime: f.mtime
      });
      continue;
    }
    const rest = current ? p.slice(prefix.length) : p;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      outFiles.push({
        type: 'file',
        name: rest,
        path: p,
        size: f.size,
        mtime: f.mtime
      });
    } else {
      const name = rest.slice(0, slash);
      if (!name || dirs.has(name)) continue;
      dirs.set(name, {
        type: 'dir',
        name,
        path: current ? `${current}/${name}` : name
      });
    }
  }
  const dirsArr = Array.from(dirs.values()).sort((a, b) => a.name.localeCompare(b.name));
  outFiles.sort((a, b) => a.name.localeCompare(b.name));
  return dirsArr.concat(outFiles);
}

/**
 * @param {string} relPath
 * @returns {Array<{ name: string, path: string }>}
 */
function breadcrumbsForPath (relPath) {
  const current = normalizeRelativePath(relPath, { allowEmpty: true });
  if (!current) return [];
  const parts = current.split('/');
  const crumbs = [];
  for (let i = 0; i < parts.length; i++) {
    crumbs.push({
      name: parts[i],
      path: parts.slice(0, i + 1).join('/')
    });
  }
  return crumbs;
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatByteSize (n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '';
  if (v < 1024) return `${Math.round(v)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i += 1;
  }
  const digits = x >= 10 ? 0 : 1;
  return `${x.toFixed(digits)} ${units[i]}`;
}

module.exports = {
  INDEX_META_NAMES,
  normalizeRelativePath,
  relativePathFromLocation,
  hrefForRootRelative,
  filesFromIndex,
  entriesForPath,
  breadcrumbsForPath,
  formatByteSize
};
