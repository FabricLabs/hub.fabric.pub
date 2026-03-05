/**
 * Actions Index
 */
'use strict';

// # Actions
// Actions drive the application.  They are the only way to change the state.

// ## Contract Actions
const {
  fetchContracts,
  fetchContract,
  signContract
} = require('../actions/contractActions');

// ## Document Actions
const {
  fetchDocuments,
  fetchDocument,
  uploadDocument,
  searchDocument,
  createDocument,
  editDocument,
  deleteDocument
} = require('../actions/documentActions');

// ## Search Actions
const {
  searchGlobal
} = require('../actions/searchActions');

// ## Bridge Actions
const {
  bridgeNetworkStatusUpdate
} = require('../actions/bridgeActions');

module.exports = {
  fetchContract: fetchContract,
  fetchContracts: fetchContracts,
  signContract: signContract,
  fetchDocuments: fetchDocuments,
  fetchDocument: fetchDocument,
  searchDocument: searchDocument,
  uploadDocument: uploadDocument,
  createDocument: createDocument,
  editDocument: editDocument,
  deleteDocument: deleteDocument,
  searchGlobal: searchGlobal,
  bridgeNetworkStatusUpdate: bridgeNetworkStatusUpdate
};
