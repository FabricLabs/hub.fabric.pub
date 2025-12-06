'use strict';

module.exports = async function (req, res, next) {
  const data = { status: 'error', message: 'Not yet implemented.' };
  return this.http.formatResponse(req, res, data, {
    title: 'Create Peer',
    resourceName: 'Create Peer'
  });
};
