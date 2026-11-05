'use strict';

/**
 * @fileoverview BIP78 sender for the Hub wallet (bitcoind RPC).
 *
 * 1. Check the `pj=` endpoint ({@link module:payjoinEndpointPolicy}): https or
 *    .onion, no userinfo, and (when the Hub dials) no private or local host,
 *    including after DNS resolution. Redirects are refused.
 * 2. Build and sign the original with the Hub wallet (`SIGHASH_ALL`, RBF,
 *    explicit fee rate); its coins stay locked while the receiver answers.
 * 3. POST it with `v=1`, `additionalfeeoutputindex` (our change),
 *    `maxadditionalfeecontribution`, `minfeerate`, and
 *    `disableoutputsubstitution=true`, under a timeout and a size cap.
 * 4. Check the proposal ({@link module:payjoinBrowserWallet.checkPayjoinProposal}):
 *    our inputs all there, in order, unsigned; no outputs added or removed;
 *    the payee not lowered; the fee not lowered; our fee contribution capped;
 *    receiver inputs signed, of our script type, and not our own coins.
 * 5. Sign only our inputs, check the wallet changed nothing,
 *    `testmempoolaccept`, then broadcast.
 *
 * Any failure throws `{ code, message }` and broadcasts **nothing** (the
 * original is never sent as a fallback); the original's coins are unlocked.
 */

const bitcoin = require('bitcoinjs-lib');
const {
  parseBitcoinUriForPayjoin,
  postPayjoinProposal,
  checkPayjoinProposal,
  outpointOfTxInput,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS
} = require('./payjoinBrowserWallet');
const { checkPayjoinEndpoint, isMainnet, isPrivateHost } = require('./payjoinEndpointPolicy');
const { networkForFabricName, MAX_MONEY_SATS } = require('./payjoinReceiverContribution');

const DEFAULT_MAX_FEE_CONTRIBUTION_SATS = 1000;

/** @private */
function senderError (code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** @private */
async function defaultLookup (hostname) {
  const dns = require('dns').promises;
  const rows = await dns.lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => r.address);
}

/**
 * Pay a BIP21 URI with `pj=` from the Hub wallet.
 * @param {Object} opts
 * @param {string} opts.bip21
 * @param {Function} opts.rpc `(method, params) => Promise` scoped to the Hub wallet
 * @param {string} [opts.networkName]
 * @param {number} [opts.feeRateSatVb=2]
 * @param {number} [opts.maxAdditionalFeeContributionSats=1000]
 * @param {number} [opts.timeoutMs=30000]
 * @param {number} [opts.maxResponseBytes=100000]
 * @param {(boolean|null)} [opts.allowInsecureEndpoints] null = allowed off mainnet only
 * @param {boolean} [opts.dryRun] build and check the original, unlock, and stop before the POST
 * @param {Function} [opts.fetchFn]
 * @param {Function} [opts.lookup] `(hostname) => Promise<string[]>` (DNS; tests)
 * @param {Function} [opts.onStage] `(stage, data) => void`
 * @param {Function} [opts.isCancelled] `() => boolean`, checked before the POST and before broadcast
 * @returns {Promise<{ txid: (string|undefined), originalTxid: string, address: string, amountSats: number, check: (Object|undefined), dryRun: boolean }>}
 */
