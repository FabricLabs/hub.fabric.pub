'use strict';

module.exports = {
  contracts: {
    create: require('./contracts/create_contract'),
    list: require('./contracts/list_contracts'),
    view: require('./contracts/view_contract'),
    // destroy: require('./contracts/destroy_contract'),
    // update: require('./contracts/update_contract')
  },
  documents: {
    create: require('./documents/create_document'),
    list: require('./documents/list_documents'),
    view: require('./documents/view_document'),
    // destroy: require('./documents/destroy_document'),
    // update: require('./documents/update_document')
  },
  messages: {
    create: require('./messages/create_message'),
    list: require('./messages/list_messages'),
    view: require('./messages/view_message'),
    // destroy: require('./messages/destroy_message'),
    // update: require('./messages/update_message')
  },
  peers: {
    create: require('./peers/create_peer'),
    list: require('./peers/list_peers'),
    view: require('./peers/view_peer'),
    // destroy: require('./peers/destroy_peer'),
    // update: require('./peers/update_peer')
  }
};
