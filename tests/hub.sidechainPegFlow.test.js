'use strict';

/**
 * In-process Hub flow: sidechain startup → peg-in credit seal → peg-out propose →
 * vault PSBT prepare → burn seal → settle payout.
 *
 * Tip-bound withdrawals require Prepare while the sidechain tip still matches the
 * propose-time digest (seal burn after prepare). No live bitcoind.
 */

const assert = require('assert');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@fabric/core/types/ecc');
const Key = require('@fabric/core/types/key');
const Hub = require('../services/hub');
const sidechainState = require('../functions/sidechainState');
const federationReserveLedger = require('../functions/federationReserveLedger');
const federationVault = require('../functions/federationVault');

bitcoin.initEccLib(ecc);

const ecpairMod = require('ecpair');
const ECPairFactory = typeof ecpairMod === 'function'
  ? ecpairMod
  : (ecpairMod.default || ecpairMod.ECPairFactory);
const ecpair = ECPairFactory(ecc);

const BLOCK_HASH = 'aa'.repeat(32);
const DEPOSIT_TXID = 'ab'.repeat(32);
const PAYOUT_TXID = 'cd'.repeat(32);
const DEPOSIT_SATS = 100000;
const WITHDRAW_SATS = 25000;
const FEE_SATS = 1000;

function regtestP2wpkhDest () {
  return bitcoin.payments.p2wpkh({
    pubkey: ecpair.makeRandom().publicKey,
    network: bitcoin.networks.regtest
  }).address;
}

