const { parentPort, workerData } = require('worker_threads');
const forecastService = require('./forecast.js');

forecastService.generateDailyForecast(workerData?.options || { __workerThread: true })
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((error) => parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));
