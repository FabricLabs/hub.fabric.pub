'use strict';

const { SAMPLE_HUB_HTTP_SERVER_NAME } = require('@fabric/http/constants');

/**
 * True when `OPTIONS /` JSON is from `@fabric/http`’s `sample-hub-http-server` (body `name` matches
 * {@link SAMPLE_HUB_HTTP_SERVER_NAME}).
 * @param {object|null|undefined} optionsBody
 * @returns {boolean}
 */
function isSampleHubHttpServerOptions (optionsBody) {
  if (!optionsBody || typeof optionsBody !== 'object') return false;
  return String(optionsBody.name || '') === SAMPLE_HUB_HTTP_SERVER_NAME;
}

module.exports = {
  isSampleHubHttpServerOptions
};
