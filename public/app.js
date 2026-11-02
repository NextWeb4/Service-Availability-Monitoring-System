const state = { data: null, meta: null, generation: 0, loading: false };
const typeLabels = new Map();

const form = document.querySelector('#monitor-form');
const importForm = document.querySelector('#import-form');
const monitorGrid = document.querySelector('#monitors');
const eventList = document.querySelector('#events');
const totals = document.querySelector('#totals');
const pageUpdated = document.querySelector('#page-updated');
const refreshInterval = document.querySelector('#refresh-interval');
const monitorType = document.querySelector('#monitor-type');
const targetInput = document.querySelector('#target-input');
const useGlobalInterval = document.querySelector('#use-global-interval');
const individualIntervalInput = document.querySelector('input[name="intervalSeconds"]');
const monitorDialog = document.querySelector('#monitor-dialog');
const importDialog = document.querySelector('#import-dialog');
const listViewport = document.querySelector('.monitor-viewport');
const expandedMonitors = new Set();
const view = readViewPreferences();

function readViewPreferences() {
  const defaults = { query: '', status: 'all', type: 'all', sort: 'default', page: 1, pageSize: 10, mode: 'list' };
  try {
    const saved = JSON.parse(localStorage.getItem('uptime-console-view'));
    return { ...defaults, pageSize: [10, 25, 50].includes(saved?.pageSize) ? saved.pageSize : 10, mode: saved?.mode === 'cards' ? 'cards' : 'list' };
  } catch { return defaults; }
}

function saveViewPreferences() {
  try { localStorage.setItem('uptime-console-view', JSON.stringify({ pageSize: view.pageSize, mode: view.mode })); } catch {}
}

