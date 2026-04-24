'use strict';

const {
  ENABLE_LOGIN
} = require('../constants');

// Dependencies
const React = require('react');
const { Link } = require('react-router-dom');

// Semantic UI
const {
  Card,
  Form,
  Button,
  Icon,
  Header,
  Image,
  Input,
  Label,
  Message
} = require('semantic-ui-react');

// Strings
// TODO: use i18n (e.g., call i18n.t('pitch.cta.text') etc.)
/* const {
  BRAND_NAME,
  BRAND_TAGLINE,
  PITCH_CTA_TEXT
} = require('../locales/en'); */
const BRAND_NAME = 'hub.fabric.pub';

class HeaderBar extends React.Component {
  constructor (props) {
    super(props);

    this.state = {
      email: '',
      error: null,
      loading: false,
      joined: false,
      showBrand: true
    };
  }

  render () {
    const { showBrand } = this.props;
    return (
      <fabric-hub-header>
        {/* (showBrand) && <Link to='/' style={{ float: 'left' }}><Icon name='eye' size='big' style={{ verticalAlign: 'bottom' }} /> <span className='brand'>{BRAND_NAME}</span></Link> */}
        {/* <Button.Group floated='right'>
          <Button as={Link} to='/settings/security' color='green'><Icon name='key' /> Sign In</Button>
        </Button.Group> */}
        <br style={{ clear: 'both' }} />
      </fabric-hub-header>
    );
  }
}

module.exports = HeaderBar;
