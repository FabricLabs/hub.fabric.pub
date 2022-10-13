const LIMIT_PER_PAGE = 3;

import React from 'react';
import '../styles/dashboard.css';
import '../libraries/fomantic/dist/semantic.css';

import {
  Header,
  Segment
} from 'semantic-ui-react';

export default class Hub extends React.Component {
  state = {
    network: 'playnet'
  }

  constructor (props = {}) {
    super(props);

    this._state = {
      assets: {},
      content: this.state // TODO: inherit get state () from Actor
    };

    this.ref = React.createRef();

    return this;
  }

  componentDidMount () {
    console.log('[DASHBOARD]', 'Mounted!', this);
  }

  trust (source) {
    source.on('log', this._handleSourceLog.bind(this));
  }

  _handleBridgeChange (change) {
    console.log('[DASHBOARD] Bridge Reported Change:', change);
  }

  _handleBridgeReady (info) {
    console.log('[DASHBOARD] Bridge Reported Ready:', info);
  }

  _handleSourceLog (log) {
    this.emit('log', `Source log: ${log}`);
  }

  render () {
    return (
      <fabric-content-page className="ui page" ref={this.ref}>
        <Segment>
          <Header>
            <h1>@fabric/hub</h1>
          </Header>
        </Segment>
        <FabricBridge path="/" onChange={this._handleBridgeChange.bind(this)} host="localhost" port="3000" secure="false" />
        {/* <Sample host="localhost" secure="false" port="3000" /> */}
      </fabric-content-page>
    );
  }
}
