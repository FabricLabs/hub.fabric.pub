'use strict';

module.exports = async function (req, res, next) {
  res.format({
    'application/json': () => {
      try {
        const content = this._state && this._state.content ? this._state.content : {};
        const contractsMap = content.contracts || {};
        const contracts = Object.values(contractsMap);
        return res.json({ status: 'ok', contracts });
      } catch (err) {
        return res.json({ status: 'error', message: err && err.message ? err.message : 'contracts list failed' });
      }
    },
    'text/html': () => {
      // Serve the SPA shell; React Router handles /contracts inside the app.
      return res.send(this.applicationString);
    }
  });
};
