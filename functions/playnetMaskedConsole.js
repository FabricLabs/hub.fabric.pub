'use strict';

const util = require('util');

/**
 * Suppress noisy Hub / Fabric debug lines during integration tests (optional).
 * @param {{ patterns?: RegExp[] }} [opts]
 * @returns {function(): void} restore
 */
function installMaskedConsole (opts = {}) {
  const patterns = opts.patterns || [
    /\[HUB:AGENT:DEBUG\]/i,
    /\[FABRIC:EDGE\].*\bDEBUG\b/i,
    /\[BITCOIN\] \[DEBUG\]/i,
    /\[FABRIC:BITCOIN\].*RPC response/i,
    /\[FABRIC:EDGE\].*Access log opened/i,
    /\[FABRIC:EDGE\].*Unencrypted transport/i,
    /\[HUB\] Contract State:/i,
    /\[HUB\] Loaded DEVELOPERS\.md/i,
    /Socket error:.*sensemaker/i,
    /Socket timeout:.*sensemaker/i,
    /Outbound socket closed:.*hub\.fabric\.pub/i,
    /\[HUB:AGENT:DEBUG\].*Outbound socket closed/i,
    /debug error from _connect/i,
    /--- debug error from _connect/i,
    /^debug:/i
  ];
  const names = ['log', 'info', 'warn', 'debug', 'error'];
  const orig = {};
  function stringifyArg (a) {
    if (typeof a === 'string') return a;
    try {
      return util.inspect(a, { depth: 2, breakLength: 120 });
    } catch (_) {
      return String(a);
    }
  }
  function lineMatches (line) {
    return patterns.some((re) => re.test(line));
  }
  for (const n of names) {
    orig[n] = console[n];
    console[n] = (...args) => {
      const line = args.map(stringifyArg).join(' ');
      if (lineMatches(line)) return;
      orig[n].apply(console, args);
    };
  }
  return function restoreMaskedConsole () {
    for (const n of names) {
      console[n] = orig[n];
    }
  };
}

module.exports = { installMaskedConsole };
