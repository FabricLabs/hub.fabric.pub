'use strict';

const defaults = require('./default');

module.exports = Object.assign({}, defaults, {
  alias: '@fabric/hub',
  created: '2017-11-11:00:00.000Z',
  debug: false,
  mode: process.env.NODE_ENV || 'production',
  http: {
    hostname: process.env.FABRIC_HUB_HOSTNAME || process.env.HOSTNAME || 'localhost',
    interface: process.env.FABRIC_HUB_INTERFACE || process.env.INTERFACE || '0.0.0.0',
    port: process.env.FABRIC_HUB_PORT || process.env.PORT || 8080
  },
  key: {
    mnemonic: process.env.FABRIC_MNEMONIC || process.env.FABRIC_SEED || null,
    seed: process.env.FABRIC_SEED || null,
    xprv: process.env.FABRIC_XPRV || null,
    xpub: process.env.FABRIC_XPUB || null,
    passphrase: process.env.FABRIC_PASSPHRASE || null
  },
  listen: true,
  path: './stores/hub',
  peering: true,
  peers: [
    'hub.fabric.pub:7777',
    'sensemaker.io:7777'
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
    },
    'Document': {
      fields: [
        { name: 'id', type: 'String', required: true },
        { name: 'content', type: 'String', required: true },
        { name: 'created', type: 'String', required: true },
        { name: 'author', type: 'String' }
      ]
    }
  },
  state: {
    contracts: [],
    documents: []
  },
  transparent: false
});
