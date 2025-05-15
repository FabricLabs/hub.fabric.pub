'use strict';

// Dependencies
const fetch = require('cross-fetch');
const React = require('react');

class ActivityStreamElement extends React.Component {
  constructor (props) {
    super(props);

    this.settings = Object.assign({
      authority: 'https://hub.fabric.pub',
      includeHeader: true,
      activities: []
    }, props);

    this.state = {
      ...this.settings
    };

    return this;
  }

  componentDidMount () {
    console.debug('[FABRIC:STREAM]', 'Stream mounted!');
    if (this.props.fetchResource) this.props.fetchResource('/activities');
  }

  async fetchResource (path) {
    // TODO: use Bridge to send `GET_DOCUMENT` request
    const authority = await fetch(`${this.settings.authority}${path}`);
    console.debug('authority says:', authority);
    // TODO: load other sources (local, etc.)
  }

  render () {
    const { activities = [] } = this.props.api?.resource || {};
    return (
      <fabric-activity-stream className='activity-stream'>
        {this.props.includeHeader && <h3>Activity Stream</h3>}
        <div>
          {activities.map((activity, index) => {
            return (
              <div key={index}>
                <strong>{activity.actor}</strong> {activity.verb} <strong>{activity.object}</strong>
              </div>
            );
          })}
        </div>
      </fabric-activity-stream>
    );
  }
}

function ActivityStream (props) {
  return <ActivityStreamElement {...props} />;
}

module.exports = ActivityStream;
