'use strict';

const Site = require('@fabric/http/types/site');

class Interface extends Site {
  _getHTML () {
    return `
      <${this.settings.handle}>
        <fabric-card class="ui card">
          <fabric-card-content class="content">
            <fabric-header>
              <h1><code>hub.fabric.pub</code></h1>
            </fabric-header>
          </fabric-card-content>
        </fabric-card>
      </${this.settings.handle}>
    `;
  }
}

module.exports = Interface;
