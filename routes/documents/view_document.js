'use strict';

module.exports = async function (req, res, next) {
  const resolvedId = req.params.id;

  res.format({
    'application/json': () => {
      return res.json(this.state.documents[resolvedId]);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
