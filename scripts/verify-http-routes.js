'use strict';

/**
 * Enumerate expected Fabric Hub HTTP GET routes, probe JSON + HTML Accept,
 * discard HTML bodies, report missing handlers, and compare JSON to known schemas.
 *
 * Usage:
 *   node scripts/verify-http-routes.js
 *   node scripts/verify-http-routes.js --hub http://127.0.0.1:8080
 *   FABRIC_HUB_RPC_URL=http://127.0.0.1:8080 npm run test:e2e-http-routes
 *
 * Flags:
 *   --hub <url>                 Hub HTTP origin (default FABRIC_HUB_RPC_URL / FABRIC_HUB_URL / http://127.0.0.1:8080)
 *   --include-optional          Include optional catalog routes (default on)
 *   --no-optional               Skip optional routes
 *   --include-parameterized     Probe catalog examples for parameterized paths
 *   --no-sitemap                Do not merge /sitemap.xml URLs
 *   --strict-schemas            Fail exit code on JSON Schema mismatches (required routes)
 *   --json                      Print full JSON report
 *   --quiet                     Only print summary lines
 */

const {
  normalizeOriginBase,
  runHttpRouteProbe
} = require('../functions/httpRouteProbe');

function parseArgs (argv) {
  const out = {
    hub: process.env.FABRIC_HUB_RPC_URL || process.env.FABRIC_HUB_URL || 'http://127.0.0.1:8080',
    includeOptional: true,
    includeParameterized: false,
    useSitemap: true,
    strictSchemas: false,
    json: false,
    quiet: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--hub' || a === '--origin' || a === '--base') {
      out.hub = argv[++i];
    } else if (a.startsWith('--hub=')) {
      out.hub = a.slice('--hub='.length);
    } else if (a === '--include-optional') {
      out.includeOptional = true;
    } else if (a === '--no-optional') {
      out.includeOptional = false;
    } else if (a === '--include-parameterized') {
      out.includeParameterized = true;
    } else if (a === '--no-sitemap') {
      out.useSitemap = false;
    } else if (a === '--strict-schemas') {
      out.strictSchemas = true;
    } else if (a === '--json') {
      out.json = true;
    } else if (a === '--quiet') {
      out.quiet = true;
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    }
  }
  return out;
}

function printReport (report, opts) {
  if (opts.json) {
    // Strip large JSON bodies unless schema failed (keep failures diagnosable).
    const slim = Object.assign({}, report, {
      results: report.results.map((r) => {
        const copy = Object.assign({}, r, {
          json: Object.assign({}, r.json)
        });
        if (r.schema && r.schema.ok !== false) {
          copy.json.body = undefined;
        }
        return copy;
      })
    });
    console.log(JSON.stringify(slim, null, 2));
    return;
  }

  if (!opts.quiet) {
    console.log(`[http-routes] origin=${report.origin} routes=${report.routeCount}` +
      (report.arc ? ` arc=${report.arc.name}` : ' arc=(none)'));
  }

  const { summary } = report;
  if (summary.missingBoth.length) {
    console.log(`[http-routes] missing handlers for BOTH json+html (${summary.missingBoth.length}):`);
    for (const p of summary.missingBoth) console.log(`  - ${p}`);
  } else if (!opts.quiet) {
    console.log('[http-routes] no routes missing both JSON and HTML handlers');
  }

  if (!opts.quiet) {
    if (summary.missingJson.length) {
      console.log(`[http-routes] missing JSON handler (${summary.missingJson.length}):`);
      for (const row of summary.missingJson) {
        console.log(`  - ${row.path}  status=${row.status}  reason=${row.reason}`);
      }
    }
    if (summary.missingHtml.length) {
      console.log(`[http-routes] missing HTML handler (${summary.missingHtml.length}):`);
      for (const row of summary.missingHtml) {
        console.log(`  - ${row.path}  status=${row.status}  reason=${row.reason}`);
      }
    }
    if (summary.schemaFailures.length) {
      console.log(`[http-routes] schema mismatches (${summary.schemaFailures.length}):`);
      for (const row of summary.schemaFailures) {
        console.log(`  - ${row.path}  schema=${row.schemaId}`);
        for (const err of row.errors || []) console.log(`      ${err}`);
      }
    } else {
      console.log('[http-routes] known schemas: all probed JSON bodies matched (or skipped)');
    }
  }

  console.log(`[http-routes] ok=${summary.ok}`);
}

async function main () {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(`Usage: node scripts/verify-http-routes.js [--hub URL] [--strict-schemas] [--json]
Env: FABRIC_HUB_RPC_URL / FABRIC_HUB_URL`);
    process.exit(0);
  }

  const origin = normalizeOriginBase(opts.hub);
  if (!origin) {
    console.error('[http-routes] invalid hub origin');
    process.exit(2);
  }

  let report;
  try {
    report = await runHttpRouteProbe({
      origin,
      includeOptional: opts.includeOptional,
      includeParameterized: opts.includeParameterized,
      useSitemap: opts.useSitemap,
      strictSchemas: opts.strictSchemas
    });
  } catch (err) {
    console.error('[http-routes] probe failed:', err && err.message ? err.message : err);
    process.exit(1);
  }

  printReport(report, opts);
  process.exit(report.summary.ok ? 0 : 1);
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, printReport, main };
