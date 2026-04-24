'use strict';

const addPeer = async (...params) => {
  const peer = params[0];
  const address = typeof peer === 'string' ? peer : (peer && typeof peer.address === 'string' ? peer.address : (peer && peer.address) || null);
  if (!address) return { status: 'error', message: 'address required' };
  const normalized = address.includes(':') ? address : `${address}:7777`;
  console.debug('[HUB] AddPeer:', normalized);
  try {
    this.agent._connect(normalized);
    return { status: 'success' };
  } catch (err) {
    console.error('[HUB] AddPeer error:', err);
    return { status: 'error', message: err && err.message ? err.message : 'connect failed' };
  }
};

module.exports = addPeer;
