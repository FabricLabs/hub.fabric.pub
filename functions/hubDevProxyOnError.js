'use strict';

/**
 * webpack-dev-server proxy error handler.
 * When Hub HTTP is down, historyApiFallback would otherwise serve `index.html` for
 * `/settings`, and the SPA would classify the origin as a CDN HTML client.
 *
 * @param {Error} err
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @returns {void}
 */
function hubDevProxyOnError (err, req, res) {
  if (!res || res.headersSent) return;
  const payload = {
    error: 'hub-unreachable',
    message: 'Hub HTTP is not running. Start it with npm run start:fast (port 8080).'
  };
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(502).json(payload);
    return;
  }
  res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

module.exports = {
  hubDevProxyOnError
};
