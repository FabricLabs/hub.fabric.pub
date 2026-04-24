'use strict';

/**
 * Merge hub WebRTC signaling registry into {@link GetNetworkStatus} `peers` so browser clients
 * following the Fabric protocol (advertising `metadata.fabricPeerId`) appear beside TCP known peers.
 *
 * @param {object[]|undefined} knownPeers - {@link Peer#knownPeers}
 * @param {object[]|undefined} webrtcPeerList - values from hub HTTP `webrtcPeers` map
 * @returns {object[]}
 */
function mergeFabricPeersWithWebRtcRegistry (knownPeers, webrtcPeerList) {
  const tcp = Array.isArray(knownPeers) ? knownPeers.filter((p) => p && typeof p === 'object') : [];
  const out = tcp.map((p) => ({ ...p }));
  const seen = new Set();
  for (const p of out) {
    if (p.id) seen.add(String(p.id));
    if (p.address) seen.add(String(p.address));
  }
  const list = Array.isArray(webrtcPeerList) ? webrtcPeerList : [];
  for (const w of list) {
    if (!w || w.id == null) continue;
    const wid = String(w.id);
    const meta = w.metadata && typeof w.metadata === 'object' ? { ...w.metadata } : {};
    const fabricId = meta.fabricPeerId ? String(meta.fabricPeerId).trim() : '';
    const meshSessions = Math.max(0, Number(w.meshSessionCount) || 0);
    const meshUp = meshSessions > 0;
    const logicalId = fabricId || `webrtc:${wid}`;
    if (fabricId && seen.has(fabricId)) continue;
    if (seen.has(logicalId)) continue;
    seen.add(logicalId);
    meta.transport = 'webrtc';
    meta.webrtcSignalingId = wid;
    meta.meshSessionCount = meshSessions;
    out.push({
      id: logicalId,
      address: `webrtc:${wid}`,
      status: meshUp ? 'connected' : String(w.status || 'registered'),
      score: typeof w.registryScore === 'number' && Number.isFinite(w.registryScore) ? w.registryScore : 0,
      metadata: meta
    });
  }
  return out;
}

module.exports = { mergeFabricPeersWithWebRtcRegistry };
