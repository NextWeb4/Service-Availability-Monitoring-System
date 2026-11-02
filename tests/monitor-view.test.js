const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const MonitorView = require('../public/monitor-view');

function makeMonitors(count) {
  return Array.from({ length: count }, (_, index) => ({
    monitorId: `m${index + 1}`,
    name: `Service ${count - index}`,
    target: `https://host${index + 1}.example.test`,
    type: ['http', 'tcp', 'dns'][index % 3],
    status: ['down', 'unknown', 'up', 'paused'][index % 4],
    latestResponseTime: index % 7 === 0 ? null : index
  }));
}

function ids(result) {
  return result.items.map((item) => item.monitorId ?? item.id);
}

test('exports a shared selector through CommonJS and a browser script without a DOM', () => {
  assert.equal(typeof MonitorView.select, 'function');
  const source = readFileSync(require.resolve('../public/monitor-view'), 'utf8');
  const browser = { window: {} };
  vm.runInNewContext(source, browser);
  assert.equal(typeof browser.window.MonitorView.select, 'function');
  const result = browser.window.MonitorView.select(makeMonitors(12), { page: 2 });
  assert.equal(result.total, 12);
  assert.equal(result.page, 2);
  assert.equal(result.items.length, 2);

  const hybrid = { window: {}, module: { exports: {} } };
  vm.runInNewContext(source, hybrid);
  assert.equal(hybrid.window.MonitorView, hybrid.module.exports);
});

test('defaults retain source order and return the complete pagination contract', () => {
  const monitors = makeMonitors(14);
  assert.deepEqual(MonitorView.select(monitors), {
    items: monitors.slice(0, 10), total: 14, page: 1, pageCount: 2, pageSize: 10, from: 1, to: 10
  });
});

test('hundreds of monitors have bounded pages with no gaps or duplicates at every supported size', () => {
  const monitors = makeMonitors(637);
  for (const pageSize of [10, 25, 50]) {
    const pageCount = Math.ceil(monitors.length / pageSize);
    const collected = [];
    for (let page = 1; page <= pageCount; page += 1) {
      const result = MonitorView.select(monitors, { page, pageSize });
      assert.equal(result.page, page);
      assert.equal(result.pageCount, pageCount);
      assert.equal(result.pageSize, pageSize);
      assert.equal(result.total, monitors.length);
      assert.equal(result.from, (page - 1) * pageSize + 1);
      assert.equal(result.to, Math.min(page * pageSize, monitors.length));
      assert.equal(result.items.length, result.to - result.from + 1);
      assert.ok(result.items.length <= pageSize);
      collected.push(...result.items);
    }
    assert.deepEqual(collected, monitors);
    assert.equal(new Set(collected).size, monitors.length);
  }
});

const searchMonitors = [
  { id: 'a', name: 'Billing API 2', target: 'https://EDGE.example.test', type: 'http_json', status: 'down' },
  { id: 'b', name: 'Billing API 10', target: 'https://edge.example.test', type: 'http_json', status: 'up' },
  { id: 'c', name: 'Billing API 1', target: 'db.internal:5432', type: 'tcp', status: 'down' },
  { id: 'd', name: 'Reports', target: 'https://edge.example.test', type: 'http', status: 'unknown' },
  { id: 'e', name: 'Billing DNS', target: 'edge.example.test', type: 'dns', status: 'paused' }
];
const typeLabels = new Map([
  ['http_json', 'JSON \u63a5\u53e3'], ['http', 'Web'], ['tcp', 'Database'], ['dns', 'Domain lookup']
]);

test('search trims and matches every token across names, targets, raw types, and localized labels', () => {
  assert.deepEqual(ids(MonitorView.select(searchMonitors, { query: '  bILLing\tEDGE\nHTTP_JSON \u63a5\u53e3  ' }, typeLabels)), ['a', 'b']);
  assert.deepEqual(ids(MonitorView.select(searchMonitors, { query: 'database BILLING' }, typeLabels)), ['c']);
  assert.deepEqual(ids(MonitorView.select(searchMonitors, { query: 'DOMAIN lookup edge' }, typeLabels)), ['e']);
  assert.equal(MonitorView.select(searchMonitors, { query: 'billing edge missing' }, typeLabels).total, 0);
  assert.equal(MonitorView.select(searchMonitors, { query: ' \n\t ' }, typeLabels).total, searchMonitors.length);
  assert.equal(MonitorView.select(searchMonitors, { query: 'json' }).total, 2);
});

