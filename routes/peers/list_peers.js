'use strict';

module.exports = async function (req, res, next) {
  // const peers = await this.fabric.peers.list();
  const peers = [];
  return this.http.formatResponse(req, res, peers, {
    title: 'Peers',
    resourceName: 'Peers'
  });
};
