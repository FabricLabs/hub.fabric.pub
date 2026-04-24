const {
  BRIDGE_SYNC_REQUEST,
  BRIDGE_SYNC_SUCCESS,
  BRIDGE_SYNC_FAILURE,
  BRIDGE_NETWORK_STATUS_UPDATE
} = require('../actions/bridgeActions');

const initialState = {
  status: 'INITIALIZED',
  current: {},
  loading: false,
  error: null
};

function bridgeReducer (state = initialState, action) {
  switch (action.type) {
    case BRIDGE_SYNC_REQUEST:
      return { ...state, loading: true, error: null };
    case BRIDGE_SYNC_SUCCESS:
      // Never clobber existing state like `networkStatus` during sync.
      return { ...state, loading: false, current: { ...state.current, ...action.payload } };
    case BRIDGE_SYNC_FAILURE:
      return { ...state, loading: false, error: action.payload };
    case BRIDGE_NETWORK_STATUS_UPDATE:
      // Ignore non-network payloads (e.g. `{ status: "success" }`) to prevent UI flicker.
      if (!action.payload || typeof action.payload !== 'object') return state;
      if (!action.payload.network && !Array.isArray(action.payload.peers)) return state;
      return {
        ...state,
        current: {
          ...state.current,
          networkStatus: action.payload,
          lastNetworkStatus: action.payload
        }
      };
    default:
      // console.warn('Unhandled action in bridge reducer:', action);
      return state;
  }
}

module.exports = bridgeReducer;
