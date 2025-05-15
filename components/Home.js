'use strict';

// Dependencies
const React = require('react');
const { useLocation } = require('react-router-dom');

const {
  Card,
  Header,
  Segment
} = require('semantic-ui-react');

const ActivityStream = require('./ActivityStream');

class Home extends React.Component {
  componentDidUpdate (prevProps) {
    if (this.props.location?.key !== prevProps.location?.key) {
      this.setState({
        chat: {
          message: null,
          messages: []
        },
        message: null
      });
    }
  }

  render () {
    return (
      <fabric-hub-home class='fade-in'>
        <Segment fluid style={{ clear: 'both' }}>
          <Header as='h1'><code>hub.fabric.pub</code></Header>
          <p>all things fabric</p>
        </Segment>
        <Segment>
          <Header as='h2'>Network Status</Header>
        </Segment>
        <Segment>
          <Header as='h2'>Activity</Header>
          <ActivityStream />
        </Segment>
      </fabric-hub-home>
    );
  }
}

function HomeWithLocation (props) {
  const location = useLocation();
  return <Home {...props} location={location} />;
}

module.exports = HomeWithLocation;
