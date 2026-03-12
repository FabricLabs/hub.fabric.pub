'use strict';

module.exports = async function (req, res, next) {
  const requested = req.params.id;
  const resolvedId = (this && typeof this.resolveNamedDocumentId === 'function')
    ? this.resolveNamedDocumentId(requested)
    : requested;

  const raw = this.fs.readFile(`documents/${resolvedId}.json`);
  if (!raw) return res.status(404).send({ status: 'error', message: 'bundle not found' });

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return res.status(500).send({ status: 'error', message: 'invalid bundle document' });
  }

  const accept = String((req && req.headers && req.headers.accept) || '').toLowerCase();
  const wantsJSON = accept.includes('application/json');

  if (!wantsJSON && parsed && parsed.contentBase64) {
    const mime = parsed.mime || 'application/octet-stream';
    const buffer = Buffer.from(parsed.contentBase64, 'base64');
    res.type(mime);
    return res.send(buffer);
  }

  return res.json(parsed);
};
