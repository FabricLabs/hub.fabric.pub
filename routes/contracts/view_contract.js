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

        if (!contract) {
          return res.json({ status: 'error', message: 'contract not found' });
        }

        return res.json({ status: 'ok', contract });
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
