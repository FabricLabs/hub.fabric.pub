'use strict';

/**
 * Resolve playnet L1 signals: sidechain OP_RETURN / watch-address outs, optional payment verify.
 *
 * Usage:
 *   npm run playnet:l1-resolve -- [--height <n>] [--hash <64hex>] [--count <n>]
 *   npm run playnet:l1-resolve -- --verify <txid> --address <addr> --amount-sats <n>
 *
 * Env:
 *   FABRIC_HUB_RPC_URL                 for --verify (VerifyBitcoinL1Payment)
 *   FABRIC_SIDECHAIN_OP_RETURN_MAGIC   default fab100
 *   FABRIC_SIDECHAIN_WATCH_ADDRESSES   comma-separated
 *   FABRIC_BITCOIN_DATADIR / FABRIC_BITCOIN_RPC_PORT
 */

const {
  runBitcoinCli,
  hubRpcBase,
  hubRpc
} = require('./lib/playnetOps');
const {
  parseVerboseBlockForSidechainSignals
} = require('../functions/sidechainBlockScan');

function printHelp () {
  console.log(`Usage:
  npm run playnet:l1-resolve -- [--height <n>|--hash <64hex>] [--count <n>]
  npm run playnet:l1-resolve -- --verify <txid> --address <addr> --amount-sats <n>

  Scans recent regtest blocks for OP_RETURN magic + watched addresses (same
  policy as Hub bitcoin.sidechainScan). Optional --verify calls Hub
  VerifyBitcoinL1Payment.
`);
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let height = null;
  let hash = '';
  let count = Number(process.env.FABRIC_L1_RESOLVE_COUNT || 3);
  let verifyTxid = '';
  let verifyAddress = '';
  let verifyAmountSats = null;
  let hubUrl = hubRpcBase();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--height') height = Number(argv[++i]);
    else if (a === '--hash') hash = String(argv[++i] || '').trim().toLowerCase();
    else if (a === '--count') count = Math.max(1, Number(argv[++i] || 1));
    else if (a === '--verify') verifyTxid = String(argv[++i] || '').trim();
    else if (a === '--address') verifyAddress = String(argv[++i] || '').trim();
    else if (a === '--amount-sats') verifyAmountSats = Number(argv[++i]);
    else if (a === '--hub') hubUrl = String(argv[++i] || '').replace(/\/$/, '');
  }

  if (verifyTxid) {
    if (!verifyAddress || !Number.isFinite(verifyAmountSats)) {
      throw new Error('--verify requires --address and --amount-sats');
    }
    const result = await hubRpc('VerifyBitcoinL1Payment', {
      txid: verifyTxid,
      address: verifyAddress,
      amountSats: verifyAmountSats
    }, { baseUrl: hubUrl });
    console.log('[playnet:l1] VerifyBitcoinL1Payment', result);
    return;
  }

  const magic = String(process.env.FABRIC_SIDECHAIN_OP_RETURN_MAGIC || 'fab100')
    .toLowerCase()
    .replace(/^0x/, '');
  const watchAddresses = String(process.env.FABRIC_SIDECHAIN_WATCH_ADDRESSES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const cfg = {
    opReturnMagicHex: magic,
    watchAddresses,
    recordTimelocks: true
  };

  const tipInfo = await runBitcoinCli(['getblockchaininfo'], { json: true });
  const tipHeight = Number(tipInfo.blocks);
  console.log('[playnet:l1] tip', {
    height: tipHeight,
    best: tipInfo.bestblockhash,
    ibd: tipInfo.initialblockdownload
  });

  const targets = [];
  if (hash) {
    const hdr = await runBitcoinCli(['getblockheader', hash, 'true'], { json: true });
    targets.push({ hash, height: Number(hdr.height) });
  } else if (Number.isFinite(height)) {
    const h = await runBitcoinCli(['getblockhash', String(height)]);
    targets.push({ hash: String(h).trim(), height });
  } else {
    const start = Math.max(0, tipHeight - (count - 1));
    for (let h = start; h <= tipHeight; h++) {
      const bh = String(await runBitcoinCli(['getblockhash', String(h)])).trim();
      targets.push({ hash: bh, height: h });
    }
  }

  let totalSignals = 0;
  for (const t of targets) {
    const block = await runBitcoinCli(['getblock', t.hash, '2'], { json: true });
    const signals = parseVerboseBlockForSidechainSignals(block, t.height, cfg);
    totalSignals += signals.length;
    console.log('[playnet:l1] block', {
      height: t.height,
      hash: t.hash,
      tx: Array.isArray(block.tx) ? block.tx.length : null,
      signals: signals.length
    });
    for (const s of signals) {
      console.log('  ', s);
    }
  }

  console.log('[playnet:l1] done', { blocksScanned: targets.length, totalSignals });
}

main().catch((err) => {
  console.error('[playnet:l1]', err && err.message ? err.message : err);
  process.exit(1);
});
