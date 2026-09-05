'use strict';

const React = require('react');
const ClientNeedsHub = require('./ClientNeedsHub');
const {
  HUB_UI_RUNTIME_HUB,
  HUB_UI_RUNTIME_CLIENT
} = require('../functions/hubClientEnvironment');

/**
 * Hub HTTP availability for the SPA. Default `'hub'` so isolated component tests
 * keep the full operator chrome unless a Provider sets `'client'`.
 */
const HubUiRuntimeContext = React.createContext(HUB_UI_RUNTIME_HUB);

/**
 * True when the HTML client has at least one OPTIONS-capable seed (WebRTC / inventories)
 * or this origin is a live Hub.
 */
const HubMeshContext = React.createContext(false);

function useHubUiRuntime () {
  return React.useContext(HubUiRuntimeContext);
}

function useHubHttpAvailable () {
  return useHubUiRuntime() !== HUB_UI_RUNTIME_CLIENT;
}

function useHubMeshAvailable () {
  return !!React.useContext(HubMeshContext);
}

function HubHttpRoute ({ children }) {
  const available = useHubHttpAvailable();
  if (!available) return React.createElement(ClientNeedsHub);
  return children;
}

function HubMeshRoute ({ children }) {
  const hub = useHubHttpAvailable();
  const mesh = useHubMeshAvailable();
  if (!hub && !mesh) return React.createElement(ClientNeedsHub);
  return children;
}

module.exports = {
  HubUiRuntimeContext,
  HubMeshContext,
  useHubUiRuntime,
  useHubHttpAvailable,
  useHubMeshAvailable,
  HubHttpRoute,
  HubMeshRoute,
  HUB_UI_RUNTIME_HUB,
  HUB_UI_RUNTIME_CLIENT
};
