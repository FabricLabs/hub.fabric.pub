'use strict';

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

// Components
// Semantic UI
const {
  Button,
  Container,
  Header,
  Icon
} = require('semantic-ui-react');

// Local Components
const HeaderBar = require('./HeaderBar');

// Strings
// TODO: use i18n (e.g., call i18n.t('pitch.cta.text') etc.)
const {
  BRAND_NAME,
  BRAND_TAGLINE,
  PITCH_CTA_TEXT
} = require('../locales/en');

class FrontPage extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      email: '',
      error: null,
      loading: false,
      joined: false
    };

    return this;
  }

  render () {
    return (
      <fabric-hub-front-page class='splash-page fade-in'>
        <HeaderBar showBrand={false} showButtons={false} />
        {/* Hero Section */}
        <div className='ui vertical masthead center aligned segment' style={{ padding: '8em 0em' }}>
          <Container text>
            <Header as='h1' style={{ fontSize: '4em', fontWeight: 'normal', marginBottom: '0.5em' }}>
              {BRAND_NAME}
            </Header>
            <p style={{ fontSize: '1.5em', marginBottom: '1.5em', color: 'rgba(0,0,0,0.6)' }}>
              {BRAND_TAGLINE}
            </p>
            <Button.Group size='huge'>
              <Button color='blue' as={Link} to='/settings/security' icon labelPosition='left'>
                <Icon name='user' />Log In
              </Button>
              <Button color='green' as={Link} to='/features' icon labelPosition='right'>
                Learn More<Icon name='right chevron' />
              </Button>
            </Button.Group>
          </Container>
        </div>
        {/* Features Section */}
        <div className='ui vertical stripe segment'>
          <Container text>
            <Header as='h2' style={{ fontSize: '2em', textAlign: 'center' }}>
              {PITCH_CTA_TEXT}
            </Header>
            <div className='ui three column stackable grid' style={{ marginTop: '3em' }}>
              <div className='column'>
                <div className='ui segment'>
                  <Header as='h3' style={{ textAlign: 'center' }}>
                    <Icon name='shield' size='large' />
                    <Header.Content>Security</Header.Content>
                  </Header>
                  <p style={{ textAlign: 'center' }}>
                    Enterprise-grade security with end-to-end encryption
                  </p>
                </div>
              </div>
              <div className='column'>
                <div className='ui segment'>
                  <Header as='h3' style={{ textAlign: 'center' }}>
                    <Icon name='users' size='large' />
                    <Header.Content>Collaboration</Header.Content>
                  </Header>
                  <p style={{ textAlign: 'center' }}>
                    Real-time collaboration tools for your team
                  </p>
                </div>
              </div>
              <div className='column'>
                <div className='ui segment'>
                  <Header as='h3' style={{ textAlign: 'center' }}>
                    <Icon name='chart line' size='large' />
                    <Header.Content>Analytics</Header.Content>
                  </Header>
                  <p style={{ textAlign: 'center' }}>
                    Powerful insights and analytics dashboard
                  </p>
                </div>
              </div>
            </div>
          </Container>
        </div>
      </fabric-hub-front-page>
    );
  }
}

module.exports = FrontPage;
