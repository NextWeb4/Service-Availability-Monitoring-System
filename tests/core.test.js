const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../lib/core');
const checker = require('../lib/checker');

test('all 100 catalog types have a concrete probe path', () => {
  const genericHttpTypes = new Set(['http', 'keyword', 'http_json', 'regex']);
  const catalogTypes = core.MONITOR_TYPE_GROUPS.flatMap((group) => group.options.map(([value]) => value));
  assert.equal(core.MONITOR_TYPES.length, 100);
  assert.equal(new Set(catalogTypes).size, 100);
  assert.deepEqual(catalogTypes, core.MONITOR_TYPES);
  assert.deepEqual([...core.HEALTH_HTTP_TYPES].sort(), Object.keys(checker.HEALTH_ENDPOINTS).sort());
  assert.deepEqual(core.MONITOR_TYPES.filter((type) => (
    !genericHttpTypes.has(type)
    && !checker.HEALTH_ENDPOINTS[type]
    && !checker.PROTOCOL_CHECKERS[type]
  )), []);
});
test('summarize calculates availability, latency, and recent bars', () => {
  const currentTime = Date.parse('2026-08-26T12:00:00.000Z');
  const monitor = { id: 'm1', name: 'API', type: 'http', target: 'https://api.test', active: true };
  const heartbeats = [
    { time: '2026-08-26T10:00:00.000Z', status: 1, responseTime: 100 },
    { time: '2026-08-26T11:00:00.000Z', status: 0, responseTime: 300 },
    { time: '2026-08-26T08:00:00.000Z', status: 1, responseTime: 500 }
  ];
  const summary = core.summarize(monitor, heartbeats, currentTime);
  assert.equal(summary.status, 'down');
  assert.equal(summary.day24h.samples, 3);
  assert.equal(summary.day24h.uptimeRatio, 2 / 3);
  assert.equal(summary.day24h.p95ResponseMs, 500);
  assert.equal(summary.day7d.uptimeRatio, 2 / 3);
  assert.equal(summary.bars.length, 3);
});
test('monitor normalization supports one-second probes and extended types', () => {
  const fast = core.normalizeMonitor({
    name: 'Fast gateway',
    type: 'ping',
    target: '127.0.0.1',
    intervalSeconds: '1',
    requestTimeoutMs: '500'
  });
  assert.equal(fast.valid, true);
  assert.equal(fast.monitor.intervalSeconds, 1);
  assert.equal(fast.monitor.requestTimeoutMs, 500);

  const json = core.normalizeMonitor({ name: 'JSON', type: 'http_json', target: 'http://localhost', jsonPath: 'status', expectedValue: 'ok' });
  assert.equal(json.monitor.expectedValue, 'ok');

  const dns = core.normalizeMonitor({
    name: 'DNS',
    type: 'dns',
    target: 'example.com',
    dnsRecordType: 'mx',
    expectedValue: 'mail.example.com'
  });
  assert.equal(dns.valid, true);
  assert.equal(dns.monitor.dnsRecordType, 'MX');

  const ssl = core.normalizeMonitor({
    name: 'Certificate',
    type: 'ssl',
    target: 'example.com',
    sslWarnDays: 14
  });
  assert.equal(ssl.valid, true);
  assert.equal(ssl.monitor.sslWarnDays, 14);

  const invalid = core.normalizeMonitor({ name: 'Bad', type: 'icmp', target: 'example.com', intervalSeconds: 0 });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join('；'), /类型必须是/);
});

test('legacy per-monitor intervals remain individual overrides', () => {
  const legacy = { id: 'old', name: 'Legacy', type: 'tcp', target: 'localhost:80', intervalSeconds: 7, active: true };
  assert.equal(core.individualIntervalOverride(legacy), 7);
  assert.equal(core.effectiveInterval(legacy, { globalIntervalSeconds: 1 }), 7);
  assert.equal(core.summarize(legacy, [], Date.now(), 1).followsGlobalInterval, false);

  const follower = { ...legacy, intervalOverrideSeconds: null };
  assert.equal(core.effectiveInterval(follower, { globalIntervalSeconds: 1 }), 1);
  assert.equal(core.summarize(follower, [], Date.now(), 1).followsGlobalInterval, true);
});
test('history rows require a usable target and timestamp', () => {
  const invalid = core.normalizeImportRow({ name: 'Bad', time: 'not-a-date' });
  assert.equal(invalid.valid, false);
  assert.match(invalid.reason, /时间无效/);
  assert.match(invalid.reason, /缺少 target/);
  const valid = core.normalizeImportRow({
    name: 'Site',
    target: 'https://site.test',
    time: '2026-08-26T09:30:00Z',
    status: 'down',
    duration: 120,
    error: 'timeout'
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.heartbeat.status, 0);
  assert.equal(valid.heartbeat.responseTime, 120);
  assert.equal(valid.heartbeat.time, '2026-08-26T09:30:00.000Z');
  assert.equal(core.normalizeImportRow({ name: 'HTTP', target: 'https://site.test', time: valid.heartbeat.time, status: 503 }).heartbeat.status, 0);
  assert.equal(core.normalizeImportRow({ name: 'HTTP', target: 'https://site.test', time: valid.heartbeat.time, status: 204 }).heartbeat.status, 1);
});
test('historical event reconstruction includes an initial incident and recovery', () => {
  const monitor = { id: 'm1', name: 'Site', type: 'http', target: 'https://site.test' };
  const down = { time: '2026-08-26T10:00:00.000Z', status: 0, message: 'HTTP 503' };
  const recovered = { time: '2026-08-26T10:05:00.000Z', status: 1, message: 'HTTP 200' };
  const events = [
    ...core.deriveHistoryEvents(null, down, monitor),
    ...core.deriveHistoryEvents(down, recovered, monitor)
  ];
  assert.deepEqual(events.map((event) => event.kind), ['incident', 'recovered']);
});

