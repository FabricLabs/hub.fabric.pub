'use strict';

const defaults = require('./default');
const Environment = require('@fabric/core/types/environment');
const environment = new Environment();

module.exports = Object.assign({}, defaults, {
  _environment: {
    id: environment.id
  },
  http: {
    port: process.env.PORT || 8080
  },
  path: './stores/hub',
  peering: true
});
