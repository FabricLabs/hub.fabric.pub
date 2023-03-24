'use strict';

const defaults = require('./default');

module.exports = Object.assign({}, defaults, {
  alias: '@fabric/hub',
  http: {
    port: process.env.PORT || 8080
  },
  key: {
    seed: process.env.FABRIC_SEED || ''
  },
  listen: true,
  path: './stores/hub',
  peering: true,
  peers: [
    'hub.fabric.pub:7777'
  ],
  port: process.env.FABRIC_PORT || 7777
});
