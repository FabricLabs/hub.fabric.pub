'use strict';

const BridgeMessageCollection = require('../../types/bridgeMessageCollection');
const FabricTransportSession = require('../../functions/fabricTransportSession');

module.exports = {
  name: 'Message',
  systems: ['messaging', 'transport'],
  components: {
    BridgeMessageCollection,
    FabricTransportSession
  },
  fields: [
    { name: 'id', type: 'String', required: true },
    { name: 'type', type: 'String', required: true },
    { name: 'object', type: 'Object', required: true },
    { name: 'created', type: 'String', required: false }
  ]
};