const targetPlaceholders = {
  http: 'https://example.com',
  keyword: 'https://example.com/status',
  http_json: 'https://example.com/api/health',
  regex: 'https://example.com/release-notes',
  tcp: 'db.internal:5432',
  ping: 'example.com 或 192.168.1.1',
  dns: 'example.com',
  ssl: 'example.com 或 https://example.com:443',
  websocket: 'wss://example.com/socket',
  redis: 'cache.internal:6379',
  memcached: 'cache.internal:11211',
  mysql: 'db.internal:3306',
  postgres: 'db.internal:5432',
  mqtt: 'broker.internal:1883',
  smtp: 'mail.internal:25',
  ssh: 'server.internal:22',
  ftp: 'files.internal:21',
  imap: 'mail.internal:143',
  pop3: 'mail.internal:110',
  ntp: 'time.cloudflare.com',
  sip: 'pbx.internal:5060',
  snmp: 'switch.internal:161',
  amqp: 'rabbitmq.internal:5672',
  kafka: 'kafka.internal:9092',
  mongodb: 'mongo.internal:27017',
  mssql: 'mssql.internal:1433',
  ldap: 'ldap.internal:389',
  socks5: 'proxy.internal:1080',
  vnc: 'desktop.internal:5900',
  zookeeper: 'zookeeper.internal:2181',
  redis_tls: 'cache.internal:6379',
  smtps: 'mail.internal:465',
  imaps: 'mail.internal:993',
  pop3s: 'mail.internal:995',
  ftps: 'files.internal:990',
  ldaps: 'ldap.internal:636',
  beanstalkd: 'queue.internal:11300',
  gearman: 'jobs.internal:4730',
  nats: 'nats.internal:4222',
  cassandra: 'cassandra.internal:9042',
  xmpp: 'chat.internal:5222',
  irc: 'irc.internal:6667',
  whois: 'whois.iana.org:43',
  prometheus: 'prometheus.internal:9090',
  grafana: 'grafana.internal:3000',
  elasticsearch: 'elasticsearch.internal:9200',
  influxdb: 'influxdb.internal:8086',
  etcd: 'etcd.internal:2379',
  consul: 'consul.internal:8500',
  rabbitmq_management: 'rabbitmq.internal:15672',
  docker_registry: 'registry.internal:5000',
  minio: 'minio.internal:9000',
  clickhouse: 'clickhouse.internal:8123',
  couchdb: 'couchdb.internal:5984',
  traefik: 'traefik.internal:8080',
  nacos: 'nacos.internal:8848',
  docker_engine: 'docker.internal:2375', kubernetes: 'kubernetes.internal:6443',
  nomad: 'nomad.internal:4646', vault: 'vault.internal:8200', harbor: 'harbor.internal:80',
  portainer: 'portainer.internal:9000', jenkins: 'jenkins.internal:8080',
  gitlab: 'gitlab.internal:80', gitea: 'gitea.internal:3000', forgejo: 'forgejo.internal:3000',
  argocd: 'argocd.internal:443', drone: 'drone.internal:80', woodpecker: 'woodpecker.internal:8000',
  sonarqube: 'sonarqube.internal:9000', nexus: 'nexus.internal:8081',
  artifactory: 'artifactory.internal:8082', keycloak: 'keycloak.internal:9000',
  authentik: 'authentik.internal:9000', authelia: 'authelia.internal:9091',
  nextcloud: 'nextcloud.internal:80', jellyfin: 'jellyfin.internal:8096',
  plex: 'plex.internal:32400', immich: 'immich.internal:2283',
  home_assistant: 'home-assistant.internal:8123', node_red: 'node-red.internal:1880',
  netdata: 'netdata.internal:19999', proxmox: 'proxmox.internal:8006', envoy: 'envoy.internal:9901',
  airflow: 'airflow.internal:8080', superset: 'superset.internal:8088',
  metabase: 'metabase.internal:3000', redash: 'redash.internal:5000',
  mattermost: 'mattermost.internal:8065', matrix_synapse: 'matrix.internal:8008', ghost: 'ghost.internal:2368',
  alertmanager: 'alertmanager.internal:9093', victoriametrics: 'victoriametrics.internal:8428',
  loki: 'loki.internal:3100', prometheus_pushgateway: 'pushgateway.internal:9091',
  thanos_query: 'thanos.internal:9090', zipkin: 'zipkin.internal:9411',
  jaeger_query: 'jaeger.internal:16686', opentelemetry_collector: 'otel.internal:13133',
  ceph_rgw: 'ceph.internal:7480'
};

function updateTypeFields() {
  const type = monitorType.value;
  targetInput.placeholder = targetPlaceholders[type] || targetPlaceholders.http;
  document.querySelectorAll('[data-type-fields]').forEach((element) => {
    const visible = element.dataset.typeFields.split(/\s+/).includes(type);
    element.hidden = !visible;
    element.querySelectorAll('input, select, textarea').forEach((control) => {
      control.disabled = !visible;
    });
  });
}

