'use strict';

const React = require('react');
const { Button, Icon } = require('semantic-ui-react');

function ChatInput (props) {
  const {
    value,
    onChange,
    onSubmit,
    placeholder = 'Type a message…',
    disabled = false,
    title
  } = props;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!onSubmit) return;
    const text = (value || '').trim();
    if (!text) return;
    onSubmit(text);
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{ marginTop: '0.75em', display: 'flex', gap: '0.5em', alignItems: 'center' }}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{ flex: 1, padding: '0.4em 0.6em', borderRadius: '4px', border: '1px solid rgba(34,36,38,.15)' }}
      />
      <Button
        size="small"
        primary
        type="submit"
        disabled={disabled || !value || !value.trim()}
        title={title || 'Send message'}
      >
        <Icon name="send" />
        Send
      </Button>
    </form>
  );
}

module.exports = ChatInput;

