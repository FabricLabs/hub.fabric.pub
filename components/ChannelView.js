'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Header, Icon, Label, List, Loader, Message, Segment } = require('semantic-ui-react');
const { fetchLightningChannels, loadUpstreamSettings } = require('../functions/bitcoinClient');
const { formatSatsDisplay } = require('../functions/formatSats');

function trimHash (value = '', left = 8, right = 8) {
  const text = String(value || '');
  if (text.length <= left + right + 1) return text;
  return `${text.slice(0, left)}…${text.slice(-right)}`;
}

function ChannelView () {
  const { id } = useParams();
  const channelId = (id || '').trim();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [channel, setChannel] = React.useState(null);
  const [closeLoading, setCloseLoading] = React.useState(false);
  const [closeError, setCloseError] = React.useState(null);

  const loadChannel = React.useCallback(() => {
    if (!channelId) {
      setLoading(false);
      setError('Channel ID is required.');
      setChannel(null);
      return;
    }
    setLoading(true);
    setError(null);
    const upstream = loadUpstreamSettings();
    fetchLightningChannels(upstream)
      .then((res) => {
        const channels = Array.isArray(res.channels) ? res.channels : [];
        const match = channels.find(
          (ch) =>
            (ch.channel_id && String(ch.channel_id) === channelId) ||
            (ch.funding_txid && String(ch.funding_txid) === channelId)
        );
        if (match) {
          setChannel(match);
          setError(null);
        } else {
          setChannel(null);
          setError('Channel not found.');
        }
      })
      .catch((err) => {
        setChannel(null);
        setError(err && err.message ? err.message : 'Failed to load channel.');
      })
      .finally(() => setLoading(false));
  }, [channelId]);

  React.useEffect(() => {
    loadChannel();
  }, [loadChannel]);

  const handleClose = () => {
    if (!channel || !channel.channel_id) return;
    setCloseLoading(true);
    setCloseError(null);
    const upstream = loadUpstreamSettings();
    const baseUrl = (upstream.lightningBaseUrl || '/services/lightning').replace(/\/+$/, '');
    const cid = encodeURIComponent(String(channel.channel_id));
    const url = `${baseUrl}/channels/${cid}`;
    const headers = { Accept: 'application/json' };
    const token = String(upstream.apiToken || '').trim();
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(url, {
      method: 'DELETE',
      headers
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && data.status === 'error') throw new Error(data.message || data.error || 'Close failed');
        loadChannel();
      })
      .catch((err) => {
        setCloseError(err && err.message ? err.message : 'Failed to close channel.');
      })
      .finally(() => setCloseLoading(false));
  };

  const capacitySats = channel && (channel.amount_msat != null || channel.channel_sat != null)
    ? (channel.amount_msat != null ? Math.floor(Number(channel.amount_msat) / 1000) : Number(channel.channel_sat))
    : null;
  const ourSats = channel && channel.our_amount_msat != null
    ? Math.floor(Number(channel.our_amount_msat) / 1000)
    : null;
  const canClose = channel && channel.channel_id && (channel.state === 'CHANNELD_NORMAL' || channel.state === 'CHANNELD_AWAITING_LOCKIN');

  return (
    <div className='fade-in'>
      <Segment>
        <Header as='h2' style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap' }}>
          <Button as={Link} to="/contracts" basic size='small'>
            <Icon name='arrow left' />
            Back
          </Button>
          <Icon name='bolt' color='yellow' />
          <Header.Content>Lightning Channel</Header.Content>
          {channel && channel.state && (
            <Label color={channel.state === 'CHANNELD_NORMAL' ? 'green' : 'orange'} size="small">
              {channel.state}
            </Label>
          )}
        </Header>
      </Segment>

      {!channelId && (
        <Message warning>
          <Message.Header>Missing channel ID</Message.Header>
          <p>Provide a channel ID in the URL.</p>
        </Message>
      )}

      {loading && (
        <Segment>
          <Loader active inline="centered" />
          <p style={{ textAlign: 'center', marginTop: '1em', color: '#666' }}>Loading channel…</p>
        </Segment>
      )}

      {error && !loading && (
        <Message negative>
          <Message.Header>Error</Message.Header>
          <p>{error}</p>
          <Button size="small" onClick={loadChannel} style={{ marginTop: '0.5em' }}>
            <Icon name="refresh" />
            Retry
          </Button>
        </Message>
      )}

      {!loading && !error && channel && (
        <>
          <Segment>
            <List divided>
              <List.Item>
                <List.Content>
                  <List.Header>Channel ID</List.Header>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{channel.channel_id || '—'}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Peer</List.Header>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{channel.peer_id ? trimHash(channel.peer_id, 12, 12) : '—'}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Short channel ID</List.Header>
                  <code>{channel.short_channel_id || '—'}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>State</List.Header>
                  {channel.state || '—'}
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Capacity</List.Header>
                  {capacitySats != null ? `${formatSatsDisplay(capacitySats)} sats` : '—'}
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>Our balance</List.Header>
                  {ourSats != null ? `${formatSatsDisplay(ourSats)} sats` : '—'}
                </List.Content>
              </List.Item>
              {channel.funding_txid && (
                <List.Item>
                  <List.Content>
                    <List.Header>Funding transaction</List.Header>
                    <Button size="mini" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(channel.funding_txid)}`} basic>
                      <Icon name="bitcoin" />
                      View transaction
                    </Button>
                  </List.Content>
                </List.Item>
              )}
            </List>
            <Button size="small" basic onClick={loadChannel} style={{ marginTop: '0.5em' }}>
              <Icon name="refresh" />
              Refresh
            </Button>
          </Segment>

          {canClose && (
            <Segment>
              <Header as="h4">Close channel</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}>
                Closing cooperatively returns funds to your wallet after the closing transaction confirms.
              </p>
              {closeError && (
                <Message negative size="small" style={{ marginBottom: '0.5em' }}>
                  {closeError}
                </Message>
              )}
              <Button
                color="red"
                loading={closeLoading}
                disabled={closeLoading}
                onClick={handleClose}
              >
                <Icon name="close" />
                Close channel
              </Button>
            </Segment>
          )}
        </>
      )}
    </div>
  );
}

module.exports = ChannelView;
