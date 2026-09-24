const { installStdioErrorHandlers } = require('../stdio-errors');

installStdioErrorHandlers();
const stream = process[process.argv[2]];
const log = process.argv[2] === 'stderr' ? console.error : console.log;
const timeout = setTimeout(() => process.exit(2), 5000);

stream.once('error', (error) => {
  process.send(error.code);
  setImmediate(() => {
    log('Logging again after the pipe has closed');
    process.send('still-running', () => {
      clearTimeout(timeout);
      process.disconnect();
    });
  });
});

process.on('message', () => log('Writing to the closed pipe'));
process.send('ready');
