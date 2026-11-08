'use strict';

const { filterMessages } = require('../../functions/fabricMessageView');

/**
 * `GET /messages` — the Hub's Fabric message log, newest first.
 * Query: `type` (comma list), `contract`, `author`, `q`, `before` (seq), `limit`.
 */
module.exports = function (req, res) {
  return this.http.jsonOrShell(req, res, async () => {
    const q = req.query || {};
    return res.json(Object.assign({ type: 'FabricMessages' }, filterMessages(this._getFabricMessages(), {
      type: q.type,
      contract: q.contract,
      author: q.author,
      q: q.q,
      before: q.before,
      limit: q.limit
    })));
  });
};
