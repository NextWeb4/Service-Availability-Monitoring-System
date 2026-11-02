const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

test('real scheduler follows the global cadence and keeps individual overrides', { timeout: 20000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uptime-scheduler-test-'));
  const starts = { global: [], individual: [] };
  const upstream = http.createServer((request, response) => {
    starts[request.url.slice(1)].push(Date.now());
    setTimeout(() => response.end('OK'), 650);
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const child = spawn(process.execPath, ['-e', [
    "const app = require('./server').createServer();",
    "app.listen(0, '127.0.0.1', () => process.send({port: app.address().port}));"
  ].join('\n')], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, DATA_DIR: dataDir, DISABLE_SCHEDULER: '0' },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const call = async (base, route, body, method = 'POST') => {
    const response = await fetch(base + route, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000)
    });
    assert.ok(response.ok, `${route}: ${response.status}`);
    return response.json();
  };
  try {
    const ready = await Promise.race([
      once(child, 'message'),
      once(child, 'exit').then(([code]) => { throw new Error(`Server exited ${code}: ${errors}`); }),
      delay(4000).then(() => { throw new Error('Scheduler server did not start'); })
    ]);
    const base = `http://127.0.0.1:${ready[0].port}`;
    await call(base, '/api/settings', { globalIntervalSeconds: 1 }, 'PATCH');
    await Promise.all([
      call(base, '/api/monitors', { name: 'Global', type: 'http', target: upstreamUrl + '/global', useGlobalInterval: true, requestTimeoutMs: 2000 }),
      call(base, '/api/monitors', { name: 'Individual', type: 'http', target: upstreamUrl + '/individual', intervalSeconds: 3, requestTimeoutMs: 2000 })
    ]);
    await delay(5000);
    const fastStarts = starts.global.slice();
    const gaps = fastStarts.slice(2).map((time, index) => time - fastStarts[index + 1]);
    assert.ok(gaps.length >= 2, JSON.stringify(fastStarts));
    assert.ok(gaps.every((gap) => gap >= 850 && gap < 1500), JSON.stringify(gaps));
    assert.ok(starts.individual.length < starts.global.length);
    assert.ok(starts.individual.slice(1).every((time, index) => time - starts.individual[index] >= 2800));
    await call(base, '/api/settings', { globalIntervalSeconds: 5 }, 'PATCH');
    const before = starts.global.length;
    await delay(1800);
    assert.equal(starts.global.length, before, 'global follower must slow down immediately');
    const state = await (await fetch(base + '/api/state')).json();
    assert.deepEqual(state.monitors.map((monitor) => monitor.intervalSeconds), [5, 3]);
    t.diagnostic(JSON.stringify({ globalStartGapsMs: gaps, globalChecks: before, individualChecks: starts.individual.length, intervalsAfterChange: [5, 3] }));
  } finally {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    await new Promise((resolve) => upstream.close(resolve));
    assert.ok(dataDir.startsWith(path.join(os.tmpdir(), 'uptime-scheduler-test-')));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
