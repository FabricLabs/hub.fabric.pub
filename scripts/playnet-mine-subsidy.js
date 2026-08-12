'use strict';

/**
 * Mine regtest through the full block-subsidy schedule, then stop when all
 * coinbases are mature (spendable).
 *
 * Bitcoin Core regtest uses consensus.nSubsidyHalvingInterval = 150 (not
 * mainnet's 210000). Subsidy is `50 BTC >> halvings` and becomes 0 once
 * halvings >= 33 (50e8 >> 33 === 0), i.e. from height 4950 onward.
 *
 * After the last rewarding block, mine COINBASE_MATURITY (100) more confirmations
 * (or until wallet `immature` balance is 0).
 *
 * Usage:
 *   npm run playnet:mine-subsidy -- [--dry-run] [--batch <n>] [--wallet <name>]
 *   npm run playnet:mine-subsidy -- --address <bcrt1…>
 *
 * Env:
 *   FABRIC_BITCOIN_DATADIR / FABRIC_BITCOIN_RPC_PORT
 *   FABRIC_REGTEST_HALVING_INTERVAL   default 150 (auto-detected when possible)
 *   FABRIC_COINBASE_MATURITY         default 100
 *   FABRIC_MINE_BATCH                default 50
 */

const {
  runBitcoinCli,
  bitcoinDatadir
} = require('./lib/playnetOps');

const COIN = 100000000n;

function printHelp () {
  console.log(`Usage:
  npm run playnet:mine-subsidy -- [options]

  --dry-run              Print plan only (no generatetoaddress)
  --batch <n>            Blocks per generatetoaddress call (default 50)
  --wallet <name>        Prefer this wallet for getnewaddress / balances
  --address <addr>       Mine to this address (skip getnewaddress)
  --halving-interval <n> Override regtest halving interval (default 150)
  --maturity <n>         Coinbase maturity confirmations (default 100)
  --max-blocks <n>       Safety cap on blocks generated this run (optional)

Mines until tip is past the last positive-subsidy height, then until all
wallet coinbases are mature (immature balance 0 and tip >= lastReward+maturity).
`);
}

function subsidySatsAtHeight (height, halvingInterval) {
  const h = Math.max(0, Number(height) | 0);
  const interval = Math.max(1, Number(halvingInterval) | 0);
  const halvings = Math.floor(h / interval);
  if (halvings >= 64) return 0n;
  return (50n * COIN) >> BigInt(halvings);
}

function lastPositiveSubsidyHeight (halvingInterval) {
  const interval = Math.max(1, Number(halvingInterval) | 0);
  // 50e8 >> 33 === 0; last positive era is halvings === 32
  return interval * 33 - 1;
}

function satsToBtc (sats) {
  const n = Number(sats);
  if (!Number.isFinite(n)) return String(sats);
  return (n / 1e8).toFixed(8);
}

async function detectHalvingInterval (fallback = 150) {
  try {
    const a = await runBitcoinCli(['getblockstats', '0'], { json: true });
    const b = await runBitcoinCli(['getblockstats', String(fallback)], { json: true });
    if (Number(a.subsidy) > 0 && Number(b.subsidy) > 0 && Number(b.subsidy) === Number(a.subsidy) / 2) {
      return fallback;
    }
  } catch (_) {}
  // Probe common values
  for (const candidate of [150, 210000]) {
    try {
      const genesis = await runBitcoinCli(['getblockstats', '0'], { json: true });
      const at = await runBitcoinCli(['getblockstats', String(candidate)], { json: true });
      if (Number(genesis.subsidy) > Number(at.subsidy) && Number(at.subsidy) * 2 === Number(genesis.subsidy)) {
        return candidate;
      }
    } catch (_) {}
  }
  return fallback;
}

async function listWalletNames () {
  try {
    const loaded = await runBitcoinCli(['listwallets'], { json: true });
    if (Array.isArray(loaded) && loaded.length) return loaded.map(String);
  } catch (_) {}
  return [];
}

