'use strict';

/**
 * Contract-namespace Statechains — prefer `@fabric/core`.
 * @see @fabric/core/functions/contractStatechains
 * @see docs/ADR-001-CONTRACT_NAMESPACE_SIDECHAINS.md
 */

try {
  module.exports = require('@fabric/core/functions/contractStatechains');
} catch (_) {
  const sidechainState = require('./sidechainState');

  async function provisionAcceptedContract (fs, parentState, entry, policy = null) {
    const contractId = entry && entry.contractId;
    if (!contractId) return { ok: false, error: 'contractId required' };

    let contractChain;
    try {
      contractChain = await sidechainState.ensureContractStatechain(fs, contractId);
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }

    const head = sidechainState.namespaceHeadFromState(contractId, contractChain.state, {
      name: entry.name || null,
      parentContractId: entry.parentContractId || null
    });

    const parentPatches = sidechainState.patchesForNamespaceHead(
      parentState && parentState.content,
      contractId,
      head
    );
    if (!parentPatches.length) {
      return { ok: true, contractChain, head, parentPatches: [], parentState };
    }

    const applied = sidechainState.applyPatchesToState(parentState, parentPatches, policy);
    if (!applied.ok) {
      return { ok: false, error: applied.error || 'parent seal patch failed', contractChain, head };
    }

    try {
      await sidechainState.persistState(fs, applied.state);
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e), contractChain, head };
    }

    return {
      ok: true,
      contractChain,
      head,
      parentPatches,
      parentState: applied.state,
      newDigest: applied.newDigest
    };
  }

  async function sealNamespaceHeadIntoParent (fs, parentState, contractId, meta = {}, policy = null) {
    const paths = sidechainState.storePathsForContract(contractId);
    const contractState = sidechainState.loadStateAt(fs, paths.state);
    const head = sidechainState.namespaceHeadFromState(contractId, contractState, meta);
    const parentPatches = sidechainState.patchesForNamespaceHead(
      parentState && parentState.content,
      contractId,
      head
    );
    if (!parentPatches.length) {
      return { ok: true, skipped: true, head, parentState };
    }
    const applied = sidechainState.applyPatchesToState(parentState, parentPatches, policy);
    if (!applied.ok) {
      return { ok: false, error: applied.error || 'seal failed', head };
    }
    await sidechainState.persistState(fs, applied.state);
    return { ok: true, head, parentPatches, parentState: applied.state, newDigest: applied.newDigest };
  }

  async function applyPatchesToContractStatechain (fs, contractId, patches, policy = null) {
    const paths = sidechainState.storePathsForContract(contractId);
    const state = sidechainState.loadStateAt(fs, paths.state);
    const basisDigest = sidechainState.stateDigest(state);
    const applied = sidechainState.applyPatchesToState(state, patches, policy);
    if (!applied.ok) return applied;
    await sidechainState.persistStateAt(fs, applied.state, paths.state);
    return {
      ok: true,
      state: applied.state,
      newDigest: applied.newDigest,
      basisDigest,
      paths,
      head: sidechainState.namespaceHeadFromState(contractId, applied.state)
    };
  }

  module.exports = {
    provisionAcceptedContract,
    sealNamespaceHeadIntoParent,
    applyPatchesToContractStatechain
  };
}
