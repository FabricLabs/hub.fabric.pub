'use strict';

module.exports = async function (req, res, next) {
  // Use the Peer's persistent known-peers list (scores, metadata, connection status).
  const peers = this.agent ? this.agent.knownPeers : [];
  res.format({
    'application/json': () => {
      return res.json(peers);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
