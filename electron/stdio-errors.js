// A development launcher can close its output pipes while Electron is still
// running. Handle that error on the stream itself so logging does not enter
// the uncaught-exception handler and repeatedly try to write to the same pipe.
function installStdioErrorHandlers(streams = [process.stdout, process.stderr]) {
  for (const stream of new Set(streams)) {
    stream.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        throw error;
      }
    });
  }
}

module.exports = { installStdioErrorHandlers };
