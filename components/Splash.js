'use strict';

// Constants
const {
  BRAND_NAME,
  BRAND_TAGLINE,
  ENABLE_LOGIN,
  ENABLE_REGISTRATION
} = require('../constants');

// Strings
// TODO: use i18n (e.g., call i18n.t('pitch.cta.text') etc.)
const { PITCH_CTA_TEXT } = require('../locales/en');

// Dependencies
const React = require('react');
const { Link, Navigate, Route, Routes, Switch } = require('react-router-dom');

// Semantic UI
const {
  Button,
  Card,
  Header,
  Image,
  Label,
  Menu,
  Segment
} = require('semantic-ui-react');

// Components
const FrontPage = require('./FrontPage');

/**
 * Home page for visitors (not yet logged in).
 */
class Splash extends React.Component {
  render () {
    const { auth, login, register, error, onLoginSuccess, onRegisterSuccess } = this.props;
    return (
      <fabric-hub-splash className='fade-in splash'>
        <fabric-component className='ui primary action fluid container'>
          <Routes>
            <Route path='/' element={<FrontPage login={login} error={error} onLoginSuccess={onLoginSuccess} createInquiry={this.props.createInquiry} inquiries={this.props.inquiries} />} />
          </Routes>
        </fabric-component>
      </fabric-hub-splash>
    );
  }
}

module.exports = Splash;
