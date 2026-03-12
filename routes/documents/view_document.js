'use strict';

module.exports = async function (req, res, next) {
  const requested = req.params.id;
  const resolvedId = (this && typeof this.resolveNamedDocumentId === 'function')
    ? this.resolveNamedDocumentId(requested)
    : requested;

  res.format({
    'application/json': () => {
      return res.json(this.state.documents[resolvedId]);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
