'use strict';

/**
 * Rebind @fabric/http FabricHTTPServer to a new listen address without rebuilding Express
 * or stopping the Fabric agent. Closes WebSocket.Server (drops clients; they may reconnect)
 * and replaces the stoppable http.Server. Express app and routes are reused.
 */
const http = require('http');
const stoppable = require('stoppable');
const WebSocket = require('ws');

function stopStoppable (server) {
  return new Promise((resolve, reject) => {
    if (!server || typeof server.stop !== 'function') {
      resolve();
      return;
    }
    server.stop((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function closeWebSocketServer (wss) {
  return new Promise((resolve) => {
    if (!wss) {
      resolve();
      return;
    }
    try {
      wss.close(() => resolve());
    } catch (_) {
      resolve();
    }
  });
}

/**
 * @param {*} fabricHttp - FabricHTTPServer instance (`@fabric/http` types/server), already `start()`ed
 */
async function rebindFabricHttpListen (fabricHttp) {
  if (!fabricHttp || !fabricHttp.express) {
    throw new Error('rebindFabricHttpListen: invalid Fabric HTTP server');
  }
  const port = fabricHttp.settings.port || fabricHttp.port;
  const iface = (
    fabricHttp.settings && fabricHttp.settings.interface != null && fabricHttp.settings.interface !== ''
      ? fabricHttp.settings.interface
      : fabricHttp.interface
  );
  // Keep legacy field in sync for callers that still read `server.interface`.
  fabricHttp.interface = iface;

  await closeWebSocketServer(fabricHttp.wss);
  fabricHttp.wss = null;

  await stopStoppable(fabricHttp.http);
  fabricHttp.http = null;

  fabricHttp.http = stoppable(http.createServer(fabricHttp.express), 0);
  fabricHttp.http.on('error', (err) => {
    try {
      fabricHttp.emit('error', err);
    } catch (_) { /* ignore */ }
  });
  const wsOpts = { server: fabricHttp.http };
  const wsCfg = fabricHttp.settings.websocket || {};
  if (wsCfg.clientToken && (wsCfg.requireClientToken === true || wsCfg.requireClientToken === '1' || wsCfg.requireClientToken === 1)) {
    wsOpts.verifyClient = fabricHttp._verifyWebSocketClient.bind(fabricHttp);
  }
  fabricHttp.wss = new WebSocket.Server(wsOpts);
  fabricHttp.wss.on('connection', fabricHttp._handleWebSocket.bind(fabricHttp));

  await new Promise((resolve, reject) => {
    const srv = fabricHttp.http;
    const onErr = (err) => {
      srv.removeListener('error', onErr);
      reject(err);
    };
    srv.once('error', onErr);
    srv.listen(port, iface, () => {
      srv.removeListener('error', onErr);
      fabricHttp.status = 'STARTED';
      resolve();
    });
  });
}

module.exports = { rebindFabricHttpListen };
