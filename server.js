const http = require('http');
const fs = require('fs');
const path = require('path');
const { JsonlStore } = require('./lib/store');
const checker = require('./lib/checker');
const core = require('./lib/core');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const monitorsStore = new JsonlStore(path.join(DATA_DIR, 'monitors.jsonl'));
const heartbeatsStore = new JsonlStore(path.join(DATA_DIR, 'heartbeats.jsonl'));
const eventsStore = new JsonlStore(path.join(DATA_DIR, 'events.jsonl'));
const settingsStore = new JsonlStore(path.join(DATA_DIR, 'settings.jsonl'));

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 2 * 1024 * 1024) throw new Error('请求体过大');
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function beatsByMonitor() {
  return heartbeatsStore.items.reduce((groups, beat) => {
    groups[beat.monitorId] ||= [];
    groups[beat.monitorId].push(beat);
    return groups;
  }, {});
}

function currentSettings() {
  return core.normalizeSettings(settingsStore.items.at(-1));
}

function saveSettings(settings) {
  settingsStore.replaceAll([settings]);
  return settings;
}

function statePayload() {
  const grouped = beatsByMonitor();
  const settings = currentSettings();
  const summaries = monitorsStore.items.map((monitor) => core.summarize(
    monitor,
    grouped[monitor.id] || [],
    Date.now(),
    settings.globalIntervalSeconds
  ));
  const events = [...eventsStore.items]
    .sort((left, right) => new Date(right.time) - new Date(left.time))
    .slice(0, 50);
  const up = summaries.filter((item) => item.status === 'up').length;
  const down = summaries.filter((item) => item.status === 'down').length;
  const latencies = summaries.map((item) => item.latestResponseTime).filter(Number.isFinite);
  return {
    generatedAt: core.nowIso(),
    settings,
    totals: {
      monitors: summaries.length,
      up,
      down,
      paused: summaries.length - up - down,
      averageResponseMs: core.average(latencies)
    },
    monitors: summaries,
    events
  };
}

async function createMonitor(body) {
  const result = core.normalizeMonitor(body || {}, currentSettings().globalIntervalSeconds);
  if (!result.valid) return { statusCode: 400, payload: { errors: result.errors } };
  monitorsStore.append(result.monitor);
  await runOnce(result.monitor);
  return { statusCode: 201, payload: result.monitor };
};

async function updateMonitor(id, changes) {
  const index = monitorsStore.items.findIndex((item) => item.id === id);
  if (index < 0) return { statusCode: 404, payload: { errors: ['监控不存在'] } };
  const patch = { ...changes };
  if (patch.intervalSeconds != null) {
    patch.intervalOverrideSeconds = patch.intervalSeconds;
    delete patch.intervalSeconds;
  }
  if (patch.intervalOverrideSeconds != null) patch.useGlobalInterval = false;
  if (patch.useGlobalInterval === true || patch.useGlobalInterval === 'true') {
    delete patch.intervalSeconds;
    delete patch.intervalOverrideSeconds;
  }
  const base = { ...monitorsStore.items[index], ...patch, id };
  delete base.intervalSeconds;
  const existingOverride = core.individualIntervalOverride(monitorsStore.items[index]);
  const result = core.normalizeMonitor({
    ...base,
    intervalOverrideSeconds: patch.useGlobalInterval
      ? null
      : (patch.intervalOverrideSeconds ?? existingOverride)
  }, currentSettings().globalIntervalSeconds);
  if (!result.valid) return { statusCode: 400, payload: { errors: result.errors } };
  monitorsStore.items[index] = result.monitor;
  monitorsStore.replaceAll(monitorsStore.items);
  return { statusCode: 200, payload: result.monitor };
};

