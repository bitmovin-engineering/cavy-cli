const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const test = require('node:test');
const vm = require('node:vm');
const WebSocket = require('ws');

const cli = path.resolve(__dirname, '../cavy.js');

function start(t, args, entries = false) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cavy-boot-test-'));
  if (entries) {
    fs.writeFileSync(path.join(directory, 'index.js'), 'original entry');
    fs.writeFileSync(path.join(directory, 'index.test.js'), 'test entry');
  }
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const closed = once(child, 'close').then(([code, signal]) => ({
    code, signal, output,
  }));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
    await closed;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { child, closed, directory, output: () => output };
}

async function listening(run) {
  const until = Date.now() + 3000;
  while (!run.output().includes('Listening on port 8082')) {
    assert.equal(run.child.exitCode, null, run.output());
    assert.ok(Date.now() < until, run.output() || 'reporter did not listen');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test('skipbuild exits nonzero when no app connects and restores entry files',
  { timeout: 3000 }, async t => {
    const run = start(t, [
      'run-ios', '--skipbuild', '--no-screenshots', '--boot-timeout', '0.005',
    ], true);
    const result = await run.closed;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /No response from Cavy within 0.005 minutes/);
    assert.equal(fs.readFileSync(path.join(run.directory, 'index.js'), 'utf8'), 'original entry');
    assert.equal(fs.readFileSync(path.join(run.directory, 'index.test.js'), 'utf8'), 'test entry');
    assert.equal(fs.existsSync(path.join(run.directory, 'index.notest.js')), false);
  });

for (const failed of [false, true]) {
  test(`a connected app outlives the boot deadline and reports ${failed ? 'failure' : 'success'}`,
    { timeout: 5000 }, async t => {
      const run = start(t, [
        'run-ios', '--skipbuild', '--no-screenshots',
        '--boot-timeout', '0.01', '--keep-alive-timeout', '3',
      ]);
      await listening(run);
      const socket = new WebSocket('ws://127.0.0.1:8082');
      t.after(() => socket.terminate());
      await once(socket, 'open');
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(run.child.exitCode, null, run.output());
      socket.send(JSON.stringify({
        event: 'testingComplete',
        data: {
          results: [{}],
          fullResults: {
            testCases: [{ description: 'fixture assertion', passed: !failed, time: 0.1 }],
          },
          errorCount: failed ? 1 : 0,
          duration: 0.1,
        },
      }));
      const result = await run.closed;
      assert.equal(result.code, failed ? 42 : 0, result.output);
      assert.doesNotMatch(result.output, /No response from Cavy/);
    });
}

test('invalid boot timeouts fail before the reporter starts', { timeout: 5000 }, async t => {
  for (const timeout of ['0', '-1', 'nope', 'Infinity', '1oops', '36000']) {
    const run = start(t, ['run-ios', '--skipbuild', '--boot-timeout', timeout], true);
    const result = await run.closed;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /positive.*boot.*timeout/i);
    assert.doesNotMatch(result.output, /Listening on port/);
    assert.equal(fs.readFileSync(path.join(run.directory, 'index.js'), 'utf8'), 'original entry');
  }
});

test('skipbuild still schedules the two-minute default', () => {
  const delays = [];
  const fakeServer = { locals: {}, listen: (_port, ready) => ready() };
  const context = {
    module: { exports: {} },
    require: name => name === '../server' ? fakeServer
      : name === 'fs' ? { existsSync: () => false } : require(name),
    console: { log() {} },
    process: { on() {} },
    setTimeout: (_callback, delay) => delays.push(delay),
  };
  vm.runInNewContext(
    fs.readFileSync(path.resolve(__dirname, '../src/runTests.js'), 'utf8'),
    context
  );
  context.module.exports('run-ios', null, undefined, true, false, false,
    undefined, undefined, false, []);
  assert.deepEqual(delays, [120000]);
});

test('after connection the keep-alive deadline still fails an unresponsive app',
  { timeout: 4000 }, async t => {
    const run = start(t, [
      'run-ios', '--skipbuild', '--no-screenshots',
      '--boot-timeout', '0.01', '--keep-alive-timeout', '1',
    ]);
    await listening(run);
    const socket = new WebSocket('ws://127.0.0.1:8082');
    t.after(() => socket.terminate());
    await once(socket, 'open');
    const result = await run.closed;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Did not receive a keep-alive notification/);
    assert.doesNotMatch(result.output, /No response from Cavy/);
  });

test('dev mode remains alive after connecting and SIGINT restores entries',
  { timeout: 4000 }, async t => {
    const run = start(t, [
      'run-ios', '--skipbuild', '--dev', '--no-screenshots',
      '--boot-timeout', '0.01', '--keep-alive-timeout', '3',
    ], true);
    await listening(run);
    const socket = new WebSocket('ws://127.0.0.1:8082');
    t.after(() => socket.terminate());
    await once(socket, 'open');
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(run.child.exitCode, null, run.output());
    run.child.kill('SIGINT');
    const result = await run.closed;
    assert.equal(result.code, 1);
    assert.equal(fs.readFileSync(path.join(run.directory, 'index.js'), 'utf8'), 'original entry');
    assert.equal(fs.readFileSync(path.join(run.directory, 'index.test.js'), 'utf8'), 'test entry');
  });

test('the build path still enforces the boot deadline after the build exits',
  { timeout: 3000 }, async t => {
    const run = start(t, [
      'run-vega', '--buildCmd', `"${process.execPath}" -e "process.exit(0)"`,
      '--boot-timeout', '0.005', '--no-screenshots',
    ]);
    const result = await run.closed;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /react-native exited with code 0/);
    assert.match(result.output, /No response from Cavy/);
  });

test('web reporter mode also respects the boot deadline', { timeout: 3000 }, async t => {
  const run = start(t, ['run-web', '--boot-timeout', '0.005', '--no-screenshots']);
  const result = await run.closed;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /No response from Cavy/);
});
