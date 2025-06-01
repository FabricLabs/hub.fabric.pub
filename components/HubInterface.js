'use strict';

// Constants
const {
  BRAND_NAME,
  BROWSER_DATABASE_NAME,
  BROWSER_DATABASE_TOKEN_TABLE
} = require('../constants');

// Dependencies
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const { renderToString } = require('react-dom/server');
const {
  BrowserRouter
} = require('react-router-dom');

// Components
const Home = require('./Home');
const Bridge = require('./Bridge');

// Semantic UI
const {
  Modal,
  Button,
  Header,
  Loader
  } = require('semantic-ui-react');

/**
 * The Hub UI.
 */
class HubInterface extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      debug: false,
      isAuthenticated: false,
      isLoading: true,
      modalLogOut: false,
      loggedOut: false,
    };

    this.handleBridgeStateUpdate = this.handleBridgeStateUpdate.bind(this);

    // Instantiate Bridge once here
    this.bridgeRef = React.createRef();

    this._state = {
      actors: {},
      content: this.state
    };

    return this;
  }

  componentDidMount () {
    console.debug('[HUB]', 'Component mounted!');
  }

  handleBridgeStateUpdate (newState) {
    this.setState(newState);
  }

  render () {
    return (
      <fabric-interface id={this.id} class="fabric-site">
        <style>
          {`
            fabric-react-component {
              margin: 1em;
            }
          `}
        </style>
        <fabric-container id="react-application">{/* TODO: render string here */}</fabric-container>
        <fabric-react-component id='fabric-hub-application' style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          <Bridge ref={this.bridgeRef} debug={this.state.debug} onStateUpdate={this.handleBridgeStateUpdate} />
          {(this.props.auth && this.props.auth.loading) ? (
            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Loader active inline="centered" size='huge' />
            </div>) : <BrowserRouter>
            <Home
              auth={this.props.auth}
              fetchContract={this.props.fetchContract}
              contracts={this.props.contracts}
              bridge={this.bridgeRef.current}
              state={this.state}
              {...this.props}
            />
          </BrowserRouter>}
        </fabric-react-component>
      </fabric-interface>
    )
  }

  _getHTML () {
    const component = this.render();
    return renderToString(component);
  }

  _toHTML () {
    return ReactDOMServer.renderToString(this.render());
  }

  toHTMLFragment () {
    return this._toHTML();
  }

  toHTML () {
    return this._toHTML();
  }
}

module.exports = HubInterface;