async function importHistory(body) {
  const rows = Array.isArray(body) ? body : body?.records;
  if (!Array.isArray(rows) || !rows.length) return { statusCode: 400, payload: { errors: ['需要非空 records 数组'] } };
  const monitorIndex = new Map(monitorsStore.items.map((item) => [monitorKey(item), item]));
  const seenHeartbeats = new Set(heartbeatsStore.items.map((item) => heartbeatKey(item)));
  let accepted = 0;
  let duplicates = 0;
  const rejected = [];
  for (const row of rows) {
    const normalized = core.normalizeImportRow(row);
    if (!normalized.valid) { rejected.push({ reason: normalized.reason, row }); continue; }
    const key = monitorKey(normalized.monitor);
    let monitor = monitorIndex.get(key);
    if (!monitor) {
      const created = core.normalizeMonitor(normalized.monitor, currentSettings().globalIntervalSeconds);
      if (!created.valid) {
        rejected.push({ reason: created.errors.join('；'), row });
        continue;
      }
      monitor = created.monitor;
      monitorsStore.append(monitor);
      monitorIndex.set(key, monitor);
    }
    const heartbeat = { id: core.id(), monitorId: monitor.id, ...normalized.heartbeat };
    const duplicateKey = heartbeatKey(heartbeat);
    if (seenHeartbeats.has(duplicateKey)) {
      duplicates += 1;
      continue;
    }
    const previous = [...heartbeatsStore.items]
      .filter((item) => item.monitorId === monitor.id && Date.parse(item.time) <= Date.parse(heartbeat.time))
      .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
      .at(-1);
    heartbeatsStore.append(heartbeat);
    seenHeartbeats.add(duplicateKey);
    for (const event of core.deriveHistoryEvents(previous, heartbeat, monitor)) eventsStore.append(event);
    accepted += 1;
  }
  return { statusCode: 200, payload: { accepted, duplicates, rejected: rejected.length, rejectedRows: rejected.slice(0, 20) } };
}

function monitorKey(monitor) {
  return [
    monitor.type,
    monitor.target,
    String(monitor.keyword || ''),
    String(monitor.jsonPath || ''),
    String(monitor.bodyPattern || ''),
    monitor.type === 'dns' ? String(monitor.dnsRecordType || 'A').toUpperCase() : '',
    String(monitor.expectedValue || '')
  ].join(':');
}

function heartbeatKey(beat) {
  return `${beat.monitorId}:${beat.time}:${beat.status}`;
}

function exportHistory(response) {
  response.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': 'attachment; filename="uptime-history-export.json"'
  });
  response.end(JSON.stringify({
    exportedAt: core.nowIso(),
    settings: currentSettings(),
    monitors: monitorsStore.items,
    heartbeats: heartbeatsStore.items,
    events: eventsStore.items
  }));
}

const runningChecks = new Map();

async function runOnce(monitor, scheduledAt = core.nowIso()) {
  if (runningChecks.has(monitor.id)) return runningChecks.get(monitor.id);
  const check = performCheck(monitor, scheduledAt);
  runningChecks.set(monitor.id, check);
  try {
    return await check;
  } finally {
    runningChecks.delete(monitor.id);
  }
}

async function performCheck(monitor, scheduledAt) {
  const current = monitorsStore.items.find((item) => item.id === monitor.id);
  if (current) {
    current.lastRunAt = scheduledAt;
    monitorsStore.replaceAll(monitorsStore.items);
  }
  const previous = [...heartbeatsStore.items]
    .filter((beat) => beat.monitorId === monitor.id)
    .sort((left, right) => Date.parse(left.time) - Date.parse(right.time))
    .at(-1);
  const result = await checker.runCheck(monitor);
  const beat = {
    id: core.id(),
    monitorId: monitor.id,
    time: core.nowIso(),
    status: result.status,
    responseTime: result.responseTime,
    message: result.message
  };
  const stillExists = monitorsStore.items.some((item) => item.id === monitor.id);
  if (stillExists) {
    heartbeatsStore.append(beat);
    for (const event of core.deriveEvents(previous, beat, monitor)) eventsStore.append(event);
  }
  return beat;
}

async function tick() {
  const currentTime = Date.now();
  const settings = currentSettings();
  for (const monitor of [...monitorsStore.items]) {
    if (!monitor.active || runningChecks.has(monitor.id)) continue;
    const lastRun = monitor.lastRunAt ? Date.parse(monitor.lastRunAt) : 0;
    const intervalSeconds = core.effectiveInterval(monitor, settings);
    if (currentTime - lastRun < intervalSeconds * 1000) continue;
    const scheduledAt = new Date(currentTime).toISOString();
    runOnce(monitor, scheduledAt)
      .catch((error) => console.error(`检查失败 ${monitor.name}:`, error.message));
  }
}

