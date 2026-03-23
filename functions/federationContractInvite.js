'use strict';

const FEDERATION_CONTRACT_INVITE = 'FederationContractInvite';
const FEDERATION_CONTRACT_INVITE_RESPONSE = 'FederationContractInviteResponse';

function parseFederationContractInvite (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE) return null;
    if (Number(p.v) !== 1) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    return p;
  } catch (_) {
    return null;
  }
}

function parseFederationContractInviteResponse (content) {
  if (!content || typeof content !== 'string') return null;
  try {
    const p = JSON.parse(content);
    if (!p || p.type !== FEDERATION_CONTRACT_INVITE_RESPONSE) return null;
    if (Number(p.v) !== 1) return null;
    if (!p.inviteId || typeof p.inviteId !== 'string') return null;
    if (typeof p.accept !== 'boolean') return null;
    return p;
  } catch (_) {
    return null;
  }
}

function buildFederationContractInviteJson (fields) {
  return JSON.stringify({
    type: FEDERATION_CONTRACT_INVITE,
    v: 1,
    inviteId: fields.inviteId,
    inviterHubId: fields.inviterHubId != null ? String(fields.inviterHubId) : null,
    contractId: fields.contractId != null && String(fields.contractId).trim()
      ? String(fields.contractId).trim()
      : null,
    note: fields.note != null && String(fields.note).trim() ? String(fields.note).trim().slice(0, 2000) : null,
    invitedAt: fields.invitedAt != null ? Number(fields.invitedAt) : Date.now()
  });
}

function buildFederationContractInviteResponseJson (fields) {
  return JSON.stringify({
    type: FEDERATION_CONTRACT_INVITE_RESPONSE,
    v: 1,
    inviteId: String(fields.inviteId || ''),
    accept: !!fields.accept,
    responderPubkey: fields.responderPubkey != null && String(fields.responderPubkey).trim()
      ? String(fields.responderPubkey).trim()
      : null,
    respondedAt: fields.respondedAt != null ? Number(fields.respondedAt) : Date.now()
  });
}

module.exports = {
  FEDERATION_CONTRACT_INVITE,
  FEDERATION_CONTRACT_INVITE_RESPONSE,
  parseFederationContractInvite,
  parseFederationContractInviteResponse,
  buildFederationContractInviteJson,
  buildFederationContractInviteResponseJson
};
