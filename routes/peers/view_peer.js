'use strict';

module.exports = async function (req, res, next) {
  const data = { status: 'error', message: 'Not yet implemented.' };
  res.format({
    'application/json': () => {
      return res.json(data);
    },
    'text/html': () => {
      return res.send(this.applicationString);
    }
  });
};
