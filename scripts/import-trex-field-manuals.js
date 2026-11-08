#!/usr/bin/env node
'use strict';

/**
 * Mirror the T.REX ARMS Field Manual Vault (https://www.trex-arms.com/field-manual-vault)
 * to a local store, then publish each file to a Hub as a Document.
 *
 *   node scripts/import-trex-field-manuals.js [all | catalog | download | publish | status]
 *     --store <dir>          local store (default stores/trex-field-manuals)
 *     --formats pdf,epub     which files to fetch (default both)
 *     --hub <origin>         Hub HTTP origin (default http://127.0.0.1:8080)
 *     --token-file <path>    admin token (default ~/.fabric/hub-admin-token; optional on loopback)
 *     --concurrency <n>      parallel downloads (default 3)
 *     --delay <ms>           pause between requests per worker (default 250)
 *     --limit <n>            only process the first n publications (testing)
 *     --branch <b,...>       only these branches (af, army, joint, navy, usmc)
 *     --refresh              re-read the catalog and per-publication metadata
 *     --no-publish-list      create documents without listing them in the Hub catalog
 *
 * Every step is resumable and idempotent; rerun after an interruption.
 *   catalog   pages the vault's SvelteKit data endpoint per branch (30 per page),
 *             follows every listed edition, then reads each publication's page
 *             data for its pdf_url / epub_url. Saved to <store>/catalog.json.
 *   download  writes <store>/files/<branch>/<slug>/<name>.<ext>, via a `.part`
 *             file resumed with HTTP Range, checked against Content-Length,
 *             retried with backoff; sha256 recorded in <store>/manifest.json.
 *   publish   CreateDocument (sha256 = document id) + PublishDocument over
 *             POST /services/rpc. Files over the Hub's 8 MiB document limit stay
 *             local and are marked `tooLarge`.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SITE = 'https://www.trex-arms.com';
const VAULT = `${SITE}/field-manual-vault`;
const BRANCHES = ['af', 'army', 'joint', 'navy', 'usmc'];
const PAGE_SIZE = 30;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024; // services/hub.js MAX_DOCUMENT_BYTES
const UA = 'FabricHub-FieldManualMirror/1.0 (+https://github.com/FabricLabs/hub.fabric.pub)';
const MIME = { pdf: 'application/pdf', epub: 'application/epub+zip' };

function parseArgs (argv) {
  const o = {
    command: 'all',
    store: path.resolve('stores/trex-field-manuals'),
    formats: ['pdf', 'epub'],
    hub: 'http://127.0.0.1:8080',
    tokenFile: path.join(os.homedir(), '.fabric', 'hub-admin-token'),
    concurrency: 3,
    delay: 250,
    limit: Infinity,
    branches: BRANCHES,
    refresh: false,
    publishList: true
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--store') o.store = path.resolve(next());
    else if (a === '--formats') o.formats = next().split(',').map((s) => s.trim()).filter((s) => MIME[s]);
    else if (a === '--hub') o.hub = next().replace(/\/$/, '');
    else if (a === '--token-file') o.tokenFile = path.resolve(next());
    else if (a === '--concurrency') o.concurrency = Math.max(1, Number(next()) || 1);
    else if (a === '--delay') o.delay = Math.max(0, Number(next()) || 0);
    else if (a === '--limit') o.limit = Math.max(1, Number(next()) || 1);
    else if (a === '--branch') o.branches = next().split(',').filter((b) => BRANCHES.includes(b));
    else if (a === '--refresh') o.refresh = true;
    else if (a === '--no-publish-list') o.publishList = false;
    else if (a === '--help' || a === '-h') o.command = 'help';
    else if (!a.startsWith('--')) o.command = a;
    else throw new Error(`unknown option ${a}`);
  }
  return o;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson (file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson (file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

async function withRetry (label, fn, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err && err.permanent) break;
      const wait = Math.min(60000, 1000 * 2 ** i) + Math.floor(Math.random() * 500);
      console.warn(`[TREX] ${label}: ${err.message} (retry in ${wait}ms)`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function httpError (res, url) {
  const err = new Error(`HTTP ${res.status} for ${url}`);
  // 4xx (except throttling) won't fix itself.
  err.permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429;
  return err;
}

/** Decode SvelteKit's devalue-flattened `data` array (index references). */
function unflatten (arr) {
  const seen = new Map();
  const at = (i) => {
    if (typeof i !== 'number' || i < 0) return undefined; // -1 = undefined, etc.
    if (seen.has(i)) return seen.get(i);
    const v = arr[i];
    if (Array.isArray(v)) {
      const out = [];
      seen.set(i, out);
      for (const x of v) out.push(at(x));
      return out;
    }
    if (v && typeof v === 'object') {
      const out = {};
      seen.set(i, out);
      for (const [k, x] of Object.entries(v)) out[k] = at(x);
      return out;
    }
    return v;
  };
  return at(0);
}

