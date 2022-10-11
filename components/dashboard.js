const Component = require('@fabric/http/types/component');

class Dashboard extends Component {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      status: 'PAUSED'
    }, settings);

    return this;
  }
}

module.exports = Dashboard;
