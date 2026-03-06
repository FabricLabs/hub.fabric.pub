'use strict';

const React = require('react');
const { Segment, Header, Icon, Button, Input, Loader } = require('semantic-ui-react');

class BitcoinHome extends React.Component {
  render () {
    return (
      <Segment>
        <Header as='h2'>Bitcoin</Header>
      </Segment>
    );
  }
}

module.exports = BitcoinHome;