async function loadMeta() {
  const meta = await requestJson('/api/meta');
  state.meta = meta;
  document.querySelector('#monitor-type-count').textContent = `${meta.monitorTypeCount} 类`;
  monitorType.replaceChildren();
  for (const group of meta.monitorTypeGroups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const item of group.options) {
      typeLabels.set(item.value, item.label);
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      optgroup.append(option);
    }
    monitorType.append(optgroup);
  }
  monitorType.disabled = false;
  const typeFilter = document.querySelector('#type-filter');
  for (const group of meta.monitorTypeGroups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const item of group.options) optgroup.append(new Option(item.label, item.value));
    typeFilter.append(optgroup);
  }
  updateTypeFields();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: options.body ? { 'content-type': 'application/json' } : {},
    cache: 'no-store',
    ...options
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.errors?.join('；') || `请求失败 ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function percent(value) {
  return value === null || value === undefined ? '--' : `${(value * 100).toFixed(2)}%`;
}

function milliseconds(value) {
  return value === null || value === undefined ? '--' : `${Math.round(value)}ms`;
}

function timeLabel(value) {
  if (!value) return '尚未检查';
  return new Date(value).toLocaleTimeString();
}

function toast(message, isError = false) {
  document.querySelector('.toast')?.remove();
  const item = document.createElement('div');
  item.className = `toast${isError ? ' error' : ''}`;
  item.textContent = message;
  document.body.append(item);
  setTimeout(() => item.remove(), 4000);
}

function stat(label, value) {
  return `<article class="stat"><strong>${value}</strong><span>${label}</span></article>`;
}

function render() {
  if (!state.data) return;
  const { totals: summary, monitors, events, settings } = state.data;
  if (settings?.globalIntervalSeconds) {
    syncGlobalInterval(settings.globalIntervalSeconds);
    individualIntervalInput.placeholder = `当前全局 ${settings.globalIntervalSeconds}s`;
    if (useGlobalInterval.checked) individualIntervalInput.value = '';
  }
  pageUpdated.textContent = `页面更新 ${new Date().toLocaleTimeString()} · 全局 ${refreshInterval.value}s`;
  totals.innerHTML = [
    stat('总数', summary.monitors),
    stat('在线', summary.up),
    stat('异常', summary.down),
    stat('平均延迟', milliseconds(summary.averageResponseMs))
  ].join('');

  renderMonitors();
  document.querySelector('#event-count').textContent = `${events.length} 条`;

  eventList.innerHTML = events.length ? events.map((event) => `
    <li class="${event.kind}">
      <time>${new Date(event.time).toLocaleString()}</time>
      ${escapeHtml(event.message)}
    </li>
  `).join('') : '<li class="empty">暂无事件。</li>';
}

function monitorActions(item) {
  const id = escapeHtml(item.monitorId);
  const action = (name, icon, label, extra = '') => `<button class="icon-button${name === 'delete' ? ' danger' : ''}" data-action="${name}" data-id="${id}" ${extra} title="${label}" aria-label="${label}：${escapeHtml(item.name)}"><span data-icon="${icon}"></span></button>`;
  return action('check', 'refresh-cw', '立即检查')
    + action('interval', 'timer', '改间隔', `data-interval="${item.intervalOverrideSeconds ?? ''}"`)
    + action('toggle', item.active ? 'pause' : 'play', item.active ? '暂停' : '恢复', `data-active="${item.active}"`)
    + action('delete', 'trash', '删除');
}

function monitorDetails(item) {
  return `<p class="meta">${typeMeta(item)}</p><p class="check-message">${escapeHtml(item.message)}</p><div class="metrics"><span>${item.followsGlobalInterval ? '全局间隔' : '单独间隔'} <b>${item.intervalSeconds}s</b></span><span>7d 在线 <b>${percent(item.day7d?.uptimeRatio)}</b></span><span>最近检查 <b>${timeLabel(item.lastCheckedAt)}</b></span></div>`;
}

function renderMonitors() {
  if (!state.data) return;
  const result = MonitorView.select(state.data.monitors, view, typeLabels);
  view.page = result.page;
  const scrollTop = listViewport.scrollTop;
  const focused = monitorGrid.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
  monitorGrid.className = `monitor-grid ${view.mode === 'cards' ? 'card-grid' : 'compact-list'}`;
  document.querySelector('#list-column-head').hidden = view.mode === 'cards';
  monitorGrid.innerHTML = result.items.length ? result.items.map((item) => {
    const id = escapeHtml(item.monitorId);
    if (view.mode === 'cards') return `<article class="monitor ${item.status}" data-monitor-id="${id}"><div class="monitor-head"><h3>${escapeHtml(item.name)}</h3><span class="badge">${statusText(item.status)}</span></div>${monitorDetails(item)}<div class="bars">${renderBars(item.bars)}</div><div class="metrics"><span>24h 在线 <b>${percent(item.day24h?.uptimeRatio)}</b></span><span>P95 <b>${milliseconds(item.day24h?.p95ResponseMs)}</b></span></div><div class="card-actions">${monitorActions(item)}</div></article>`;
    const expanded = expandedMonitors.has(item.monitorId);
    return `<article class="monitor monitor-row ${item.status}" data-monitor-id="${id}"><div class="monitor-row-main"><div class="row-identity"><span class="status-dot" title="${statusText(item.status)}"></span><div><h3>${escapeHtml(item.name)}</h3><p class="meta" title="${escapeHtml(item.target)}">${escapeHtml(item.target)}</p></div></div><div class="row-heartbeat"><div class="bars">${renderBars(item.bars)}</div><span class="row-status">${statusText(item.status)}</span></div><span class="row-value uptime-value">${percent(item.day24h?.uptimeRatio)}</span><span class="row-value latency-value">${milliseconds(item.day24h?.p95ResponseMs)}</span><span class="row-value interval-value" title="${item.followsGlobalInterval ? '全局间隔' : '单独间隔'}">${item.intervalSeconds}s</span><div class="row-actions">${monitorActions(item)}<button class="icon-button expand-button" data-action="details" data-id="${id}" title="${expanded ? '收起详情' : '展开详情'}" aria-label="${expanded ? '收起详情' : '展开详情'}：${escapeHtml(item.name)}" aria-expanded="${expanded}" aria-controls="details-${id}"><span data-icon="chevron-down"></span></button></div></div><div id="details-${id}" class="monitor-details" ${expanded ? '' : 'hidden'}>${monitorDetails(item)}</div></article>`;
  }).join('') : `<div class="empty-state"><span data-icon="search"></span><h3>${state.data.monitors.length ? '没有匹配的监控' : '暂无监控项目'}</h3>${state.data.monitors.length ? '<button id="clear-filters">清除筛选</button>' : '<button id="empty-create" class="primary">新增监控</button>'}</div>`;
  document.querySelector('#monitor-result-count').textContent = `全部 ${state.data.monitors.length} 项${result.total !== state.data.monitors.length ? ` · 筛选 ${result.total} 项` : ''}`;
  document.querySelector('#page-range').textContent = result.total ? `${result.from}–${result.to} / ${result.total} 项` : '0 项';
  document.querySelector('#page-number').textContent = `${result.page} / ${result.pageCount}`;
  document.querySelector('#previous-page').disabled = result.page <= 1;
  document.querySelector('#next-page').disabled = result.page >= result.pageCount;
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === view.mode)));
  UptimeIcons.render(monitorGrid);
  listViewport.scrollTop = scrollTop;
  if (focused?.action && focused.id) {
    [...monitorGrid.querySelectorAll('button[data-action]')].find((button) => button.dataset.action === focused.action && button.dataset.id === focused.id)?.focus({ preventScroll: true });
  }
}

function syncGlobalInterval(seconds) {
  const value = String(seconds);
  refreshInterval.querySelector('option[data-custom]')?.remove();
  if (![...refreshInterval.options].some((option) => option.value === value)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} 秒`;
    option.dataset.custom = 'true';
    refreshInterval.append(option);
  }
  refreshInterval.value = value;
}

