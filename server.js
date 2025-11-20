const http = require('http');
const WebSocket = require('ws');
const chalk = require('chalk');
const constructXML = require('./src/junitFormatter');
const { writeFileSync } = require('fs');
const takeScreenshot = require('./src/screenshot');

// Initialize a server
const server = http.createServer();

// Setup local variables for server
server.locals = {
  platform: undefined,
  appBooted: false,
  testCount: 0,
  keepAliveTimeout: 60_000,
  screenshots: true
};

// Initialize a WebSocket Server instance
const wss = new WebSocket.Server({server});

const DEFAULT_KEEP_ALIVE_TIMEOUT = 60_000;
let lastNotify = Date.now();
let timeout;

// When the web socket server receives a connection request, we configure
// the desired behaviour for the socket.
wss.on('connection', socket => {
  // If we receive a 'message' from the Cavy-side socket, we parse the payload
  // and direct the processing behaviour based on the json.event
  socket.on('message', message => {
    const json = JSON.parse(message);

    switch(json.event) {
      case 'notify':
        onNotify(true);
        break;
      case 'message':
        logMessage(json.data);
        break;
      case 'singleResult':
        logTestResult(json.data);
        break;
      case 'testingComplete':
        finishTesting(json.data);
        break;
    }
  });

  // Now we have made a connection with Cavy, we know the app has booted.
  server.locals.appBooted = true;
  onNotify();
})

// Internal: Takes a count and string, returns formatted and pluralized string.
// e.g. countString(5, 'failure') => '5 failures'
//      countString(1, 'failure') => '1 failure'
//      countString(0, 'failure') => '0 failures'
function countString(count, str) {
  let string = (count == 1) ? str : str + 's';
  return `${count} ${string}`;
}

// Internal: Accepts a test result json object and console.logs the result.
function logTestResult(testResultJson) {
  const { message, passed } = testResultJson;

  server.locals.testCount++ ;
  formattedMessage = `${server.locals.testCount}) ${message}`;

  if (server.locals.screenshots) {
    takeScreenshot(server.locals.platform);
  }

  if (passed) {
    // Log green test result if test passed
    console.log(chalk.green(formattedMessage));
  } else {
    // Log red test result if test failed
    console.log(chalk.red(formattedMessage));
  }
}

function logMessage(json) {
  const { message, level } = json;
  switch (level) {
    case 'log': console.log(chalk.white(message)); break;
    case 'debug': console.log(chalk.yellow(message)); break;
    case 'warn': console.log(chalk.bgYellow(message)); break;
	  case 'error': console.log(chalk.red(message)); break;
  }
}

function onNotify(screenshot = false) {
  console.log(chalk.white(`[${new Date().toLocaleTimeString()}] Received notification.`));
  lastNotify = Date.now();
  clearTimeout(timeout);
  if (screenshot && server.locals.screenshots) {
    takeScreenshot(server.locals.platform);
  }
  timeout = setTimeout(() => {
    console.log(chalk.red("Did not receive a keep-alive notification in time - app may have crashed."));
    if (server.locals.screenshots) {
      takeScreenshot(server.locals.platform);
    }
    process.exit(1);
  }, server.locals.keepAliveTimeout || DEFAULT_KEEP_ALIVE_TIMEOUT);
}

// Internal: Accepts a json report object, console.logs the overall result of
// the test suite and quits the process with either exit code 1 or 0 depending
// on whether any tests failed.
function finishTesting(reportJson) {
  const { results, fullResults, errorCount, duration } = reportJson;

  // Set the testCount to zero at the end of the test suite. This ensures
  // the test numbering is reset in the case where `--dev` option is
  // supplied and we don't restart the server.
  server.locals.testCount = 0;

  console.log(`Finished in ${duration} seconds`);
  const endMsg = `${countString(results.length, 'example')}, ${countString(errorCount, 'failure')}`;

  // If requested, construct XML report.
  if (server.locals.outputAsXml) {
    constructXML(fullResults);
  }
  constructMarkdown(fullResults);

  // If all tests pass, exit with code 0, else code 42.
  // Code 42 chosen at random so that a test failure can be distinuguished from
  // a build failure (in which case the React Native CLI would exit with code 1).
  if (!errorCount) {
    console.log(chalk.green(endMsg));
    if (!server.locals.dev) {
      process.exit(0);
    }
  } else {
    console.log(chalk.red(endMsg));
    if (!server.locals.dev) {
      process.exit(42);
    }
  }
  console.log('--------------------');
}

function constructMarkdown(results) {
  const filename = 'cavy_results.md';
  console.log(`Writing results to ${filename}`);
  const data =
    `### E2E Test Summary\n` +
    `|Description 📝|Test results 🧪|Duration ⏰|\n` +
    `|---|---|---|\n` +
    results.testCases.map((result) => `|${result.description}|${result.passed ? `✅` : `❌`}|${result.time}s|`).join('\n');

  writeFileSync(filename, data);
}

module.exports = server;
