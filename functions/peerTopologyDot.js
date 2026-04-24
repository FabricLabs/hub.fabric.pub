'use strict';

const { FNV1A_32_OFFSET, FNV1A_32_PRIME } = require('../constants');
const { escapeDotLabel, shortLabel } = require('./contractGraphDot');

/**
 * Stable graphviz node name for a Fabric id / address (avoids special chars in node ids).
 */
function nodeName (raw) {
  const s = String(raw || 'unknown');
  let h = FNV1A_32_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, FNV1A_32_PRIME);
  }
  return 'N' + (h >>> 0).toString(16);
}

/**
 * @param {object} opts
 * @param {string} [opts.selfId]
 * @param {string} [opts.selfLabel]
 * @param {Array<object>} opts.directPeers - knownPeers rows (use status === 'connected' for solid edges)
 * @param {{ byReporter?: Record<string, { at: number, neighbors: string[] }> }} [opts.gossip]
 * @returns {string} DOT source or '' if empty
 */
function peerTopologyToDot (opts) {
  const selfId = opts && opts.selfId ? String(opts.selfId) : '';
  const selfLabel = (opts && opts.selfLabel) || 'This Fabric node';
  const directPeers = Array.isArray(opts && opts.directPeers) ? opts.directPeers : [];
  const gossip = opts && opts.gossip && opts.gossip.byReporter ? opts.gossip.byReporter : {};

  const connected = directPeers.filter((p) => p && p.status === 'connected');
  if (!selfId && connected.length === 0 && Object.keys(gossip).length === 0) return '';

  const lines = [
    'digraph P {',
    '  rankdir=TB;',
    '  node [fontname="Helvetica" fontsize=10];',
    '  edge [fontname="Helvetica" fontsize=9];'
  ];

  const selfN = selfId ? nodeName(selfId) : 'LOCAL';
  const sl = escapeDotLabel(shortLabel(selfLabel, 20, 0));
  lines.push(`  ${selfN} [label="${sl}" shape=cylinder fillcolor=lightblue style=filled];`);

  const directIds = new Set();
  for (const p of connected) {
    const pid = p.id ? String(p.id) : '';
    if (!pid) continue;
    directIds.add(pid);
    const pn = nodeName(pid);
    const pl = escapeDotLabel(shortLabel(pid, 10, 6));
    const nick = p.nickname ? `\\n(${escapeDotLabel(shortLabel(p.nickname, 12, 0))})` : '';
    lines.push(`  ${pn} [label="TCP peer\\n${pl}${nick}" fillcolor=lightyellow style=filled shape=box];`);
    lines.push(`  ${selfN} -> ${pn} [label="connected"];`);
  }

  const maxGossipEdges = 48;
  let gossipCount = 0;
  const seenGossip = new Set();

  for (const p of connected) {
    const pid = p.id ? String(p.id) : '';
    if (!pid) continue;
    const entry = gossip[pid] || gossip[p.address] || null;
    if (!entry || !Array.isArray(entry.neighbors)) continue;
    const fromN = nodeName(pid);
    for (const nb of entry.neighbors) {
      const nid = String(nb || '').trim();
      if (!nid || nid === selfId || nid === pid) continue;
      if (gossipCount >= maxGossipEdges) break;
      const key = `${pid}->${nid}`;
      if (seenGossip.has(key)) continue;
      seenGossip.add(key);
      gossipCount++;
      const toN = nodeName(nid);
      const isDirect = directIds.has(nid);
      if (!isDirect) {
        const nl = escapeDotLabel(shortLabel(nid, 10, 6));
        lines.push(`  ${toN} [label="via gossip\\n${nl}" fillcolor=whitesmoke style=filled shape=ellipse];`);
      }
      lines.push(`  ${fromN} -> ${toN} [style=dotted label="P2P_PEER_GOSSIP"];`);
    }
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Local view: one peer and neighbors reported in its last P2P_PEER_GOSSIP.
 */
function peerNeighborhoodToDot (centerId, neighbors) {
  if (!centerId || !Array.isArray(neighbors) || neighbors.length === 0) return '';
  const c = nodeName(centerId);
  const lines = [
    'digraph N {',
    '  rankdir=LR;',
    '  node [fontname="Helvetica" fontsize=10];'
  ];
  lines.push(`  ${c} [label="Selected peer\\n${escapeDotLabel(shortLabel(centerId, 10, 6))}" fillcolor=lightblue style=filled shape=box];`);
  const slice = neighbors.slice(0, 36);
  for (let i = 0; i < slice.length; i++) {
    const nb = String(slice[i] || '').trim();
    if (!nb || nb === centerId) continue;
    const n = nodeName(nb);
    lines.push(`  ${n} [label="${escapeDotLabel(shortLabel(nb, 10, 6))}" fillcolor=whitesmoke style=filled shape=ellipse];`);
    lines.push(`  ${c} -> ${n} [label="seen in gossip" style=dotted];`);
  }
  lines.push('}');
  return lines.join('\n');
}

module.exports = { peerTopologyToDot, peerNeighborhoodToDot, nodeName };
