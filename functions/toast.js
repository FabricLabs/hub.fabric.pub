'use strict';

/**
 * Global toast emitter (pattern from sensemaker) — Dashboard listens via toast.addListener.
 * Use with react-toastify in HubInterface.
 */
class ToastEmitter {
  constructor () {
    this.listeners = [];
  }

  addListener (callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  emit (toast) {
    this.listeners.forEach((listener) => listener(toast));
  }
}

const toastEmitter = new ToastEmitter();
let toastIdCounter = 0;
const generateToastId = () => `toast_${++toastIdCounter}_${Date.now()}`;

const toast = {
  success: (message, options = {}) => {
    toastEmitter.emit({
      id: generateToastId(),
      type: 'success',
      message,
      duration: options.duration || 4000,
      dismissOnClick: options.dismissOnClick !== false,
      header: options.header,
      ...options
    });
  },
  error: (message, options = {}) => {
    toastEmitter.emit({
      id: generateToastId(),
      type: 'error',
      message,
      duration: options.duration || 6000,
      dismissOnClick: options.dismissOnClick !== false,
      header: options.header,
      ...options
    });
  },
  warning: (message, options = {}) => {
    toastEmitter.emit({
      id: generateToastId(),
      type: 'warning',
      message,
      duration: options.duration || 5000,
      dismissOnClick: options.dismissOnClick !== false,
      header: options.header,
      ...options
    });
  },
  info: (message, options = {}) => {
    toastEmitter.emit({
      id: generateToastId(),
      type: 'info',
      message,
      duration: options.duration || 4000,
      dismissOnClick: options.dismissOnClick !== false,
      header: options.header,
      ...options
    });
  },
  default: (message, options = {}) => toast.info(message, options),
  addListener: (callback) => toastEmitter.addListener(callback)
};

module.exports = { toast };