describe('Hub sidechain peg flow (startup → deposit → withdraw)', function () {
  this.timeout(60000);

  let validatorKey;
  let prevValidators;
  let prevThreshold;

  before(function () {
    validatorKey = new Key({
      private: '1111111111111111111111111111111111111111111111111111111111111111'
    });
    prevValidators = process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    prevThreshold = process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
    process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = String(validatorKey.pubkey);
    process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = '1';
  });

  after(function () {
    if (prevValidators == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS;
    else process.env.FABRIC_DISTRIBUTED_FEDERATION_VALIDATORS = prevValidators;
    if (prevThreshold == null) delete process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD;
    else process.env.FABRIC_DISTRIBUTED_FEDERATION_THRESHOLD = prevThreshold;
  });

  function makeHub () {
    const hub = new Hub({
      debug: false,
      persistent: false,
      bitcoin: { enable: false },
      payjoin: { enable: false },
      distributed: {
        federation: {
          validators: [validatorKey.pubkey],
          threshold: 1
        }
      }
    });

    const fsStore = new Map();
    hub.fs = {
      readFile: (name) => {
        const v = fsStore.get(name);
        return v != null ? Buffer.from(v, 'utf8') : null;
      },
      writeFile: (name, content) => {
        fsStore.set(name, typeof content === 'string' ? content : content.toString('utf8'));
        return true;
      },
      publish: async (name, value) => {
        fsStore.set(name, typeof value === 'string' ? value : JSON.stringify(value));
      }
    };
    hub.setup = {
      verifyAdminToken: (token) => Boolean(token)
    };
    hub._sidechainSerialize = (fn) => fn();
    hub._sidechainState = sidechainState.loadState(hub.fs);
    hub._beaconEpochState = {
      lastBlockHash: BLOCK_HASH,
      height: 200
    };
    hub._getBitcoinService = () => ({ network: 'regtest' });
    return hub;
  }

  async function sealPatches (hub, patches) {
    const state = hub._sidechainState || sidechainState.loadState(hub.fs);
    const basisClock = Number(state.clock) || 0;
    const basisDigest = sidechainState.stateDigest(state);
    const proposal = { basisClock, basisDigest, patches };
    const federationWitness = sidechainState.buildFederationWitnessForSidechainPatch({
      proposal,
      signKey: validatorKey,
      validators: [validatorKey.pubkey],
      threshold: 1
    });
    assert.ok(federationWitness, 'federation witness');
    const out = await hub._submitSidechainStatePatch({
      patches,
      basisClock,
      federationWitness
    });
    assert.strictEqual(out.status, undefined, out.message || JSON.stringify(out));
    assert.ok(out.stateDigest || out.type === 'SubmitSidechainStatePatchResult' || out.clock != null, out);
    return out;
  }

  function fundedVaultTxHex (hub, vaultAddress, amountSats) {
    const validators = hub._distributedFederationValidatorsFromEnv();
    const threshold = hub._distributedFederationThresholdEffective();
    const vaultOpts = hub._federationVaultBuildOpts(validators);
    const built = federationVault.buildFederationVaultFromPolicy({
      validators,
      threshold,
      networkName: 'regtest',
      publisher: vaultOpts.publisher,
      csvBlocks: vaultOpts.csvBlocks,
      softMode: vaultOpts.softMode,
      internalKeyMode: vaultOpts.internalKeyMode
    });
    assert.strictEqual(built.address, vaultAddress, 'funded tx must pay Hub vault address');
    const tx = new bitcoin.Transaction();
    tx.version = 2;
    tx.addInput(Buffer.alloc(32, 1), 0);
    tx.addOutput(built.output, amountSats);
    return tx.toHex();
  }

  it('runs complete sidechain startup, peg-in, peg-out prepare, burn seal, and settle', async function () {
    const hub = makeHub();

    // --- Startup ---
    const boot = hub._getSidechainStateJson();
    assert.strictEqual(boot.type, 'SidechainState');
    assert.strictEqual(boot.clock, 0);
    assert.ok(boot.stateDigest);
    assert.ok(boot.policy && Array.isArray(boot.policy.allowedPathPrefixes));
    assert.ok(boot.policy.allowedPathPrefixes.includes('/federationReserve'));
    assert.deepStrictEqual(boot.content || {}, {});

    // --- Deposit (peg-in credit) ---
    const credit = hub._rpcCreateFederationPegInCredit({
      adminToken: 'test-admin',
      txid: DEPOSIT_TXID,
      vout: 0,
      amountSats: DEPOSIT_SATS,
      confirmations: 200,
      vaultConfirmedSats: DEPOSIT_SATS
    });
    assert.strictEqual(credit.status, 'success', credit.message);
    assert.ok(Array.isArray(credit.patches) && credit.patches.length);
    assert.strictEqual(credit.reserve.outstandingSats, DEPOSIT_SATS);
    assert.strictEqual(credit.reserve.vaultConfirmedSats, DEPOSIT_SATS);

    const sealedIn = await sealPatches(hub, credit.patches);
    assert.strictEqual(Number(sealedIn.clock), 1);

    const afterIn = hub._getSidechainStateJson();
    assert.strictEqual(afterIn.clock, 1);
    const reserveIn = federationReserveLedger.readReserve(afterIn.content);
    assert.strictEqual(reserveIn.outstandingSats, DEPOSIT_SATS);
    assert.strictEqual(reserveIn.deposits.length, 1);
    assert.strictEqual(String(reserveIn.deposits[0].txid).toLowerCase(), DEPOSIT_TXID);

    // --- Withdrawal propose (tip-bound) ---
    const dest = regtestP2wpkhDest();
    const proposed = hub._rpcProposeFederationPegOut({
      adminToken: 'test-admin',
      amountSats: WITHDRAW_SATS,
      feeSats: FEE_SATS,
      destinationAddress: dest,
      vaultConfirmedSats: DEPOSIT_SATS
    });
    assert.strictEqual(proposed.status, 'success', proposed.message);
    assert.ok(proposed.withdrawalRequest);
    assert.ok(Array.isArray(proposed.burnPatches) && proposed.burnPatches.length);
    assert.strictEqual(proposed.withdrawalRequest.amountSats, WITHDRAW_SATS);
    assert.strictEqual(proposed.tip.bitcoinBlockHash, BLOCK_HASH);
    assert.strictEqual(proposed.tip.stateDigest, afterIn.stateDigest);

    // --- Prepare vault PSBT while tip still matches propose (before burn seal) ---
    const fundedTxHex = fundedVaultTxHex(hub, proposed.vaultAddress, DEPOSIT_SATS);
    const prepared = hub._rpcPrepareFederationVaultWithdrawalPsbt({
      adminToken: 'test-admin',
      withdrawalRequest: proposed.withdrawalRequest,
      fundedTxHex,
      vaultConfirmedSats: DEPOSIT_SATS,
      requirePriorBurn: false
    });
    assert.ok(!prepared.status || prepared.status !== 'error', prepared.message);
    assert.ok(prepared.psbtBase64 || prepared.psbt || prepared.type === 'PrepareFederationVaultWithdrawalPsbtResult',
      JSON.stringify(Object.keys(prepared)));
    assert.strictEqual(Number(prepared.destSats), WITHDRAW_SATS);

    // --- Seal burn ---
    const sealedBurn = await sealPatches(hub, proposed.burnPatches);
    assert.strictEqual(Number(sealedBurn.clock), 2);

    const afterBurn = hub._getSidechainStateJson();
    const reserveBurn = federationReserveLedger.readReserve(afterBurn.content);
    assert.strictEqual(reserveBurn.outstandingSats, DEPOSIT_SATS - WITHDRAW_SATS);
    assert.strictEqual(reserveBurn.pendingBurnsSats, WITHDRAW_SATS);
    assert.strictEqual(reserveBurn.withdrawals.length, 1);
    assert.strictEqual(reserveBurn.withdrawals[0].status, 'pending');
    assert.strictEqual(
      String(reserveBurn.withdrawals[0].requestId).toLowerCase(),
      String(proposed.withdrawalRequest.requestId).toLowerCase()
    );

    // --- Settle after simulated L1 payout confirm ---
    const settledVault = DEPOSIT_SATS - WITHDRAW_SATS;
    const settled = federationReserveLedger.settlePegOutPayout(
      afterBurn.content,
      proposed.withdrawalRequest.requestId,
      {
        vaultConfirmedSats: settledVault,
        payout: {
          txid: PAYOUT_TXID,
          vout: 0,
          amountSats: WITHDRAW_SATS,
          destinationAddress: dest,
          confirmations: 1
        }
      }
    );
    assert.strictEqual(settled.ok, true, settled.error);
    assert.strictEqual(settled.reserve.pendingBurnsSats, 0);
    assert.strictEqual(settled.reserve.vaultConfirmedSats, settledVault);
    assert.strictEqual(settled.reserve.withdrawals[0].status, 'settled');

    const sealedSettle = await sealPatches(
      hub,
      federationReserveLedger.patchesForReserve(settled.reserve)
    );
    assert.strictEqual(Number(sealedSettle.clock), 3);

    const finalState = hub._getSidechainStateJson();
    assert.strictEqual(finalState.clock, 3);
    const finalReserve = federationReserveLedger.readReserve(finalState.content);
    assert.strictEqual(finalReserve.outstandingSats, DEPOSIT_SATS - WITHDRAW_SATS);
    assert.strictEqual(finalReserve.pendingBurnsSats, 0);
    assert.strictEqual(finalReserve.vaultConfirmedSats, settledVault);
    assert.strictEqual(finalReserve.withdrawals[0].status, 'settled');
    assert.strictEqual(federationReserveLedger.assertConservation(finalReserve).ok, true);

    const journal = hub._getSidechainJournalJson({ limit: 10 });
    assert.ok(journal.entries && journal.entries.length >= 3, 'journal should record seals');
  });
});