async function ensureWalletLoaded (preferred) {
  let loaded = await listWalletNames();
  if (preferred && !loaded.includes(preferred)) {
    try {
      await runBitcoinCli(['loadwallet', preferred]);
      loaded = await listWalletNames();
    } catch (e) {
      console.warn('[mine-subsidy] loadwallet failed:', e.message || e);
    }
  }
  if (!loaded.length) {
    // Try listing wallet dirs and loading the first
    try {
      const dir = await runBitcoinCli(['listwalletdir'], { json: true });
      const names = (dir && Array.isArray(dir.wallets) ? dir.wallets : [])
        .map((w) => (w && w.name != null ? String(w.name) : ''))
        .filter(Boolean);
      for (const name of names) {
        try {
          await runBitcoinCli(['loadwallet', name]);
        } catch (_) {}
      }
      loaded = await listWalletNames();
    } catch (_) {}
  }
  if (!loaded.length) {
    const name = preferred || 'playnet-miner';
    try {
      await runBitcoinCli(['createwallet', name]);
      loaded = [name];
    } catch (e) {
      throw new Error(`no wallet available (${e.message || e}); datadir=${bitcoinDatadir()}`);
    }
  }
  if (preferred && loaded.includes(preferred)) return preferred;
  return loaded[0];
}

function walletArgs (walletName) {
  return walletName ? [`-rpcwallet=${walletName}`] : [];
}

async function getBalances (walletName) {
  return runBitcoinCli([...walletArgs(walletName), 'getbalances'], { json: true });
}

async function getMiningAddress (walletName, explicit) {
  if (explicit) return String(explicit).trim();
  return String(await runBitcoinCli([...walletArgs(walletName), 'getnewaddress', '', 'bech32'])).trim();
}

async function generateBlocks (walletName, address, count) {
  const n = Math.max(0, Number(count) | 0);
  if (!n) return [];
  const hashes = await runBitcoinCli(
    [...walletArgs(walletName), 'generatetoaddress', String(n), address],
    { json: true }
  );
  return Array.isArray(hashes) ? hashes : [];
}