async function svelteData (url) {
  return withRetry(`GET ${url}`, async () => {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!res.ok) throw httpError(res, url);
    const body = await res.json();
    if (body.type !== 'data' || !Array.isArray(body.nodes)) throw new Error(`unexpected payload from ${url}`);
    const node = body.nodes[body.nodes.length - 1];
    if (!node || !Array.isArray(node.data)) throw new Error(`no page data at ${url}`);
    return unflatten(node.data);
  });
}

// ---------------------------------------------------------------- catalog

async function buildCatalog (o) {
  const file = path.join(o.store, 'catalog.json');
  const metaDir = path.join(o.store, 'meta');
  const catalog = readJson(file, { slugs: {}, pubs: {} });
  catalog.slugs = catalog.slugs || {};
  catalog.pubs = catalog.pubs || {};

  if (o.refresh || !Object.keys(catalog.slugs).length) {
    for (const branch of o.branches) {
      let total = Infinity;
      for (let page = 1; (page - 1) * PAGE_SIZE < total; page++) {
        const data = await svelteData(`${VAULT}/__data.json?branch=${branch}&sort=title&page=${page}`);
        const list = data && data.list;
        if (!list || !Array.isArray(list.results)) throw new Error(`no list for branch ${branch} page ${page}`);
        total = Number(list.total) || 0;
        for (const r of list.results) {
          catalog.slugs[r.slug] = branch;
          for (const e of r.editions || []) if (e && e.slug) catalog.slugs[e.slug] = catalog.slugs[e.slug] || branch;
        }
        console.log(`[TREX] ${branch} page ${page}/${Math.ceil(total / PAGE_SIZE)} — ${Object.keys(catalog.slugs).length} slugs`);
        if (!list.results.length) break;
        await sleep(o.delay);
      }
      writeJson(file, catalog);
    }
  }

  const slugs = Object.keys(catalog.slugs).slice(0, o.limit);
  let done = 0;
  await pool(slugs, o.concurrency, async (slug) => {
    const metaFile = path.join(metaDir, `${slug}.json`);
    let pub = !o.refresh && readJson(metaFile, null);
    if (!pub) {
      const data = await svelteData(`${VAULT}/${encodeURIComponent(slug)}/__data.json`);
      pub = data && data.pub;
      if (!pub) throw new Error(`no publication data for ${slug}`);
      writeJson(metaFile, pub);
      await sleep(o.delay);
    }
    // Other editions linked from this page belong in the catalog too.
    for (const e of pub.editions || []) if (e && e.slug && !catalog.slugs[e.slug]) catalog.slugs[e.slug] = pub.branch;
    catalog.pubs[slug] = {
      slug,
      id: pub.id,
      designation: pub.designation,
      title: pub.title,
      branch: pub.branch,
      editionDate: pub.edition_date,
      status: pub.status,
      collection: pub.collection,
      downloadName: pub.download_name || `${pub.designation} ${pub.title}`,
      pdf: pub.pdf_url || null,
      epub: pub.epub_url || null
    };
    if (++done % 50 === 0) {
      console.log(`[TREX] metadata ${done}/${slugs.length}`);
      writeJson(file, catalog);
    }
  });
  writeJson(file, catalog);
  console.log(`[TREX] catalog: ${Object.keys(catalog.pubs).length} publications`);
  return catalog;
}

