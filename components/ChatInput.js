'use strict';

const React = require('react');
const { Input, Button } = require('semantic-ui-react');

function ChatInput (props) {
  const { value, onChange, onSubmit, placeholder, title, disabled, inputId, ariaDescribedBy } = props;

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = (value || '').trim();
      if (text && typeof onSubmit === 'function') onSubmit(text);
    }
  };

  const handleSubmit = () => {
    const text = (value || '').trim();
    if (text && typeof onSubmit === 'function') onSubmit(text);
  };

  return (
    <Input
      fluid
      action
      value={value || ''}
      onChange={(e) => typeof onChange === 'function' && onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder || 'Type a message…'}
      title={title}
      disabled={!!disabled}
    >
      <input
        id={inputId || undefined}
        aria-describedby={ariaDescribedBy || undefined}
      />
      <Button
        type="button"
        icon="send"
        color="teal"
        aria-label="Send message"
        title="Send message"
        disabled={!!disabled || !(value || '').trim()}
        onClick={handleSubmit}
      />
    </Input>
  );
}

module.exports = ChatInput;
