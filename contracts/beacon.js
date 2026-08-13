'use strict';

/**
 * Hub Beacon — `@fabric/core/types/beacon` with Hub defaults.
 * Epoch seal, sidechain digests, and ready-round retry finalize live in core.
 */

const CoreBeacon = require('@fabric/core/types/beacon');

class Beacon extends CoreBeacon {
  constructor (settings = {}) {
    super(Object.assign({ name: 'HUB:BEACON' }, settings));
  }
}

Beacon.BEACON_CHAIN_PATH = CoreBeacon.BEACON_CHAIN_PATH;
Beacon.SATS_PER_BTC = CoreBeacon.SATS_PER_BTC;

module.exports = Beacon;
