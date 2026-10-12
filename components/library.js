'use strict';

/**
 * Hub UI components registered with the @fabric/http catalog.
 * Resource handles in services/hub.js name these; define() rejects unknown handles.
 *
 * The React modules are JSX and are compiled by webpack. This process registers
 * a constructor for each handle and records that module as its source. define()
 * checks the handle only; it does not render the component.
 */

const path = require('path');

const catalogPath = path.join(
  path.dirname(require.resolve('@fabric/http/types/server')),
  '../functions/componentCatalog.js'
);
const { registerComponent } = require(catalogPath);

const SOURCES = {
  ContractHome: require.resolve('./ContractsHome'),
  ContractView: require.resolve('./ContractView'),
  DocumentHome: require.resolve('./DocumentList'),
  DocumentView: require.resolve('./DocumentView'),
  HubInterface: require.resolve('./HubInterface')
};

function registerHubComponent (handle) {
  const source = SOURCES[handle];
  function HubComponent (settings = {}) {
    this.settings = Object.assign({
      handle: handle,
      source: source
    }, settings);
  }
  HubComponent.source = source;
  registerComponent(HubComponent, handle);
  return HubComponent;
}

module.exports = {
  ContractHome: registerHubComponent('ContractHome'),
  ContractView: registerHubComponent('ContractView'),
  DocumentHome: registerHubComponent('DocumentHome'),
  DocumentView: registerHubComponent('DocumentView'),
  HubInterface: registerHubComponent('HubInterface')
};