function renderBars(bars) {
  if (!bars.length) return '<i></i>'.repeat(40);
  const padding = Array(Math.max(0, 40 - bars.length)).fill('<i></i>').join('');
  return padding + bars.map((bar) => `<i class="${bar.status}" title="${new Date(bar.time).toLocaleString()} · ${bar.responseTime ?? '--'}ms"></i>`).join('');
}

function statusText(status) {
  return { up: '正常', down: '异常', paused: '已暂停', unknown: '未知' }[status];
}

function typeMeta(item) {
  const labels = {
    http: `HTTP · 期望 ${item.expectedStatus || 200}`,
    keyword: `关键字 · 期望 ${item.expectedStatus || 200}`,
    http_json: `JSON ${item.jsonPath ? escapeHtml(item.jsonPath) : '校验'}`,
    regex: `正则 ${escapeHtml(item.bodyPattern || '')}`,
    tcp: 'TCP',
    ping: 'PING',
    dns: `DNS ${item.dnsRecordType || 'A'}${item.expectedValue ? ` · ${escapeHtml(item.expectedValue)}` : ''}`,
    ssl: `SSL · 阈值 ${item.sslWarnDays ?? 30} 天`,
    websocket: 'WebSocket',
    redis: 'Redis PING',
    memcached: 'Memcached stats',
    mysql: 'MySQL handshake',
    postgres: 'PostgreSQL SSLRequest',
    mqtt: 'MQTT CONNECT',
    amqp: 'AMQP protocol header', kafka: 'Kafka ApiVersions',
    mongodb: 'MongoDB OP_MSG hello', mssql: 'MSSQL PRELOGIN',
    ldap: 'LDAP anonymous bind', socks5: 'SOCKS5 methods',
    vnc: 'VNC RFB banner', zookeeper: 'ZooKeeper mntr',
    sip: 'SIP OPTIONS', snmp: 'SNMP sysDescr query',
    prometheus: 'Prometheus /-/healthy', grafana: 'Grafana /api/health',
    elasticsearch: 'Elasticsearch API', influxdb: 'InfluxDB health',
    etcd: 'etcd health', consul: 'Consul leader',
    rabbitmq_management: 'RabbitMQ Management API',
    docker_registry: 'Registry V2 API', minio: 'MinIO live probe',
    clickhouse: 'ClickHouse ping', couchdb: 'CouchDB API',
    traefik: 'Traefik ping', nacos: 'Nacos health',
    smtp: 'SMTP banner', ssh: 'SSH banner', ftp: 'FTP banner',
    imap: 'IMAP banner', pop3: 'POP3 banner', ntp: 'NTP'
  };
  return `${labels[item.type] || typeLabels.get(item.type) || item.type.toUpperCase()} · ${escapeHtml(item.target)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(form));
  values.useGlobalInterval = useGlobalInterval.checked;
  if (useGlobalInterval.checked) delete values.intervalSeconds;
  try {
    const created = await requestJson('/api/monitors', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    individualIntervalInput.value = '';
    individualIntervalInput.disabled = true;
    updateTypeFields();
    monitorDialog.close();
    toast('监控已创建并完成首次检查');
    await loadState(true);
    clearFilters();
    const index = state.data.monitors.findIndex((item) => item.monitorId === created.id);
    view.page = Math.floor(Math.max(0, index) / view.pageSize) + 1;
    renderMonitors();
  } catch (error) {
    toast(error.message, true);
  }
});

importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = new FormData(importForm).get('records').trim();
  try {
    const records = JSON.parse(raw);
    const result = await requestJson('/api/import', { method: 'POST', body: JSON.stringify({ records }) });
    importForm.reset();
    importDialog.close();
    toast(`历史导入完成：新增 ${result.accepted} 条，重复 ${result.duplicates || 0} 条，拒绝 ${result.rejected} 条`);
    await loadState(true);
  } catch (error) {
    toast(`导入失败：${error.message}`, true);
  }
});

monitorGrid.addEventListener('click', async (event) => {
  if (event.target.closest('#clear-filters')) return clearFilters();
  if (event.target.closest('#empty-create')) return monitorDialog.showModal();
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, id, interval } = button.dataset;
  if (action === 'details') {
    if (expandedMonitors.has(id)) expandedMonitors.delete(id);
    else expandedMonitors.add(id);
    renderMonitors();
    return;
  }
  try {
    if (action === 'check') await requestJson(`/api/monitors/${id}/check`, { method: 'POST' });
    if (action === 'interval') {
      const value = window.prompt('新的单独间隔（1 到 86400 秒；留空恢复全局）', interval);
      if (value === null) return;
      if (!value) {
        await requestJson(`/api/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ useGlobalInterval: true }) });
      } else {
        if (!/^[1-9][0-9]*$/.test(value) || Number(value) > 86400) throw new Error('间隔必须是 1 到 86400 的整数秒');
        await requestJson(`/api/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ intervalSeconds: Number(value) }) });
      }
    }
    if (action === 'toggle') await requestJson(`/api/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ active: button.dataset.active !== 'true' }) });
    if (action === 'delete') {
      if (!confirm('删除后该监控及其心跳历史会一起移除，确定吗？')) return;
      await requestJson(`/api/monitors/${id}`, { method: 'DELETE' });
    }
    await loadState(true);
  } catch (error) {
    toast(error.message, true);
  }
});

