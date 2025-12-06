'use strict';

module.exports = {
  contracts: {
    create: require('./contracts/create_contract'),
    view: require('./contracts/view_contract'),
    list: require('./contracts/list_contracts'),
    // destroy: require('./contracts/destroy_contract'),
    // update: require('./contracts/update_contract')
  },
  documents: {
    create: require('./documents/create_document'),
    view: require('./documents/view_document'),
    list: require('./documents/list_documents'),
    // destroy: require('./documents/destroy_document'),
    // update: require('./documents/update_document')
  },
  messages: {
    create: require('./messages/create_message'),
    view: require('./messages/view_message'),
    list: require('./messages/list_messages'),
    // destroy: require('./messages/destroy_message'),
    // update: require('./messages/update_message')
  },
  peers: {
    create: require('./peers/create_peer'),
    view: require('./peers/view_peer'),
    list: require('./peers/list_peers'),
    // destroy: require('./peers/destroy_peer'),
    // update: require('./peers/update_peer')
  },
};
