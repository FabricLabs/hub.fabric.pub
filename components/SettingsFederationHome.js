'use strict';

const React = require('react');
const FederationsHome = require('./FederationsHome');

/** Settings entry: same UI as `/federations`, compact “Distributed federation” heading. */
function SettingsFederationHome (props) {
  return (
    <FederationsHome
      adminToken={props && props.adminToken}
      settingsLayout
      bridgeRef={props && props.bridgeRef}
    />
  );
}

module.exports = SettingsFederationHome;
