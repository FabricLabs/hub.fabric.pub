# Bridge Component Upgrade

This document describes the upgrade of the Bridge component to include downstream enhancements from sibling application repositories.

## Overview

The Bridge component has been significantly enhanced with the following features:

### New Features

1. **WebRTC Support via PeerJS**
   - Peer-to-peer communication capabilities
   - Automatic fallback to WebSocket when WebRTC is unavailable
   - Connection status tracking for both protocols

2. **JSON-Patch Support**
   - Real-time state updates using JSON-Patch protocol
   - Global state management for conversations, messages, users, documents, and tasks
   - Custom event emission for state change notifications

3. **Enhanced Connection Management**
   - Improved WebSocket connection handling with better error recovery
   - Automatic reconnection with exponential backoff
   - Connection status tracking and debugging

4. **Path-based Subscriptions**
   - Subscribe/unsubscribe to specific paths for real-time updates
   - Automatic path change detection and subscription management
   - Browser history integration

5. **Message Signing**
   - Cryptographic message signing capabilities
   - Support for authenticated communication
   - Key-based identity management

6. **Improved Message Handling**
   - Better message validation and error handling
   - Support for multiple message data types (ArrayBuffer, Blob, String)
   - Enhanced JSON-Patch message processing

### Backward Compatibility

The enhanced Bridge component maintains full backward compatibility with existing code:

- `onStateUpdate` prop support for existing components
- `sendNetworkStatusRequest()` method preserved
- Existing WebSocket functionality unchanged
- All existing props and methods continue to work

### New Dependencies

The following dependencies have been added to `package.json`:

- `fast-json-patch`: "=3.1.1" - For JSON-Patch operations
- ~~`peerjs`~~ — removed; WebRTC uses native APIs + Hub signaling (see `components/Bridge.js`)

### New Methods

The Bridge component now provides these additional methods:

- `getGlobalState()` - Get current global state
- `updateGlobalState(patchMessage)` - Update global state with JSON-Patch
- `resetGlobalState()` - Reset global state to initial values
- `subscribe(path)` - Subscribe to state changes at a specific path
- `unsubscribe(path)` - Unsubscribe from state changes at a specific path
- `getConnectionStatus()` - Get connection status for both WebSocket and WebRTC
- `sendViaWebRTC(message)` - Send message preferring WebRTC
- `sendViaWebSocket(message)` - Send message preferring WebSocket
- `reconnectWebRTC()` - Reconnect WebRTC if connection is lost
- `signMessage(message)` - Sign a message with the component's signing key
- `sendSignedMessage(message, preferWebRTC)` - Send a signed message

### New State Properties

The component state now includes:

- `subscriptions`: Set of subscribed paths
- `isConnected`: WebSocket connection status
- `webrtcConnected`: WebRTC connection status
- `currentPath`: Current browser path

### Configuration Options

New configuration options in the settings:

- `signingKey`: Key for message signing
- `tickrate`: Updated default to 250ms for better performance

### Usage Examples

#### Basic Usage (Backward Compatible)
```javascript
<Bridge responseCapture={this.responseCapture} />
```

#### With WebRTC and Signing
```javascript
<Bridge
  responseCapture={this.responseCapture}
  auth={userKey}
  debug={true}
/>
```

#### Subscribing to Path Changes
```javascript
// The component automatically subscribes to the current path
// and manages subscriptions when the path changes
```

#### Using Global State
```javascript
// Listen for global state updates
window.addEventListener('globalStateUpdate', (event) => {
  console.log('Global state updated:', event.detail);
});

// Get current global state
const globalState = bridgeRef.current.getGlobalState();
```

#### Sending Messages
```javascript
// Send via WebRTC (preferred)
bridgeRef.current.sendViaWebRTC(message);

// Send via WebSocket
bridgeRef.current.sendViaWebSocket(message);

// Send signed message
bridgeRef.current.sendSignedMessage(message, true);
```

### Migration Notes

1. **No Breaking Changes**: Existing code should continue to work without modification
2. **Optional Features**: WebRTC and JSON-Patch features are optional and gracefully degrade
3. **Performance**: The component now has better performance with improved message handling
4. **Debugging**: Enhanced debug output for connection status and message processing

### Testing

The enhanced Bridge component has been tested for:
- Backward compatibility with existing components
- WebRTC connection establishment and fallback
- JSON-Patch state updates
- Message signing and verification
- Path-based subscriptions
- Connection recovery and error handling

All existing tests continue to pass, and the component maintains the same API surface while providing significant new capabilities.