document.querySelector('#refresh').addEventListener('click', () => loadState(true));
document.querySelector('#open-monitor').addEventListener('click', () => monitorDialog.showModal());
document.querySelector('#open-import').addEventListener('click', () => importDialog.showModal());
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
for (const dialog of [monitorDialog, importDialog]) {
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
}

function clearFilters() {
  Object.assign(view, { query: '', status: 'all', type: 'all', sort: 'default', page: 1 });
  for (const [id, key] of [['monitor-search', 'query'], ['status-filter', 'status'], ['type-filter', 'type'], ['monitor-sort', 'sort']]) document.getElementById(id).value = view[key];
  listViewport.scrollTop = 0;
  renderMonitors();
}

for (const [id, key] of [['monitor-search', 'query'], ['status-filter', 'status'], ['type-filter', 'type'], ['monitor-sort', 'sort'], ['page-size', 'pageSize']]) {
  const control = document.getElementById(id);
  control.value = view[key];
  control.addEventListener(id === 'monitor-search' ? 'input' : 'change', () => {
    view[key] = key === 'pageSize' ? Number(control.value) : control.value;
    view.page = 1;
    listViewport.scrollTop = 0;
    saveViewPreferences();
    renderMonitors();
  });
}
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  view.mode = button.dataset.view;
  listViewport.scrollTop = 0;
  saveViewPreferences();
  renderMonitors();
}));
for (const [id, change] of [['previous-page', -1], ['next-page', 1]]) document.getElementById(id).addEventListener('click', () => {
  view.page += change;
  listViewport.scrollTop = 0;
  renderMonitors();
});