test('status and type filters are exact and compose with search', () => {
  for (const status of ['down', 'unknown', 'up', 'paused', 'all']) {
    for (const type of ['http_json', 'http', 'tcp', 'dns', 'all']) {
      const result = MonitorView.select(searchMonitors, { status, type, query: 'billing' }, typeLabels);
      const expected = searchMonitors.filter((item) => item.name.startsWith('Billing')
        && (status === 'all' || item.status === status) && (type === 'all' || item.type === type));
      assert.deepEqual(result.items, expected);
      assert.equal(result.total, expected.length);
    }
  }
  for (const options of [{ status: 'DOWN' }, { type: 'HTTP' }, { type: 'htt' }, { status: 'dow' }]) {
    assert.equal(MonitorView.select(searchMonitors, options).total, 0);
  }
});

test('filtering and sorting operate on the full result before selecting a page', () => {
  const monitors = makeMonitors(180);
  const result = MonitorView.select(monitors, { type: 'http', status: 'down', sort: 'latency', page: 2 });
  assert.deepEqual(ids(result), ['m25', 'm13', 'm169', 'm85', 'm1']);
  assert.equal(result.total, 15);
  assert.equal(result.pageCount, 2);
  assert.equal(result.from, 11);
  assert.equal(result.to, 15);
});

test('page sizes accept numeric form values and otherwise fall back to ten', () => {
  const monitors = makeMonitors(67);
  for (const pageSize of [10, 25, 50, '10', '25', '50']) {
    const result = MonitorView.select(monitors, { pageSize });
    assert.equal(result.pageSize, Number(pageSize));
    assert.equal(result.items.length, Number(pageSize));
  }
  for (const pageSize of [undefined, null, '', 0, -10, 11, 25.5, 100, NaN, Infinity, 'bad']) {
    const result = MonitorView.select(monitors, { pageSize });
    assert.equal(result.pageSize, 10);
    assert.equal(result.items.length, 10);
  }
});

test('pages normalize invalid input and clamp to available bounds', () => {
  const monitors = makeMonitors(53);
  for (const page of [undefined, null, '', 0, -3, NaN, Infinity, -Infinity, 'bad']) {
    const result = MonitorView.select(monitors, { page, pageSize: 25 });
    assert.equal(result.page, 1);
    assert.equal(result.from, 1);
  }
  assert.equal(MonitorView.select(monitors, { page: '2', pageSize: '25' }).from, 26);
  assert.equal(MonitorView.select(monitors, { page: 2.9, pageSize: 25 }).page, 2);
  assert.deepEqual(MonitorView.select(monitors, { page: 999, pageSize: 25 }), {
    items: monitors.slice(50), total: 53, page: 3, pageCount: 3, pageSize: 25, from: 51, to: 53
  });
});

test('deletion and narrower filters clamp a now-missing page to the last available page', () => {
  const monitors = makeMonitors(21);
  assert.equal(MonitorView.select(monitors, { page: 3 }).page, 3);
  const afterDeletion = MonitorView.select(monitors.slice(0, 20), { page: 3 });
  assert.equal(afterDeletion.page, 2);
  assert.equal(afterDeletion.from, 11);
  assert.equal(afterDeletion.to, 20);
  const filtered = MonitorView.select(monitors, { page: 3, status: 'paused' });
  assert.equal(filtered.page, 1);
  assert.equal(filtered.total, 5);
  assert.equal(filtered.to, 5);
});

test('empty input and no matches expose a usable first page and a zero range', () => {
  for (const monitors of [[], searchMonitors]) {
    assert.deepEqual(MonitorView.select(monitors, { query: 'no-such-service', page: 999, pageSize: 50 }), {
      items: [], total: 0, page: 1, pageCount: 1, pageSize: 50, from: 0, to: 0
    });
  }
});

test('default and unrecognized sorts preserve source order through status and latency updates', () => {
  const monitors = makeMonitors(14);
  const updated = monitors.map((item, index) => ({ ...item, status: index % 2 ? 'down' : 'up', latestResponseTime: 1000 - index }));
  for (const sort of ['default', undefined, 'unsupported', 'constructor', '__proto__']) {
    assert.deepEqual(ids(MonitorView.select(monitors, { sort })), ids(MonitorView.select(updated, { sort })));
    assert.deepEqual(MonitorView.select(monitors, { sort }).items, monitors.slice(0, 10));
  }
});

