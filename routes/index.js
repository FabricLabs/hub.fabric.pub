'use strict';

module.exports = {
  contracts: {
    list: require('./contracts/list_contracts'),
    view: require('./contracts/view_contract')
  },
  documents: {
    list: require('./documents/list_documents'),
    view: require('./documents/view_document')
  },
  messages: {
    list: require('./messages/list_messages'),
    view: require('./messages/view_message')
  }
};