function scheduleRefresh() {
  clearTimeout(window.uptimeRefreshTimer);
  const seconds = Number(refreshInterval.value) || 5;
  window.uptimeRefreshTimer = setTimeout(async () => {
    await loadState();
    scheduleRefresh();
  }, seconds * 1000);
}

refreshInterval.addEventListener('change', async () => {
  const seconds = Number(refreshInterval.value);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) return;
  try {
    await requestJson('/api/settings', { method: 'PATCH', body: JSON.stringify({ globalIntervalSeconds: seconds }) });
    await loadState(true);
    scheduleRefresh();
  } catch (error) {
    if (state.data?.settings?.globalIntervalSeconds) {
      refreshInterval.value = String(state.data.settings.globalIntervalSeconds);
    }
    toast(`全局间隔保存失败：${error.message}`, true);
  }
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadState(true);
});

async function loadState(force = false) {
  if (state.loading && !force) return;
  state.loading = true;
  const generation = ++state.generation;
  try {
    const data = await requestJson('/api/state');
    if (generation === state.generation) {
      state.data = data;
      render();
    }
  } catch (error) {
    pageUpdated.textContent = `刷新失败：${error.message}`;
    toast(error.message, true);
  } finally {
    state.loading = false;
  }
}

monitorType.addEventListener('change', updateTypeFields);
useGlobalInterval.addEventListener('change', () => {
  individualIntervalInput.disabled = useGlobalInterval.checked;
  if (useGlobalInterval.checked) {
    individualIntervalInput.value = '';
  } else if (!individualIntervalInput.value) {
    individualIntervalInput.value = state.data?.settings?.globalIntervalSeconds ?? 60;
  }
});
async function initialize() {
  try {
    await loadMeta();
    await loadState(true);
    scheduleRefresh();
  } catch (error) {
    pageUpdated.textContent = `初始化失败：${error.message}`;
    toast(error.message, true);
  }
}

initialize();
