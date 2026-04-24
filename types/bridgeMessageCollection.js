'use strict';

const Collection = require('@fabric/core/types/collection');

class BridgeMessageCollection extends Collection {
  constructor (settings = {}) {
    super(Object.assign({
      name: 'BridgeMessage',
      key: 'id',
      data: {}
    }, settings));
  }

  _map () {
    const m = this.value && this.value[this.path] ? this.value[this.path] : {};
    return (m && typeof m === 'object') ? m : {};
  }

  loadMap (map = {}) {
    this.value[this.path] = {};
    if (!map || typeof map !== 'object') return this;
    const out = {};
    for (const id of Object.keys(map)) out[id] = map[id];
    this.value[this.path] = out;
    return this;
  }

  exportMap () {
    const map = this._map();
    const out = {};
    for (const id of Object.keys(map)) out[id] = map[id];
    return out;
  }

  upsert (id, message) {
    if (!id) return this;
    this.value[this.path] = this._map();
    this.value[this.path][String(id)] = message;
    return this;
  }

  replay (applyMessage) {
    if (typeof applyMessage !== 'function') return 0;
    const map = this._map();
    const ids = Object.keys(map).sort((a, b) => {
      const ta = Number((map[a] && map[a].object && map[a].object.created) || 0);
      const tb = Number((map[b] && map[b].object && map[b].object.created) || 0);
      return ta - tb;
    });
    for (const id of ids) applyMessage(id, map[id]);
    return ids.length;
  }
}

module.exports = BridgeMessageCollection;
