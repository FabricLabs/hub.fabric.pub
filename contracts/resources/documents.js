'use strict';

const documentPublishSync = require('../../functions/documentPublishSync');

module.exports = {
  name: 'Document',
  systems: ['documents', 'market'],
  components: {
    documentPublishSync
  },
  fields: [
    { name: 'id', type: 'String', required: true },
    { name: 'content', type: 'String', required: true },
    { name: 'created', type: 'String', required: true },
    { name: 'author', type: 'String', required: false }
  ]
};
