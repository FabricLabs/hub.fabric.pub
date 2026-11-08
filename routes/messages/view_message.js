'use strict';

const { messageRecord, messageLabel } = require('../../functions/fabricMessageView');
const { decodeOpaqueFabricUri } = require('../../functions/fabricProtocolUrl');

/** @private */
function decodedFrame (fabric) {
  const decoded = decodeOpaqueFabricUri(fabric);
  return decoded.ok
    ? { ok: true, signed: decoded.signed, author: decoded.author, summary: decoded.summary }
    : { ok: false, error: decoded.error };
}

/**
 * A federation mailbox frame, for readers who may see its federation.
 * @private
 */
async function mailboxRecord (hub, req, id) {
  const f = hub.federations;
  if (!f || typeof f.frameById !== 'function') return null;
  const frame = f.frameById(id);
  if (!frame) return null;
  const viewer = await hub._federationViewer(req);
  try {
    await f.getFor(frame.federationId, viewer);
  } catch (_) {
    return null;
  }
  return {
    id: frame.id,
    frameId: frame.id,
    seq: frame.seq,
    type: frame.type,
    label: messageLabel(frame.type),
    created: frame.at ? new Date(frame.at).toISOString() : null,
    parent: null,
    parentHref: null,
    author: frame.signer || null,
    refs: [frame.federationId],
    href: `/messages/${frame.id}`,
    source: 'federation-mailbox',
    federationId: frame.federationId,
    fabric: frame.fabric,
    payload: null,
    chainBlock: null,
    parentMessage: null,
    children: [],
    chain: [],
    frame: decodedFrame(frame.fabric)
  };
}

/**
 * `GET /messages/:id` — one log entry (frame id, log id, or 12+ hex prefix)
 * with its parent, children, and parent chain. A payload carrying an opaque
 * `fabric:` frame gets its decoded summary. A federation mailbox frame is
 * found too, for the operator and that federation's signers.
 */
module.exports = function (req, res) {
  return this.http.jsonOrShell(req, res, async () => {
    const id = req.params && req.params.id;
    let record = messageRecord(this._getFabricMessages(), id);
    if (record) {
      record.source = 'log';
      const fabric = record.payload && typeof record.payload === 'object' && typeof record.payload.fabric === 'string'
        ? record.payload.fabric
        : null;
      if (fabric) {
        record.fabric = fabric;
        record.frame = decodedFrame(fabric);
      }
    } else {
      record = await mailboxRecord(this, req, id);
    }
    if (!record) return res.status(404).json({ status: 'error', message: 'message not found' });
    return res.json({ type: 'FabricMessage', message: record });
  });
};