test('name sorting is numeric zh-CN order with stable equal-name rows', () => {
  const monitors = [
    { id: 'z', name: '\u670d\u52a110' },
    { id: 'b', name: '\u670d\u52a12' },
    { id: 'a', name: '\u670d\u52a12' },
    { id: 'n', name: '\u963f\u91cc' },
    { id: 'm', name: '\u767e\u5ea6' }
  ];
  assert.deepEqual(ids(MonitorView.select(monitors, { sort: 'name' })), ['n', 'm', 'b', 'a', 'z']);
});

test('status sorting prioritizes down, unknown, up, paused with deterministic names and both identity fields', () => {
  const monitors = [
    { monitorId: 'p', name: 'Service 1', status: 'paused' },
    { monitorId: 'u', name: 'Service 1', status: 'up' },
    { monitorId: 'q', name: 'Service 1', status: 'unknown' },
    { monitorId: 'm10', name: 'Service 2', status: 'down' },
    { id: 'm2', name: 'Service 2', status: 'down' },
    { id: 'm0', name: 'Service 1', status: 'down' },
    { id: 'm11', name: 'Service 10', status: 'down' }
  ];
  const expected = ['m0', 'm2', 'm10', 'm11', 'q', 'u', 'p'];
  assert.deepEqual(ids(MonitorView.select(monitors, { sort: 'status' })), expected);
  assert.deepEqual(ids(MonitorView.select([...monitors].reverse(), { sort: 'status' })), expected);
});

test('latency sorts finite values descending, including zero, and keeps every non-finite value last', () => {
  const values = [null, 0, undefined, 100, NaN, 100, Infinity, -Infinity, '999', -5];
  const monitors = values.map((latestResponseTime, index) => ({
    id: `m${index}`, name: `Service ${index}`, latestResponseTime
  }));
  assert.deepEqual(ids(MonitorView.select(monitors, { sort: 'latency' })), [
    'm3', 'm5', 'm1', 'm9', 'm0', 'm2', 'm4', 'm6', 'm7', 'm8'
  ]);
  assert.deepEqual(ids(MonitorView.select([...monitors].reverse(), { sort: 'latency' })), [
    'm3', 'm5', 'm1', 'm9', 'm0', 'm2', 'm4', 'm6', 'm7', 'm8'
  ]);
});

test('status and latency ties use identity deterministically and preserve indistinguishable rows', () => {
  const monitors = [
    { monitorId: 'm10', name: 'Same', status: 'up', latestResponseTime: 4 },
    { id: 'm2', name: 'Same', status: 'up', latestResponseTime: 4 },
    { id: 'm02', name: 'Same', status: 'up', latestResponseTime: 4 }
  ];
  for (const sort of ['status', 'latency']) {
    const expected = ['m02', 'm2', 'm10'];
    assert.deepEqual(ids(MonitorView.select(monitors, { sort })), expected);
    assert.deepEqual(ids(MonitorView.select([...monitors].reverse(), { sort })), expected);
    const twins = [{ name: 'Same', status: 'up' }, { name: 'Same', status: 'up' }];
    const result = MonitorView.select(twins, { sort });
    assert.equal(result.items[0], twins[0]);
    assert.equal(result.items[1], twins[1]);
  }
});

test('selection does not mutate source arrays, monitor objects, options, or type labels', () => {
  const monitors = Object.freeze(makeMonitors(81).map(Object.freeze));
  const snapshot = JSON.stringify(monitors);
  const labels = new Map(typeLabels);
  for (const sort of ['default', 'name', 'status', 'latency']) {
    const options = Object.freeze({ query: 'EXAMPLE', status: 'up', type: 'tcp', sort, page: 99, pageSize: 25 });
    const result = MonitorView.select(monitors, options, labels);
    assert.ok(result.items.every((item) => monitors.includes(item)));
    result.items.reverse();
    result.items.pop();
    assert.equal(JSON.stringify(monitors), snapshot);
    assert.deepEqual([...labels], [...typeLabels]);
    assert.equal(options.page, 99);
  }
});
