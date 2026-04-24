'use strict';

// Dependencies
const { createStore, combineReducers, applyMiddleware } = require('redux');
const thunkMiddleware = require('redux-thunk').default;

// Reducers
const bridgeReducer = require('../reducers/bridgeReducer');
const contractReducer = require('../reducers/contractReducer');
const documentReducer = require('../reducers/documentReducer');
const searchReducer = require('../reducers/searchReducer');

// Root
const rootReducer = combineReducers({
  bridge: bridgeReducer,
  contracts: contractReducer,
  documents: documentReducer,
  search: searchReducer
});

module.exports = createStore(rootReducer, applyMiddleware(thunkMiddleware));
