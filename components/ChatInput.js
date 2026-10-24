'use strict';

const React = require('react');
const { Input, Button } = require('semantic-ui-react');
const t = require('../locales/en');

const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0
};

function ChatInput (props) {
  const { value, onChange, onSubmit, placeholder, title, disabled, inputId, ariaDescribedBy, label } = props;
  const c = t.home.chatInput;
  const generatedId = React.useId();
  const id = inputId || `chat-input-${generatedId}`;
  const accessibleName = label || c.label;

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
    <>
      <label htmlFor={id} style={VISUALLY_HIDDEN}>{accessibleName}</label>
      <Input
        fluid
        action
        value={value || ''}
        onChange={(e) => typeof onChange === 'function' && onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder || c.placeholder}
        title={title}
        disabled={!!disabled}
      >
        <input
          id={id}
          aria-label={accessibleName}
          aria-describedby={ariaDescribedBy || undefined}
        />
        <Button
          type="button"
          icon="send"
          color="teal"
          aria-label={c.send}
          title={c.send}
          disabled={!!disabled || !(value || '').trim()}
          onClick={handleSubmit}
        />
      </Input>
    </>
  );
}

module.exports = ChatInput;