async function main () {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  let dryRun = false;
  let batch = Number(process.env.FABRIC_MINE_BATCH || 50);
  let walletName = process.env.FABRIC_BITCOIN_WALLET || '';
  let address = '';
  let halvingInterval = Number(process.env.FABRIC_REGTEST_HALVING_INTERVAL || 0);
  let maturity = Number(process.env.FABRIC_COINBASE_MATURITY || 100);
  let maxBlocks = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') dryRun = true;
    else if (a === '--batch') batch = Math.max(1, Number(argv[++i] || batch));
    else if (a === '--wallet') walletName = String(argv[++i] || '');
    else if (a === '--address') address = String(argv[++i] || '');
    else if (a === '--halving-interval') halvingInterval = Math.max(1, Number(argv[++i] || 150));
    else if (a === '--maturity') maturity = Math.max(1, Number(argv[++i] || 100));
    else if (a === '--max-blocks') maxBlocks = Math.max(1, Number(argv[++i] || 1));
    else if (a.startsWith('-')) {
      console.error('Unknown flag:', a);
      printHelp();
      process.exit(1);
    }
  }

  const info = await runBitcoinCli(['getblockchaininfo'], { json: true });
  if (String(info.chain) !== 'regtest') {
    throw new Error(`refusing to mine subsidy on non-regtest chain "${info.chain}"`);
  }

  if (!halvingInterval) {
    halvingInterval = await detectHalvingInterval(150);
  }

  const lastRewardHeight = lastPositiveSubsidyHeight(halvingInterval);
  const matureTipTarget = lastRewardHeight + maturity;
  let tip = Number(info.blocks);
  const tipSubsidy = subsidySatsAtHeight(tip, halvingInterval);

  // Sum theoretical total subsidy 0..lastRewardHeight for reporting
  let totalSubsidy = 0n;
  for (let h = 0; h <= lastRewardHeight; h++) {
    totalSubsidy += subsidySatsAtHeight(h, halvingInterval);
  }

  console.log('[mine-subsidy] plan', {
    chain: info.chain,
    tip,
    tipSubsidySats: tipSubsidy.toString(),
    tipSubsidyBtc: satsToBtc(tipSubsidy),
    halvingInterval,
    lastRewardHeight,
    matureTipTarget,
    totalScheduleSubsidyBtc: satsToBtc(totalSubsidy),
    maturity,
    batch,
    dryRun
  });

  walletName = await ensureWalletLoaded(walletName || undefined);
  address = await getMiningAddress(walletName, address);
  let balances = await getBalances(walletName);
  console.log('[mine-subsidy] wallet', {
    name: walletName,
    address,
    balances: balances && balances.mine
  });

  let generated = 0;
  const bumpGenerated = (n) => {
    generated += n;
    if (maxBlocks != null && generated > maxBlocks) {
      throw new Error(`hit --max-blocks=${maxBlocks} (generated ${generated})`);
    }
  };

  // Phase A: mine through last positive-subsidy block
  if (tip < lastRewardHeight) {
    const need = lastRewardHeight - tip;
    console.log('[mine-subsidy] phase A: mining subsidy', { need, toHeight: lastRewardHeight });
    if (!dryRun) {
      let remaining = need;
      while (remaining > 0) {
        const n = Math.min(batch, remaining);
        if (maxBlocks != null) {
          const room = maxBlocks - generated;
          if (room <= 0) throw new Error(`hit --max-blocks=${maxBlocks}`);
          const take = Math.min(n, room);
          const hashes = await generateBlocks(walletName, address, take);
          bumpGenerated(hashes.length);
          remaining -= hashes.length;
        } else {
          const hashes = await generateBlocks(walletName, address, n);
          bumpGenerated(hashes.length);
          remaining -= hashes.length;
        }
        tip = Number(await runBitcoinCli(['getblockcount']));
        if (tip % 500 < batch || remaining <= 0) {
          console.log('[mine-subsidy] progress', { tip, remaining, generated });
        }
      }
    } else {
      console.log('[mine-subsidy] dry-run skip phase A', { wouldMine: need });
    }
  } else {
    console.log('[mine-subsidy] phase A: skip (tip already past last reward height)');
  }

  tip = Number(await runBitcoinCli(['getblockcount']));
  balances = dryRun ? balances : await getBalances(walletName);

  // Phase B: maturity — tip past last reward + maturity, and immature == 0
  const immature = () => {
    const v = balances && balances.mine && balances.mine.immature;
    return Number(v) || 0;
  };

  if (tip < matureTipTarget || immature() > 0) {
    console.log('[mine-subsidy] phase B: maturity', {
      tip,
      matureTipTarget,
      immatureBtc: immature()
    });
    if (!dryRun) {
      while (true) {
        tip = Number(await runBitcoinCli(['getblockcount']));
        balances = await getBalances(walletName);
        const imm = immature();
        if (tip >= matureTipTarget && imm <= 0) break;

        let need = 0;
        if (tip < matureTipTarget) need = Math.max(need, matureTipTarget - tip);
        // If immature remains after schedule maturity tip, keep confirming (~maturity window)
        if (imm > 0) need = Math.max(need, 1);
        const n = Math.min(batch, Math.max(need, 1));
        if (maxBlocks != null && generated + n > maxBlocks) {
          const room = maxBlocks - generated;
          if (room <= 0) throw new Error(`hit --max-blocks=${maxBlocks} before maturity`);
          const hashes = await generateBlocks(walletName, address, room);
          bumpGenerated(hashes.length);
          balances = await getBalances(walletName);
          tip = Number(await runBitcoinCli(['getblockcount']));
          if (immature() > 0 || tip < matureTipTarget) {
            throw new Error(`hit --max-blocks=${maxBlocks} before maturity (tip=${tip}, immature=${immature()})`);
          }
          break;
        }
        const hashes = await generateBlocks(walletName, address, n);
        bumpGenerated(hashes.length);
        if (generated % 200 < batch) {
          console.log('[mine-subsidy] maturity progress', {
            tip: Number(await runBitcoinCli(['getblockcount'])),
            immatureBtc: (await getBalances(walletName)).mine.immature,
            generated
          });
        }
      }
    } else {
      const needTip = Math.max(0, matureTipTarget - tip);
      console.log('[mine-subsidy] dry-run skip phase B', {
        wouldMineAtLeast: needTip,
        note: 'plus any extras until immature balance is 0'
      });
    }
  } else {
    console.log('[mine-subsidy] phase B: skip (already mature)');
  }

  tip = Number(await runBitcoinCli(['getblockcount']));
  const tipHash = String(await runBitcoinCli(['getbestblockhash'])).trim();
  balances = await getBalances(walletName);
  const tipStats = await runBitcoinCli(['getblockstats', String(tip)], { json: true });

  console.log('[mine-subsidy] done', {
    tip,
    tipHash,
    tipSubsidySats: Number(tipStats.subsidy),
    generated,
    dryRun,
    balances: balances && balances.mine,
    scheduleComplete: tip >= lastRewardHeight,
    maturityComplete: tip >= matureTipTarget && immature() <= 0
  });
}

main().catch((err) => {
  console.error('[mine-subsidy]', err && err.message ? err.message : err);
  process.exit(1);
});
