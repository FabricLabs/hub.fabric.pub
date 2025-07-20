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
  constructor (props) {
    super(props);

    this.state = {
      networkStatus: null
    };

    return this;
  }

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

  componentDidMount () {
    this.trySendNetworkStatusRequest();
  }

  trySendNetworkStatusRequest () {
    const { bridge } = this.props;
    if (bridge && bridge.sendNetworkStatusRequest && typeof bridge.sendNetworkStatusRequest === 'function') {
      bridge.sendNetworkStatusRequest();
    } else {
      // Try again shortly if not ready
      setTimeout(() => this.trySendNetworkStatusRequest(), 250);
    }
  }

  render () {
    const { network } = this.state;
    return (
      <fabric-hub-home class='fade-in'>
        <Segment fluid style={{ clear: 'both' }}>
          <Header as='h1'><code>hub.fabric.pub</code></Header>
          <p>all things fabric</p>
        </Segment>
        <Segment>
          <Header as='h2'>Network Status</Header>
          {network ? (
            <Card fluid>
              <Card.Content>
                <Card.Header>Network Status</Card.Header>
                <Card.Description>
                  {network && network.address ? (
                    <div style={{ marginBottom: '1em' }}>
                      <strong>Address:</strong> {network.address}
                    </div>
                  ) : null}
                  <pre>{JSON.stringify(networkStatus, null, 2)}</pre>
                </Card.Description>
              </Card.Content>
            </Card>
          ) : (
            <p>Loading network status...</p>
          )}
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
