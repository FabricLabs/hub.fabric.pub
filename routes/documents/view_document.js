'use strict';

const payments = require('@fabric/http/middlewares/payments');
const { sendPaymentRequired402Response } = require('../../functions/resolveFabricHttpSend402');
const { isPaymentsEnabled } = payments;

function resolvePublishedDocument (hub, id) {
  const collections =
    hub._state &&
    hub._state.content &&
    hub._state.content.collections &&
    hub._state.content.collections.documents;
  if (collections && collections[id]) return collections[id];
  if (hub._state && hub._state.documents && hub._state.documents[id]) return hub._state.documents[id];
  try {
    const c = hub.state && hub.state.collections && hub.state.collections.documents;
    if (c && c[id]) return c[id];
  } catch (_) {}
  return undefined;
}

module.exports = async function (req, res, next) {
  const resolvedId = req.params.id;
  const hub = this;
  const docMeta = resolvePublishedDocument(hub, resolvedId);

  const pay =
    hub.http && hub.http.settings ? hub.http.settings.payments || {} : {};
  const priceSatsRaw = docMeta != null ? docMeta.purchasePriceSats : null;
  const priceSats = Number(priceSatsRaw);
  const willWall402 =
    hub.http &&
    isPaymentsEnabled(pay) &&
    docMeta &&
    Number.isFinite(priceSats) &&
    priceSats > 0;

  res.format({
    'application/json': () => {
      if (willWall402) {
        void sendPaymentRequired402Response(hub.http, req, res, {
          paymentSettings: {
            detail:
              typeof docMeta.name === 'string' && docMeta.name.trim()
                ? `Payment required to access “${docMeta.name.slice(0, 240)}”.`
                : 'Payment required for this published document.',
            amount: Math.max(1e-8, priceSats / 1e8),
            documentOffer: {
              documentId: resolvedId,
              ...(typeof docMeta.sha256 === 'string' ? { contentHashHex: docMeta.sha256.slice(0, 128) } : {}),
              purchasePriceSats: Math.round(priceSats),
              ...(hub.settings && hub.settings.bitcoin && hub.settings.bitcoin.network
                ? { network: String(hub.settings.bitcoin.network).slice(0, 64) }
                : {})
            }
          }
        }).catch((err) => {
          console.error('[HUB][document:402]', err);
          if (!res.headersSent) {
            res.status(500).json({
              status: 'error',
              message: 'Could not build payment requirement for this document.'
            });
          }
        });
        return undefined;
      }

      if (!docMeta) {
        return res.status(404).json({ error: 'Document not found' });
      }

      return res.json(docMeta);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
