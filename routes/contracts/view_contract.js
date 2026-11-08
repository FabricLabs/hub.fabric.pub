'use strict';

module.exports = async function (req, res, next) {
  res.format({
    'application/json': () => {
      try {
        const id = req.params && (req.params.id || req.params.contract) ? (req.params.id || req.params.contract) : null;
        if (!id) {
          return res.json({ status: 'error', message: 'contract id required' });
        }

        let contract = null;
        try {
          const raw = this.fs.readFile(`contracts/${id}.json`);
          if (raw) contract = JSON.parse(raw);
        } catch (e) {
          contract = null;
        }

        let application = null;
        try {
          application = typeof this._applicationContractJson === 'function' ? this._applicationContractJson(id) : null;
        } catch (e) {
          application = null;
        }

        let document = null;
        try {
          document = typeof this._documentContractJson === 'function' ? this._documentContractJson(id) : null;
        } catch (e) {
          document = null;
        }

        if (!contract && !application && !document) {
          return res.json({ status: 'error', message: 'contract not found' });
        }

        return res.json({ status: 'ok', contract, application, document });
      } catch (err) {
        return res.json({ status: 'error', message: err && err.message ? err.message : 'contract view failed' });
      }
    },
    'text/html': () => {
      // Serve the SPA shell; React Router handles /contracts/:id inside the app.
      return res.send(this.applicationString);
    }
  });
};
