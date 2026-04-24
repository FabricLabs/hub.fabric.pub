'use strict';

const contractResource = require('./contracts');
const documentResource = require('./documents');
const messageResource = require('./messaging');

module.exports = {
  Contract: { fields: contractResource.fields, systems: contractResource.systems },
  Document: { fields: documentResource.fields, systems: documentResource.systems },
  Message: { fields: messageResource.fields, systems: messageResource.systems }
};