async function sendPayjoin (opts = {}) {
  const rpc = opts.rpc;
  if (typeof rpc !== 'function') throw senderError('unavailable', 'Hub wallet RPC is required for a Payjoin send.');
  const networkName = String(opts.networkName || 'mainnet');
  const network = networkForFabricName(networkName);
  const insecure = opts.allowInsecureEndpoints == null ? !isMainnet(networkName) : !!opts.allowInsecureEndpoints && !isMainnet(networkName);
  const stage = (name, data) => { if (typeof opts.onStage === 'function') opts.onStage(name, data || {}); };
  const cancelled = () => typeof opts.isCancelled === 'function' && opts.isCancelled();

  const parsed = parseBitcoinUriForPayjoin(opts.bip21, { networkName, allowInsecure: insecure, privateHosts: false });
  if (!parsed) {
    const raw = String(opts.bip21 || '');
    const pj = (raw.match(/[?&]pj=([^&]+)/i) || [])[1];
    const why = pj ? checkPayjoinEndpoint(decodeURIComponent(pj), { networkName, allowInsecure: insecure, privateHosts: false }).error : 'no pj= endpoint';
    throw senderError('invalid-uri', `Not a payable Payjoin URI: ${why || 'invalid BIP21'}.`);
  }
  const amountSats = Number(parsed.amountSats);
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw senderError('invalid-uri', 'The Payjoin URI must carry an amount.');
  try {
    bitcoin.address.toOutputScript(parsed.address, network);
  } catch (_) {
    throw senderError('invalid-uri', `The Payjoin URI address is not valid on ${networkName}.`);
  }

  const host = new URL(parsed.pjUrl).hostname.replace(/^\[|\]$/g, '');
  if (!insecure && !host.endsWith('.onion')) {
    let addresses;
    try {
      addresses = await (typeof opts.lookup === 'function' ? opts.lookup : defaultLookup)(host);
    } catch (err) {
      throw senderError('endpoint-refused', `Could not resolve the Payjoin endpoint ${host}: ${err.message}`);
    }
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((a) => isPrivateHost(a))) {
      throw senderError('endpoint-refused', `The Payjoin endpoint ${host} resolves to a private or local address.`);
    }
  }

  const feeRate = Number(opts.feeRateSatVb) > 0 ? Number(opts.feeRateSatVb) : 2;
  const maxFee = Number.isSafeInteger(Number(opts.maxAdditionalFeeContributionSats)) && Number(opts.maxAdditionalFeeContributionSats) >= 0
    ? Number(opts.maxAdditionalFeeContributionSats)
    : DEFAULT_MAX_FEE_CONTRIBUTION_SATS;

  let locked = [];
  const unlock = async () => {
    if (!locked.length) return;
    try {
      await rpc('lockunspent', [true, locked]);
    } catch (_) {}
    locked = [];
  };

  try {
    let funded;
    try {
      funded = await rpc('walletcreatefundedpsbt', [
        [],
        [{ [parsed.address]: Number((amountSats / 1e8).toFixed(8)) }],
        0,
        { fee_rate: feeRate, replaceable: true, lockUnspents: true, includeWatching: false },
        true
      ]);
    } catch (err) {
      throw senderError('original-build-failed', `Could not fund the original: ${err.message}`);
    }
    if (!funded || typeof funded.psbt !== 'string') throw senderError('original-build-failed', 'walletcreatefundedpsbt did not return a PSBT.');
    const unsigned = bitcoin.Psbt.fromBase64(funded.psbt, { network });
    locked = unsigned.txInputs.map((txInput) => {
      const [txid, vout] = outpointOfTxInput(txInput).split(':');
      return { txid, vout: Number(vout) };
    });
    const total = unsigned.txOutputs.reduce((t, o) => t + BigInt(o.value), 0n);
    if (total > MAX_MONEY_SATS) throw senderError('original-build-failed', 'The original moves more than MAX_MONEY.');

    const processed = await rpc('walletprocesspsbt', [funded.psbt, true, 'ALL', true, true]);
    if (!processed || typeof processed.psbt !== 'string' || processed.complete !== true) {
      throw senderError('original-build-failed', 'The Hub wallet could not sign the original.');
    }
    const original = processed.psbt;
    const originalPsbt = bitcoin.Psbt.fromBase64(original, { network });
    const originalTxid = Buffer.from(bitcoin.crypto.hash256(Buffer.from(originalPsbt.data.globalMap.unsignedTx.toBuffer()))).reverse().toString('hex');
    const changeIndex = Number.isSafeInteger(funded.changepos) && funded.changepos >= 0 ? funded.changepos : null;
    const params = {
      additionalFeeOutputIndex: changeIndex,
      maxAdditionalFeeContribution: changeIndex == null ? 0 : maxFee,
      minFeeRate: feeRate,
      disableOutputSubstitution: true
    };
    stage('original-built', { originalTxid, inputs: locked.length, changeIndex });

    if (opts.dryRun) {
      await unlock();
      return { dryRun: true, originalTxid, address: parsed.address, amountSats, params };
    }
    if (cancelled()) throw senderError('cancelled', 'The Payjoin send was cancelled.');

    let proposed;
    try {
      proposed = await postPayjoinProposal(parsed.pjUrl, original, {
        fetchFn: opts.fetchFn,
        params,
        timeoutMs: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS,
        maxResponseBytes: Number(opts.maxResponseBytes) > 0 ? Number(opts.maxResponseBytes) : DEFAULT_MAX_RESPONSE_BYTES
      });
    } catch (err) {
      throw senderError('receiver-error', err.message);
    }
    stage('proposal-received', {});

    let check;
    let proposal;
    try {
      check = checkPayjoinProposal(original, proposed, { networkName, payAddress: parsed.address, params });
      proposal = bitcoin.Psbt.fromBase64(String(proposed).trim(), { network });
    } catch (err) {
      throw senderError('proposal-rejected', err.message);
    }
    const ours = new Set(originalPsbt.txInputs.map(outpointOfTxInput));
    for (const [i, txInput] of proposal.txInputs.entries()) {
      if (ours.has(outpointOfTxInput(txInput))) continue;
      const data = proposal.data.inputs[i];
      const script = data.witnessUtxo
        ? Buffer.from(data.witnessUtxo.script)
        : Buffer.from(bitcoin.Transaction.fromBuffer(Buffer.from(data.nonWitnessUtxo)).outs[txInput.index].script);
      let address = null;
      try { address = bitcoin.address.fromOutputScript(script, network); } catch (_) {}
      if (!address) continue;
      let info;
      try {
        info = await rpc('getaddressinfo', [address]);
      } catch (err) {
        throw senderError('proposal-rejected', `Could not check receiver input ${i}: ${err.message}`);
      }
      if (info && info.ismine === true) throw senderError('proposal-rejected', `Payjoin receiver input ${i} spends one of our coins.`);
    }

    const unsignedProposal = Buffer.from(proposal.data.globalMap.unsignedTx.toBuffer()).toString('hex');
    const signed = await rpc('walletprocesspsbt', [proposal.toBase64(), true, 'ALL', true, true]);
    if (!signed || typeof signed.psbt !== 'string') throw senderError('sign-failed', 'walletprocesspsbt did not return a PSBT.');
    const signedPsbt = bitcoin.Psbt.fromBase64(signed.psbt, { network });
    if (Buffer.from(signedPsbt.data.globalMap.unsignedTx.toBuffer()).toString('hex') !== unsignedProposal) {
      throw senderError('sign-failed', 'The Hub wallet changed the proposal transaction.');
    }
    const finalized = await rpc('finalizepsbt', [signed.psbt, true]);
    if (!finalized || finalized.complete !== true || typeof finalized.hex !== 'string') {
      throw senderError('sign-failed', 'The payjoin transaction is not fully signed.');
    }
    const accept = await rpc('testmempoolaccept', [[finalized.hex]]);
    const row = Array.isArray(accept) ? accept[0] : null;
    if (!row || !row.allowed) throw senderError('broadcast-failed', `The payjoin transaction would not be accepted: ${(row && row['reject-reason']) || 'unknown'}`);
    if (cancelled()) throw senderError('cancelled', 'The Payjoin send was cancelled.');

    let txid;
    try {
      txid = await rpc('sendrawtransaction', [finalized.hex]);
    } catch (err) {
      throw senderError('broadcast-failed', err.message);
    }
    locked = [];
    stage('broadcast', { txid });
    return { txid: String(txid), originalTxid, address: parsed.address, amountSats, check, dryRun: false };
  } catch (err) {
    await unlock();
    if (!err.code) err.code = 'failed';
    throw err;
  }
}

module.exports = {
  DEFAULT_MAX_FEE_CONTRIBUTION_SATS,
  sendPayjoin
};
