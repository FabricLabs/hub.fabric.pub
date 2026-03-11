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
      style={{
        marginTop: '0.75em',
        display: 'flex',
        alignItems: 'stretch'
      }}
    >
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{
          flex: 1,
          padding: '0.6em 0.8em',
          borderRadius: '4px 0 0 4px',
          border: '1px solid rgba(34,36,38,.15)',
          borderRight: 'none',
          outline: 'none'
        }}
      />
      <Button
        size="small"
        primary
        type="submit"
        disabled={disabled || !value || !value.trim()}
        title={title || 'Send message'}
        style={{
          borderRadius: '0 4px 4px 0',
          margin: 0
        }}
      >
        <Icon name="send" />
        Send
      </Button>
    </form>
  );
}

module.exports = ChatInput;

