const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after } = require('node:test');
const checker = require('../lib/checker');

process.env.DISABLE_SCHEDULER = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'history-uptime-test-'));
const server = require('../server');

function listen(app) {
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${app.address().port}`));
  });
}

async function postJson(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

test('monitor lifecycle, history import, and export work end to end', async () => {
  const upstream = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('stable response');
  });
  const app = http.createServer(server.route);
  let upstreamBase;
  let appBase;
  try {
    upstreamBase = await listen(upstream);
    appBase = await listen(app);

    const meta = await (await fetch(`${appBase}/api/meta`)).json();
    assert.equal(meta.monitorTypeCount, 100);
    assert.equal(meta.monitorTypeGroups.flatMap((group) => group.options).length, 100);

    const tcp = await checker.runCheck({
      type: 'tcp',
      target: `127.0.0.1:${upstream.address().port}`,
      requestTimeoutMs: 1000
    });
    assert.equal(tcp.status, 1);

    const keyword = await checker.runCheck({
      type: 'keyword',
      target: `${upstreamBase}/`,
      keyword: 'STABLE',
      expectedStatus: 200,
      requestTimeoutMs: 1000
    });
    assert.equal(keyword.status, 1);

    let response = await postJson(`${appBase}/api/monitors`, { name: '', type: 'http', target: 'nope' });
    assert.equal(response.status, 400);

    response = await postJson(`${appBase}/api/monitors`, {
      name: 'Local service',
      type: 'http',
      target: upstreamBase,
      intervalSeconds: 10,
      requestTimeoutMs: 1000
    });
    assert.equal(response.status, 201);
    const created = await response.json();
    assert.ok(created.id);

    let state = await (await fetch(`${appBase}/api/state`)).json();
    assert.equal(state.totals.up, 1);
    assert.equal(state.monitors[0].day24h.samples, 1);
    assert.ok(state.monitors[0].lastCheckedAt);

    const records = [
      { name: 'Local service', type: 'http', target: upstreamBase, time: '2026-08-26T09:00:00Z', status: 'down', responseTime: 900, message: 'HTTP 503' },
      { name: 'Local service', type: 'http', target: upstreamBase, time: '2026-08-26T09:05:00Z', status: 'up', responseTime: 80 }
    ];
    const imported = await postJson(`${appBase}/api/import`, { records });
    assert.equal(imported.status, 200);
    const importResult = await imported.json();
    assert.equal(importResult.accepted, 2);
    assert.equal(importResult.duplicates, 0);

    const repeated = await postJson(`${appBase}/api/import`, { records });
    assert.equal((await repeated.json()).duplicates, 2);

    state = await (await fetch(`${appBase}/api/state`)).json();
    assert.equal(state.events.length, 2);
    assert.deepEqual(state.events.map((event) => event.kind), ['recovered', 'incident']);

    const statusPage = await fetch(`${appBase}/status`);
    assert.equal(statusPage.status, 200);
    assert.match(await statusPage.text(), /id="services"/);
    const statusScript = await fetch(`${appBase}/status.js`);
    assert.equal(statusScript.status, 200);

    const exported = await (await fetch(`${appBase}/api/export`)).json();
    assert.equal(exported.monitors.length, 1);
    assert.equal(exported.heartbeats.length, 3);
    assert.equal(exported.events.length, 2);

    const removed = await fetch(`${appBase}/api/monitors/${created.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 204);
    const finalExport = await (await fetch(`${appBase}/api/export`)).json();
    assert.equal(finalExport.monitors.length, 0);
    assert.equal(finalExport.heartbeats.length, 0);
    assert.equal(finalExport.events.length, 0);
  } finally {
    await Promise.all([
      new Promise((resolve) => app.close(resolve)),
      new Promise((resolve) => upstream.close(resolve))
    ]);
    server.stores.monitorsStore.replaceAll([]);
    server.stores.heartbeatsStore.replaceAll([]);
    server.stores.eventsStore.replaceAll([]);
  }
});

test('global interval management coexists with individual overrides', async () => {
  const app = http.createServer(server.route);
  const appBase = await listen(app);
  try {
    let response = await fetch(`${appBase}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ globalIntervalSeconds: 1 })
    });
    assert.equal(response.status, 200);

    response = await postJson(`${appBase}/api/monitors`, {
      name: 'Follows global',
      type: 'http',
      target: 'http://example.invalid/',
      requestTimeoutMs: 500,
      useGlobalInterval: true
    });
    assert.equal(response.status, 201);
    const follower = await response.json();
    assert.equal(follower.intervalOverrideSeconds, null);
    assert.equal(follower.intervalSeconds, 1);

    response = await postJson(`${appBase}/api/monitors`, {
      name: 'Individual cadence',
      type: 'http',
      target: 'http://example.invalid/',
      requestTimeoutMs: 500,
      intervalSeconds: 7
    });
    const individual = await response.json();
    assert.equal(individual.intervalOverrideSeconds, 7);
    assert.equal(individual.intervalSeconds, 7);

    await fetch(`${appBase}/api/settings`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ globalIntervalSeconds: 9 })
    });
    await fetch(`${appBase}/api/monitors/${individual.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ active: false })
    });
    let state = await (await fetch(`${appBase}/api/state`)).json();
    assert.equal(state.settings.globalIntervalSeconds, 9);
    assert.deepEqual(state.monitors.map((item) => item.intervalSeconds), [9, 7]);

    response = await fetch(`${appBase}/api/monitors/${individual.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intervalSeconds: 3 })
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).intervalOverrideSeconds, 3);
    state = await (await fetch(`${appBase}/api/state`)).json();
    assert.deepEqual(state.monitors.map((item) => item.intervalSeconds), [9, 3]);

    await fetch(`${appBase}/api/monitors/${individual.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ useGlobalInterval: true })
    });
    state = await (await fetch(`${appBase}/api/state`)).json();
    assert.equal(state.monitors[1].intervalOverrideSeconds, null);
    assert.equal(state.monitors[1].followsGlobalInterval, true);
    assert.equal(state.monitors[1].intervalSeconds, 9);

    await fetch(`${appBase}/api/monitors/${follower.id}`, { method: 'DELETE' });
    await fetch(`${appBase}/api/monitors/${individual.id}`, { method: 'DELETE' });
  } finally {
    await new Promise((resolve) => app.close(resolve));
  }
});

after(() => {
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});
