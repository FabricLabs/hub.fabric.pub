'use strict';

/**
 * Generate dependency trees for hub.fabric.pub and sibling Fabric packages using npm’s resolver.
 *
 * Outputs under reports/dependency-trees/:
 *   - <package-slug>.json — `npm ls --json --all` (machine-readable tree)
 *   - <package-slug>.txt  — `npm ls --all` (ASCII tree, npm’s own formatting)
 *   - index.json          — manifest of projects and exit hints
 *
 * Environment (optional):
 *   FABRIC_CORE      — path to @fabric/core checkout (default: $HOME/fabric-clean)
 *   FABRIC_HTTP      — path to @fabric/http checkout (default: $HOME/fabric-http)
 *   DEP_TREE_PROJECTS — comma-separated extra package roots to include
 *
 * Usage: node scripts/generate-dependency-trees.js
 *    or: npm run report:dependency-trees
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function readPackageName (dir) {
  const p = path.join(dir, 'package.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  return j.name || path.basename(dir);
}

function slug (name) {
  return String(name).replace(/[^a-zA-Z0-9._@-]+/g, '_');
}

function npmBin () {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function npmJsonLs (cwd) {
  const r = spawnSync(npmBin(), ['ls', '--json', '--all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    env: process.env
  });
  let data = null;
  try {
    data = r.stdout && r.stdout.trim() ? JSON.parse(r.stdout) : null;
  } catch (e) {
    data = { parseError: e && e.message ? e.message : String(e), rawStdout: r.stdout };
  }
  return { data, stderr: r.stderr || '', code: r.status };
}

function npmTextLs (cwd) {
  const r = spawnSync(npmBin(), ['ls', '--all'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    shell: false,
    env: process.env
  });
  return {
    out: (r.stdout || '') + (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : ''),
    code: r.status
  };
}

function expandProjects (hubRoot) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const defaultCore = path.join(home, 'fabric-clean');
  const defaultHttp = path.join(home, 'fabric-http');

  const extra = (process.env.DEP_TREE_PROJECTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const candidates = [
    hubRoot,
    process.env.FABRIC_CORE || defaultCore,
    process.env.FABRIC_HTTP || defaultHttp,
    ...extra
  ];

  const seen = new Set();
  const out = [];
  for (const dir of candidates) {
    const resolved = path.resolve(String(dir || '').trim() || '.');
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    const pkgPath = path.join(resolved, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      console.warn('[dependency-trees] skip (no package.json):', resolved);
      continue;
    }
    out.push(resolved);
  }
  return out;
}

function main () {
  const hubRoot = path.resolve(__dirname, '..');
  const outDir = path.join(hubRoot, 'reports', 'dependency-trees');
  fs.mkdirSync(outDir, { recursive: true });

  const projects = expandProjects(hubRoot);
  if (projects.length === 0) {
    console.error('[dependency-trees] no projects found.');
    process.exitCode = 1;
    return;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    npmVersion: spawnSync(npmBin(), ['-v'], { encoding: 'utf8' }).stdout.trim(),
    nodeVersion: process.version,
    projects: []
  };

  for (const cwd of projects) {
    const pkgName = readPackageName(cwd);
    const s = slug(pkgName);
    console.log('[dependency-trees]', pkgName, '→', s);

    const jsonResult = npmJsonLs(cwd);
    const jsonPath = path.join(outDir, `${s}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonResult.data, null, 2), 'utf8');

    const textResult = npmTextLs(cwd);
    fs.writeFileSync(path.join(outDir, `${s}.txt`), textResult.out, 'utf8');

    manifest.projects.push({
      name: pkgName,
      path: cwd,
      slug: s,
      npmLsJsonExitCode: jsonResult.code,
      npmLsTextExitCode: textResult.code,
      files: [`${s}.json`, `${s}.txt`],
      ...(jsonResult.stderr.trim() ? { stderrSnippet: jsonResult.stderr.slice(0, 500) } : {})
    });
  }

  const indexPath = path.join(outDir, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('[dependency-trees] manifest:', indexPath);
  console.log('[dependency-trees] done; non-zero npm ls exit codes usually mean peer/dedupe warnings — JSON tree is still useful.');
}

main();