// ---------------------------------------------------------------- download

function safeName (s) {
  return String(s).replace(/[\/\\:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 180) || 'manual';
}

function sha256File (file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function downloadFile (url, dest) {
  const part = `${dest}.part`;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  return withRetry(`download ${url}`, async () => {
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const headers = { 'user-agent': UA };
    if (have > 0) headers.range = `bytes=${have}-`;
    const res = await fetch(url, { headers });
    if (res.status === 416) { // .part is already complete (or corrupt): start over
      fs.rmSync(part, { force: true });
      throw new Error('range not satisfiable; restarting');
    }
    if (!res.ok) throw httpError(res, url);
    const resumed = res.status === 206;
    let expected = Number(res.headers.get('content-length')) || 0;
    if (resumed) {
      const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
      expected = m ? Number(m[1]) : (expected ? have + expected : 0);
    }
    const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    try {
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    const size = fs.statSync(part).size;
    if (expected && size !== expected) throw new Error(`short read ${size}/${expected}`);
    if (!size) throw new Error('empty file');
    fs.renameSync(part, dest);
    return size;
  });
}

async function downloadAll (o, catalog, manifest) {
  const jobs = [];
  for (const pub of Object.values(catalog.pubs).slice(0, o.limit)) {
    for (const fmt of o.formats) {
      if (!pub[fmt]) continue;
      jobs.push({ pub, fmt, key: `${pub.slug}.${fmt}` });
    }
  }
  let done = 0;
  let failed = 0;
  await pool(jobs, o.concurrency, async ({ pub, fmt, key }) => {
    const rel = path.join('files', pub.branch || 'other', pub.slug, `${safeName(pub.downloadName)}.${fmt}`);
    const abs = path.join(o.store, rel);
    const entry = manifest.files[key] || {};
    if (entry.sha256 && entry.path === rel && fs.existsSync(abs) && fs.statSync(abs).size === entry.size) {
      done++;
      return;
    }
    try {
      const size = await downloadFile(pub[fmt], abs);
      manifest.files[key] = { slug: pub.slug, format: fmt, url: pub[fmt], path: rel, size, sha256: await sha256File(abs), downloadedAt: new Date().toISOString() };
      saveManifest(o, manifest);
    } catch (err) {
      failed++;
      manifest.files[key] = { ...entry, slug: pub.slug, format: fmt, url: pub[fmt], error: err.message };
      saveManifest(o, manifest);
      console.error(`[TREX] FAILED ${key}: ${err.message}`);
    }
    if (++done % 25 === 0) console.log(`[TREX] files ${done}/${jobs.length}`);
    await sleep(o.delay);
  });
  saveManifest(o, manifest, true);
  console.log(`[TREX] download: ${jobs.length - failed}/${jobs.length} files present, ${failed} failed (rerun to retry)`);
}

// ---------------------------------------------------------------- publish

let manifestTimer = null;
function saveManifest (o, manifest, now = false) {
  const file = path.join(o.store, 'manifest.json');
  if (now) {
    clearTimeout(manifestTimer);
    manifestTimer = null;
    return writeJson(file, manifest);
  }
  if (!manifestTimer) manifestTimer = setTimeout(() => { manifestTimer = null; writeJson(file, manifest); }, 2000);
}

async function rpc (o, method, params) {
  return withRetry(`RPC ${method}`, async () => {
    const res = await fetch(`${o.hub}/services/rpc`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params })
    });
    if (!res.ok) throw httpError(res, `${o.hub}/services/rpc`);
    const body = await res.json();
    if (body.error) throw Object.assign(new Error(body.error.message || JSON.stringify(body.error)), { permanent: true });
    const result = body.result;
    if (result && result.status === 'error') throw Object.assign(new Error(result.message), { permanent: true });
    return result;
  }, 4);
}

