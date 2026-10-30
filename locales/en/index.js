'use strict';

module.exports = {
  ...require('./brand'),
  common: require('./common'),
  shell: require('./shell'),
  notices: require('./notices'),
  identity: require('./identity'),
  home: require('./home'),
  documents: require('./documents'),
  network: require('./network'),
  bitcoin: require('./bitcoin'),
  payments: require('./payments'),
  settings: require('./settings'),
  federation: require('./federation'),
  delegation: require('./delegation')
};
