'use strict';

module.exports = async function (req, res, next) {
  res.format({
    'application/json': () => {
      return res.json(this.state.documents);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