async function publishAll (o, catalog, manifest) {
  let token = null;
  try { token = fs.readFileSync(o.tokenFile, 'utf8').trim() || null; } catch (_) {}
  if (!token) console.warn(`[TREX] no admin token at ${o.tokenFile}; relying on the Hub allowing free listings`);
  await rpc(o, 'GetSetupStatus', []).catch((err) => {
    throw new Error(`Hub not reachable at ${o.hub}: ${err.message}`);
  });

  const entries = Object.entries(manifest.files).filter(([, e]) => e.sha256 && e.path);
  let published = 0;
  let skipped = 0;
  let failed = 0;
  // One at a time: each CreateDocument carries up to 8 MiB of base64.
  for (const [key, e] of entries) {
    if (e.published && e.documentId === e.sha256 && (e.listed || !o.publishList)) { published++; continue; }
    if (e.size > MAX_DOCUMENT_BYTES) {
      if (!e.tooLarge) { e.tooLarge = true; saveManifest(o, manifest); }
      skipped++;
      continue;
    }
    const pub = catalog.pubs[e.slug] || {};
    try {
      const buf = fs.readFileSync(path.join(o.store, e.path));
      const created = await rpc(o, 'CreateDocument', [{
        name: path.basename(e.path),
        mime: MIME[e.format],
        contentBase64: buf.toString('base64'),
        sha256: e.sha256,
        adminToken: token || undefined
      }]);
      const id = created && created.document && created.document.id;
      if (id !== e.sha256) throw new Error(`Hub returned id ${id}, expected ${e.sha256}`);
      e.documentId = id;
      e.published = true;
      if (o.publishList) {
        await rpc(o, 'PublishDocument', [{ id, adminToken: token || undefined }]);
        e.listed = true;
      }
      e.title = `${pub.designation || ''} ${pub.title || ''}`.trim();
      delete e.publishError;
      published++;
      if (published % 25 === 0) console.log(`[TREX] published ${published}/${entries.length}`);
    } catch (err) {
      failed++;
      e.publishError = err.message;
      console.error(`[TREX] publish ${key}: ${err.message}`);
    }
    saveManifest(o, manifest);
  }
  saveManifest(o, manifest, true);
  console.log(`[TREX] publish: ${published} on the Hub, ${skipped} over 8 MiB kept local only, ${failed} failed`);
}

// ---------------------------------------------------------------- misc

async function pool (items, n, fn) {
  let i = 0;
  const errors = [];
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const item = items[i++];
      try { await fn(item); } catch (err) { errors.push(err); console.error(`[TREX] ${err.message}`); }
    }
  }));
  return errors;
}

function status (o) {
  const catalog = readJson(path.join(o.store, 'catalog.json'), { slugs: {}, pubs: {} });
  const files = Object.values(readJson(path.join(o.store, 'manifest.json'), { files: {} }).files);
  const count = (f) => files.filter(f).length;
  console.log(JSON.stringify({
    store: o.store,
    slugs: Object.keys(catalog.slugs || {}).length,
    publications: Object.keys(catalog.pubs || {}).length,
    downloaded: count((e) => e.sha256),
    bytes: files.reduce((s, e) => s + (e.sha256 ? e.size : 0), 0),
    downloadErrors: count((e) => !e.sha256 && e.error),
    published: count((e) => e.published),
    tooLarge: count((e) => e.tooLarge),
    publishErrors: count((e) => e.publishError)
  }, null, 2));
}

async function main () {
  const o = parseArgs(process.argv.slice(2));
  if (o.command === 'help' || !['all', 'catalog', 'download', 'publish', 'status'].includes(o.command)) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return;
  }
  fs.mkdirSync(o.store, { recursive: true });
  if (o.command === 'status') return status(o);
  const manifest = readJson(path.join(o.store, 'manifest.json'), { files: {} });
  const catalog = (o.command === 'publish')
    ? readJson(path.join(o.store, 'catalog.json'), { slugs: {}, pubs: {} })
    : await buildCatalog(o);
  if (o.command === 'all' || o.command === 'download') await downloadAll(o, catalog, manifest);
  if (o.command === 'all' || o.command === 'publish') await publishAll(o, catalog, manifest);
}

main().catch((err) => {
  console.error('[TREX] fatal:', err && err.stack ? err.stack : err);
  process.exit(1);
});
