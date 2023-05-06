'use strict';

const defaults = require('./default');

module.exports = Object.assign({}, defaults, {
  alias: '@fabric/hub',
  http: {
    hostname: process.env.HOSTNAME || 'localhost',
    interface: process.env.INTERFACE || '0.0.0.0',
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
  port: process.env.FABRIC_PORT || 7777,
  resources: {
    'Contract': {
      fields: [
        { name: 'id', type: 'String', required: true },
        { name: 'created', type: 'String', required: true },
        { name: 'definition', type: 'String', required: true },
        { name: 'author', type: 'String', required: true }
      ]
    }
  }
});
