'use strict';

const React = require('react');
const { Link, useParams } = require('react-router-dom');
const { Button, Header, Icon, Label, List, Loader, Message, Segment } = require('semantic-ui-react');
const { fetchLightningChannels, loadUpstreamSettings } = require('../functions/bitcoinClient');
const t = require('../locales/en');

const c = t.bitcoin.channel;
const CHANNEL_NOT_FOUND = 'channel-not-found';

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
      setError(null);
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
          setError(CHANNEL_NOT_FOUND);
        }
      })
      .catch((err) => {
        setChannel(null);
        setError(err && err.message ? err.message : c.loadFailedFallback);
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
        if (data && data.status === 'error') throw new Error(data.message || data.error || c.closeRefused);
        loadChannel();
      })
      .catch((err) => {
        setCloseError(err && err.message ? err.message : c.closeFailed);
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
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.75em', flexWrap: 'wrap', marginBottom: '0.25em' }}
          role="banner"
        >
          <Button as={Link} to="/services/bitcoin" basic size="small" title={t.bitcoin.shared.backToBitcoinTitle}>
            <Icon name="arrow left" aria-hidden="true" />
            {t.bitcoin.shared.backToBitcoin}
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5em', flexWrap: 'wrap', flex: '1 1 auto' }}>
            <Header as="h2" style={{ margin: 0 }}>
              <Icon name="bolt" color="yellow" aria-hidden="true" />
              <Header.Content>{c.title}</Header.Content>
            </Header>
            {channel && channel.state && (
              <Label
                color={channel.state === 'CHANNELD_NORMAL' ? 'green' : 'orange'}
                size="small"
                title={c.stateTitle}
                aria-hidden="true"
              >
                {channel.state}
              </Label>
            )}
          </div>
        </div>
      </Segment>

      {!channelId && (
        <Message warning>
          <Message.Header>{c.missingTitle}</Message.Header>
          <p>{c.missingBody}</p>
        </Message>
      )}

      {!!channelId && loading && (
        <Segment>
          <Loader active inline="centered" />
          <p style={{ textAlign: 'center', marginTop: '1em', color: '#666' }}>{c.loading}</p>
        </Segment>
      )}

      {!!channelId && error && !loading && error === CHANNEL_NOT_FOUND && (
        <Message warning>
          <Message.Header>{c.notFoundTitle}</Message.Header>
          <p>{c.notFoundBody}</p>
          <p style={{ marginTop: '0.5em', fontSize: '0.9em', color: '#555' }}>
            <code style={{ wordBreak: 'break-all' }}>{channelId}</code>
          </p>
          <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button type="button" size="small" onClick={() => void loadChannel()}>
              <Icon name="refresh" />
              {t.common.actions.retry}
            </Button>
            <Button as={Link} to="/services/bitcoin" size="small" basic>
              <Icon name="bitcoin" />
              {t.bitcoin.shared.backToBitcoin}
            </Button>
          </div>
        </Message>
      )}

      {!!channelId && error && !loading && error !== CHANNEL_NOT_FOUND && (
        <Message negative>
          <Message.Header>{c.loadFailed}</Message.Header>
          <p>{error}</p>
          <div style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', flexWrap: 'wrap' }}>
            <Button type="button" size="small" onClick={() => void loadChannel()}>
              <Icon name="refresh" />
              {t.common.actions.retry}
            </Button>
            <Button as={Link} to="/services/bitcoin" size="small" basic>
              <Icon name="bitcoin" />
              {t.bitcoin.shared.backToBitcoin}
            </Button>
          </div>
        </Message>
      )}

      {!loading && !error && channel && (
        <>
          <Segment>
            <List divided>
              <List.Item>
                <List.Content>
                  <List.Header>{c.channelId}</List.Header>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{channel.channel_id || t.common.none}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>{c.peer}</List.Header>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.9em' }}>{channel.peer_id ? trimHash(channel.peer_id, 12, 12) : t.common.none}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>{c.shortChannelId}</List.Header>
                  <code>{channel.short_channel_id || t.common.none}</code>
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>{c.state}</List.Header>
                  {channel.state || t.common.none}
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>{c.capacity}</List.Header>
                  {capacitySats != null ? t.common.sats(capacitySats) : t.common.none}
                </List.Content>
              </List.Item>
              <List.Item>
                <List.Content>
                  <List.Header>{c.ourBalance}</List.Header>
                  {ourSats != null ? t.common.sats(ourSats) : t.common.none}
                </List.Content>
              </List.Item>
              {channel.funding_txid && (
                <List.Item>
                  <List.Content>
                    <List.Header>{c.funding}</List.Header>
                    <Button size="mini" as={Link} to={`/services/bitcoin/transactions/${encodeURIComponent(channel.funding_txid)}`} basic>
                      <Icon name="bitcoin" />
                      {t.bitcoin.shared.viewTransaction}
                    </Button>
                  </List.Content>
                </List.Item>
              )}
            </List>
            <Button size="small" basic onClick={loadChannel} style={{ marginTop: '0.5em' }}>
              <Icon name="refresh" />
              {t.common.actions.refresh}
            </Button>
          </Segment>

          {canClose && (
            <Segment>
              <Header as="h4">{c.closeTitle}</Header>
              <p style={{ color: '#666', marginBottom: '0.5em' }}>
                {c.closeIntro}
              </p>
              {closeError && (
                <Message negative size="small" style={{ marginBottom: '0.5em' }}>
                  {closeError}
                </Message>
              )}
              <Button
                type="button"
                color="red"
                loading={closeLoading}
                disabled={closeLoading}
                onClick={handleClose}
              >
                <Icon name="close" />
                {c.close}
              </Button>
            </Segment>
          )}
        </>
      )}
    </div>
  );
}

module.exports = ChannelView;
