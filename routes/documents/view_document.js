'use strict';

module.exports = async function (req, res, next) {
  res.format({
    'application/json': () => {
      return res.json(this.state.documents[req.params.id]);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
