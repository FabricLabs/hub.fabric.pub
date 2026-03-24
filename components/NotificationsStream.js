'use strict';

const React = require('react');
const ActivityStream = require('./ActivityStream');

/**
 * Delegation signature requests only (same row layout as chat; see ActivityStream).
 * The main Activities feed excludes these; wallet/Payjoin toasts live on /activities (bell).
 */
function NotificationsStream (props) {
  const { includeHeader, ...rest } = props;
  return (
    <ActivityStream
      {...rest}
      streamPreset="notifications"
      includeHeader={includeHeader !== undefined ? includeHeader : false}
    />
  );
}

module.exports = NotificationsStream;
