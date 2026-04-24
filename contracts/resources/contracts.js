'use strict';

const payjoinFabricProtocol = require('../../functions/payjoinFabricProtocol');
const bitcoinProtocolUrl = require('../../functions/bitcoinProtocolUrl');

module.exports = {
  name: 'Contract',
  systems: ['execution', 'payments'],
  components: {
    payjoinFabricProtocol,
    bitcoinProtocolUrl
  },
  fields: [
    { name: 'id', type: 'String', required: true },
    { name: 'created', type: 'String', required: true },
    { name: 'definition', type: 'String', required: true },
    { name: 'author', type: 'String', required: true }
  ]
};
