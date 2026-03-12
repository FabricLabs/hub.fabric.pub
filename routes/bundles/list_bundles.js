'use strict';

module.exports = async function (req, res, next) {
  const bundles = (this._state && this._state.content && this._state.content.collections && this._state.content.collections.bundles) || {};
  res.format({
    'application/json': () => {
      return res.json(bundles);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
