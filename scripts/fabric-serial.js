#!/usr/bin/env node
'use strict';

// Shared by every Fabric repository (docs/agents/DEVELOPMENT_PROCESS.md);
// keep the copies byte-identical.
//
//   node scripts/fabric-serial.js install [--allow-git=all]
//   node scripts/fabric-serial.js run -- <command...>
//
// Both hold one lock shared by all repositories on this machine, so at most
// one install or test run happens at a time.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const WINDOWS = process.platform === 'win32';
const NPM = WINDOWS ? 'npm.cmd' : 'npm';
const NPM_MAJOR = 12;
const POLL_MS = 2000;
const UNOWNED_STALE_MS = 10000;
const ROOT = path.resolve(__dirname, '..');
const LOCK = process.env.FABRIC_SERIAL_LOCK || path.join(os.homedir(), '.fabric', 'serial.lock');
const WAIT_MS = Number(process.env.FABRIC_SERIAL_WAIT_MS) || 30 * 60 * 1000;

let held = false;
let child = null;
let signalled = null;

function say (message) {
  process.stderr.write(`[fabric-serial] ${message}\n`);
}

function fail (message, code = 1) {
  say(message);
  process.exit(code);
}

// .cmd files only start through a shell on Windows.
function command (file, args, options = {}) {
  if (!WINDOWS) return [file, args, { ...options, shell: false }];
  const line = [file, ...args].map((a) => (/[\s"&|<>^()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');
  return [line, [], { ...options, shell: true }];
}

function readOwner (dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'));
  } catch (error) {
    return null;
  }
}

function alive (pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function stale (owner) {
  if (owner) return !alive(owner.pid);
  // owner.json is written right after mkdir; a lock without one for long was abandoned.
  try {
    return Date.now() - fs.statSync(LOCK).mtimeMs > UNOWNED_STALE_MS;
  } catch (error) {
    return false;
  }
}

function breakStale () {
  const aside = `${LOCK}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(LOCK, aside);
  } catch (error) {
    return;
  }
  const moved = readOwner(aside);
  if (moved && alive(moved.pid)) {
    // Another waiter took the lock between our check and the rename: hand it back.
    try { fs.renameSync(aside, LOCK); } catch (error) {}
    return;
  }
  fs.rmSync(aside, { recursive: true, force: true });
}

function describe (owner) {
  if (!owner) return `an unknown holder (${LOCK})`;
  return `\`${owner.command}\` in ${owner.repo} (pid ${owner.pid}, since ${owner.startedAt})`;
}

function release () {
  if (!held) return;
  held = false;
  const owner = readOwner(LOCK);
  if (!owner || owner.pid === process.pid) fs.rmSync(LOCK, { recursive: true, force: true });
}

async function acquire (repo, label) {
  const current = readOwner(LOCK);
  // A command started under a lock this process tree already holds (e.g. a test
  // script calling report:install) must not wait for itself.
  if (current && String(current.pid) === process.env.FABRIC_SERIAL_HOLDER && alive(current.pid)) return;

  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  const deadline = Date.now() + WAIT_MS;
  let announced = null;

  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      held = true;
      const owner = { pid: process.pid, repo, command: label, startedAt: new Date().toISOString() };
      const temp = path.join(LOCK, `owner.${process.pid}.tmp`);
      fs.writeFileSync(temp, JSON.stringify(owner, null, 2) + '\n');
      fs.renameSync(temp, path.join(LOCK, 'owner.json'));
      process.env.FABRIC_SERIAL_HOLDER = String(process.pid);
      return;
    } catch (error) {
      if (held) throw error;
      if (error.code !== 'EEXIST') throw error;
    }

    const owner = readOwner(LOCK);
    if (stale(owner)) {
      say(`taking over a stale lock from ${describe(owner)}`);
      breakStale();
      continue;
    }

    const key = owner ? `${owner.pid}:${owner.startedAt}` : '';
    if (key !== announced) {
      say(`waiting for ${describe(owner)} to finish; lock: ${LOCK}`);
      announced = key;
    }
    if (Date.now() >= deadline) {
      fail(`gave up after ${Math.round(WAIT_MS / 1000)}s waiting for ${describe(owner)} (FABRIC_SERIAL_WAIT_MS)`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function onSignal (name) {
  signalled = name;
  if (child) {
    // Pass it on and keep the lock until the child has exited.
    try { child.kill(name); } catch (error) {}
    return;
  }
  release();
  process.exit(128 + (os.constants.signals[name] || 1));
}

function exitCode (code) {
  if (signalled) return 128 + (os.constants.signals[signalled] || 1);
  return code === null ? 1 : code;
}

function wait (proc) {
  child = proc;
  return new Promise((resolve) => {
    proc.on('error', (error) => {
      say(error.message);
      resolve(127);
    });
    proc.on('close', (code) => resolve(code));
  }).finally(() => { child = null; });
}

function checkNpm () {
  const [file, args, options] = command(NPM, ['--version'], { encoding: 'utf8' });
  const result = spawnSync(file, args, options);
  const version = (result.stdout || '').trim();
  const major = parseInt(version, 10);
  if (result.error || result.status !== 0 || !Number.isInteger(major)) {
    fail(`could not run \`npm --version\`${result.error ? `: ${result.error.message}` : ''}`);
  }
  if (major < NPM_MAJOR) {
    fail(`npm ${version} is too old: Fabric repositories need npm >= ${NPM_MAJOR} (Git pins, allow-git). Run \`npm install -g npm@${NPM_MAJOR}\` and try again.`);
  }
  return version;
}

function lockfileChanges () {
  const result = spawnSync('git', ['status', '--porcelain', '--', 'package-lock.json'], { cwd: ROOT, encoding: 'utf8' });
  if (result.error || result.status !== 0) return '';
  return result.stdout.trim();
}

async function install (extra) {
  const npmVersion = checkNpm();
  const lockfile = path.join(ROOT, 'package-lock.json');
  const reports = path.join(ROOT, 'reports');
  const backup = path.join(reports, 'package-lock.before-install.json');
  const log = path.join(reports, 'install.log');

  if (fs.existsSync(lockfile)) {
    const changes = lockfileChanges();
    if (changes && process.env.FABRIC_INSTALL_DISCARD_LOCK !== '1') {
      fail([
        `package-lock.json has uncommitted changes (git status: ${changes}).`,
        'report:install deletes the lockfile to pull the latest Git pins, which would discard them.',
        'Commit or stash it first, or set FABRIC_INSTALL_DISCARD_LOCK=1 to discard it',
        '(a copy is still kept in reports/package-lock.before-install.json).'
      ].join('\n  '));
    }
  }

  const args = ['i', ...extra];
  const line = `$ npm ${args.join(' ')}`;
  await acquire(ROOT, line);

  fs.mkdirSync(reports, { recursive: true });
  const hadLockfile = fs.existsSync(lockfile);
  if (hadLockfile) fs.copyFileSync(lockfile, backup);
  fs.rmSync(path.join(ROOT, 'node_modules'), { recursive: true, force: true });
  fs.rmSync(lockfile, { force: true });

  fs.writeFileSync(log, `${line}\n`);
  const fd = fs.openSync(log, 'a');
  say(`${line} (npm ${npmVersion}) in ${ROOT}; output in reports/install.log`);
  const [file, spawnArgs, options] = command(NPM, args, { cwd: ROOT, stdio: ['ignore', fd, fd] });
  const code = exitCode(await wait(spawn(file, spawnArgs, options)));
  fs.closeSync(fd);

  if (code !== 0) {
    if (hadLockfile) {
      fs.copyFileSync(backup, lockfile);
      say('install failed; restored package-lock.json from reports/package-lock.before-install.json');
    }
    say(`npm exited with ${code}; see reports/install.log`);
  } else {
    say('install finished; read reports/install.log');
  }
  return code;
}

async function run (argv) {
  if (!argv.length) fail('usage: node scripts/fabric-serial.js run -- <command...>', 2);
  const repo = process.cwd();
  await acquire(repo, argv.join(' '));
  const [file, args, options] = command(argv[0], argv.slice(1), { stdio: 'inherit' });
  return exitCode(await wait(spawn(file, args, options)));
}

async function main () {
  const [mode, ...rest] = process.argv.slice(2);
  const args = rest[0] === '--' ? rest.slice(1) : rest;

  process.on('exit', release);
  for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    if (WINDOWS && name === 'SIGHUP') continue;
    process.on(name, () => onSignal(name));
  }

  if (mode === 'install') return install(args);
  if (mode === 'run') return run(args);
  fail('usage: node scripts/fabric-serial.js install [--allow-git=all] | run -- <command...>', 2);
}

main().then((code) => {
  release();
  process.exit(code);
}, (error) => {
  say(error && error.stack ? error.stack : String(error));
  release();
  process.exit(1);
});