function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname === '/status' ? 'status.html' : pathname.replace(/^\/+/, '');
  const target = path.normalize(path.join(__dirname, 'public', relative));
  const publicRoot = path.join(__dirname, 'public');
  if (!target.startsWith(publicRoot + path.sep)) {
    response.writeHead(403); response.end(); return;
  }
  fs.readFile(target, (error, content) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    response.writeHead(200, {
      'content-type': types[path.extname(target)] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    response.end(content);
  });
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); response.end(); return; }
      serveStatic(response, url.pathname);
      return;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const method = request.method.toUpperCase();
    const body = ['POST', 'PATCH', 'PUT'].includes(method) ? await readJson(request) : {};

    if (url.pathname === '/api/state' && method === 'GET') return sendJson(response, 200, statePayload());
    if (url.pathname === '/api/meta' && method === 'GET') {
      return sendJson(response, 200, {
        monitorTypeCount: core.MONITOR_TYPES.length,
        monitorTypeGroups: core.MONITOR_TYPE_GROUPS.map((group) => ({
          label: group.label,
          options: group.options.map(([value, label]) => ({ value, label }))
        }))
      });
    }
    if (url.pathname === '/api/settings' && method === 'GET') return sendJson(response, 200, currentSettings());
    if (url.pathname === '/api/settings' && method === 'PATCH') {
      const normalized = core.normalizeSettings(body);
      saveSettings(normalized);
      return sendJson(response, 200, normalized);
    }
    if (url.pathname === '/api/export' && method === 'GET') return exportHistory(response);
    if (url.pathname === '/api/import' && method === 'POST') {
      const result = await importHistory(body);
      return sendJson(response, result.statusCode, result.payload);
    }
    if (url.pathname === '/api/monitors' && method === 'POST') {
      const result = await createMonitor(body);
      return sendJson(response, result.statusCode, result.payload);
    }
    if (segments[0] === 'api' && segments[1] === 'monitors' && segments[2]) {
      const id = segments[2];
      if (!segments[3] && method === 'PATCH') {
        const result = await updateMonitor(id, body);
        return sendJson(response, result.statusCode, result.payload);
      }
      if (!segments[3] && method === 'DELETE') {
        const before = monitorsStore.items.length;
        monitorsStore.replaceAll(monitorsStore.items.filter((item) => item.id !== id));
        heartbeatsStore.replaceAll(heartbeatsStore.items.filter((item) => item.monitorId !== id));
        eventsStore.replaceAll(eventsStore.items.filter((item) => item.monitorId !== id));
        if (monitorsStore.items.length === before) return sendJson(response, 404, { errors: ['监控不存在'] });
        response.writeHead(204); response.end(); return;
      }
      if (segments[3] === 'check' && method === 'POST') {
        const monitor = monitorsStore.items.find((item) => item.id === id);
        if (!monitor) return sendJson(response, 404, { errors: ['监控不存在'] });
        return sendJson(response, 200, await runOnce(monitor));
      }
    }
    sendJson(response, 404, { errors: ['接口不存在'] });
  } catch (error) {
    console.error(error);
    sendJson(response, error instanceof SyntaxError ? 400 : 500, { errors: [error.message] });
  }
}

let scheduler;

function startScheduler() {
  if (process.env.DISABLE_SCHEDULER === '1' || scheduler) return;
  scheduler = setInterval(tick, 1000);
}

function stopScheduler() {
  clearInterval(scheduler);
  scheduler = null;
}

startScheduler();

if (require.main === module) {
  createServer().listen(PORT, () => {
    console.log(`History Uptime Console: http://localhost:${PORT}`);
  });
}

process.on('SIGINT', () => {
  if (scheduler) clearInterval(scheduler);
  process.exit(0);
});

function createServer() {
  return http.createServer(route);
}

module.exports = {
  createServer,
  route,
  startScheduler,
  stopScheduler,
  tick,
  runOnce,
  statePayload,
  stores: { monitorsStore, heartbeatsStore, eventsStore }
};

