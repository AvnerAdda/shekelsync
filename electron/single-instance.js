function enforceSingleInstance({ app, onSecondInstance }) {
  const hasLock = app.requestSingleInstanceLock();

  if (!hasLock) {
    app.quit();
    return false;
  }

  app.on('second-instance', (...args) => {
    onSecondInstance(...args);
  });

  return true;
}

module.exports = { enforceSingleInstance };
