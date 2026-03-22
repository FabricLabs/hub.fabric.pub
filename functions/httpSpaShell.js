'use strict';

/**
 * When the browser navigates (refresh) to a path that is also a JSON API route,
 * prefer the SPA shell if Accept's first type is text/html.
 * Fetch/XHR typically sends star-slash-star or application/json first — not text/html.
 */

function acceptFirstHtmlNavigation (req) {
  const a = req.headers && req.headers.accept;
  if (typeof a !== 'string') return false;
  const first = a.split(',')[0].trim().toLowerCase().split(';')[0];
  return first === 'text/html';
}

function serveSpaShellIfHtmlNavigation (hub, req, res) {
  if (!acceptFirstHtmlNavigation(req)) return false;
  const html = hub && hub.applicationString;
  if (typeof html !== 'string' || !html) return false;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
  return true;
}

module.exports = {
  acceptFirstHtmlNavigation,
  serveSpaShellIfHtmlNavigation
};
