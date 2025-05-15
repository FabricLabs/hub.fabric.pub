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
class HubUI extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      isAuthenticated: false,
      isLoading: true,
      modalLogOut: false,
      loggedOut: false,
    };
  }

  componentDidMount () {
    console.debug('[HUB]', 'Component mounted!');
  }

  render () {
    return (
      <fabric-hub-ui id={this.id} class="fabric-site">
        <fabric-container id="react-application">{/* TODO: render string here */}</fabric-container>
        <fabric-react-component id='fabric-hub-application' style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          {(this.props.auth && this.props.auth.loading) ? (
            <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <Loader active inline="centered" size='huge' />
            </div>) : <BrowserRouter>
            <Home
              auth={this.props.auth}
              fetchContract={this.props.fetchContract}
              contracts={this.props.contracts}
              {...this.props}
            />
          </BrowserRouter>}
        </fabric-react-component>
      </fabric-hub-ui>
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

module.exports = HubUI;
