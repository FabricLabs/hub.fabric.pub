'use strict';

/**
 * One-shot transform: split Hub.start() into _startPhase_* methods + phased start().
 * Run from hub.fabric.pub: node scripts/extract-hub-start-phases.js
 */
const fs = require('fs');
const path = require('path');

const hubPath = path.join(__dirname, '..', 'services', 'hub.js');
const src = fs.readFileSync(hubPath, 'utf8');

const startMarker = '  async start () {\n    try {\n';
const startIdx = src.indexOf(startMarker);
if (startIdx < 0) throw new Error('start() marker not found');

const afterTry = startIdx + startMarker.length;
// Find matching catch for this try: look for "    } catch (err) {\n      console.error('[HUB:STARTUP:ERROR]'"
const catchMarker = "    } catch (err) {\n      console.error('[HUB:STARTUP:ERROR]'";
const catchIdx = src.indexOf(catchMarker, afterTry);
if (catchIdx < 0) throw new Error('catch marker not found');

const body = src.slice(afterTry, catchIdx);
const lines = body.split('\n');

/** @type {{ name: string, test: (line: string, i: number, lines: string[]) => boolean }[]} */
const cuts = [
  {
    name: 'filesystem',
    test: (line) => line.includes('await this.fs.start();')
  },
  {
    name: 'bitcoin',
    test: (line) => /^\s*if \(this\.bitcoin\) \{/.test(line)
  },
  {
    name: 'services',
    test: (line) => line.includes('if (this.payjoin && this.settings.payjoin')
  },
  {
    name: 'state',
    test: (line) => line.includes('// Load prior state')
  },
  {
    name: 'shell',
    test: (line) => line.includes('// Load HTML document from disk to serve from memory')
  },
  {
    name: 'routes',
    test: (line) => line.includes("this.http._addRoute('GET', '/api/developers'")
  },
  {
    name: 'rpc',
    test: (line) => line.includes('// Bind event listeners')
  },
  {
    name: 'listen',
    test: (line) => line.trim() === 'await this.agent.start();'
  },
  {
    name: 'runtime',
    test: (line) => line.includes('@fabric/http `start()` registers default RegisterWebRTCPeer') ||
      line.includes('@fabric/http `start()` registers default RegisterWebRTCPeer')
  }
];

const phaseOrder = [
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
];

const boundaries = [{ name: 'diagnostics', line: 0 }];
let cutIdx = 0;
for (let i = 0; i < lines.length && cutIdx < cuts.length; i++) {
  if (cuts[cutIdx].test(lines[i], i, lines)) {
    boundaries.push({ name: cuts[cutIdx].name, line: i });
    cutIdx++;
  }
}
if (cutIdx !== cuts.length) {
  throw new Error(`Only found ${cutIdx}/${cuts.length} cut markers. Last found: ${boundaries.map((b) => b.name).join(',')}`);
}

const chunks = {};
for (let b = 0; b < boundaries.length; b++) {
  const name = boundaries[b].name;
  const start = boundaries[b].line;
  const end = b + 1 < boundaries.length ? boundaries[b + 1].line : lines.length;
  chunks[name] = lines.slice(start, end).join('\n');
}

for (const name of phaseOrder) {
  if (!chunks[name] || !String(chunks[name]).trim()) {
    throw new Error(`Empty phase body: ${name}`);
  }
}

function indentMethodBody (chunk) {
  // chunk already has 6-space indent from being inside start(); methods need 4-space class + 2 for body = keep as-is if we put body at method indent 4 with content at 6
  return chunk.replace(/\s+$/, '');
}

let methods = '';
for (const name of phaseOrder) {
  methods += `\n  async _startPhase_${name} () {\n${indentMethodBody(chunks[name])}\n  }\n`;
}

const newStart = `  async start () {
    try {
      const { resolveStartPhases, runHubStartPhase } = require('../functions/hubLifecycle');
      const phases = resolveStartPhases(this);
      for (const phase of phases) {
        const fn = this[\`_startPhase_\${phase}\`];
        if (typeof fn !== 'function') {
          throw new Error(\`[HUB] missing start phase implementation: \${phase}\`);
        }
        await runHubStartPhase(this, phase, fn);
      }
      return this;
    } catch (err) {
      console.error('[HUB:STARTUP:ERROR]', err && err.stack ? err.stack : err);
      throw err;
    }
  }
`;

// Insert methods immediately before `async start ()`
const before = src.slice(0, startIdx);
const afterCatch = src.slice(catchIdx);
// afterCatch starts with `    } catch (err) {` which belonged to old start — replace old start+catch with newStart only
// Find end of old start method: after catch block ends with `  }\n\n  /**\n   * Stop`
const stopDoc = '\n  /**\n   * Stop the instance.';
const stopIdx = afterCatch.indexOf(stopDoc);
if (stopIdx < 0) throw new Error('stop doc marker not found after catch');
// afterCatch from 0 to stopIdx is the old catch+closing of start — discard, keep from stopDoc
const rest = afterCatch.slice(stopIdx);

const out = before + methods + '\n' + newStart + rest;
fs.writeFileSync(hubPath, out);
console.log('Wrote phased Hub.start. Phase line counts:');
for (const name of phaseOrder) {
  console.log(' ', name, chunks[name].split('\n').length);
}
