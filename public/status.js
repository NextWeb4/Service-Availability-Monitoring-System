async function requestJson(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`请求失败 ${response.status}`);
  return response.json();
}

function percent(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '--';
}

function milliseconds(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : '--';
}

function stat(label, value) {
  return `<article class="stat"><strong>${escapeHtml(value)}</strong><span>${label}</span></article>`;
}

function statusText(status) {
  return { up: '正常', down: '异常', paused: '已暂停', unknown: '未知' }[status] || '未知';
}

function statusClass(status) {
  return ['up', 'down', 'paused', 'unknown'].includes(status) ? status : 'unknown';
}

function renderBars(bars = []) {
  const marks = bars.slice(-40);
  const padding = '<i></i>'.repeat(40 - marks.length);
  return padding + marks.map((bar) => (
    `<i class="${statusClass(bar.status)}" title="${escapeHtml(`${new Date(bar.time).toLocaleString()} · ${milliseconds(bar.responseTime)}`)}"></i>`
  )).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

const pageState = {
  data: null,
  meta: null,
  generation: 0,
  loading: false,
  typeOptionsKey: '',
  view: 'list',
  expanded: new Set(),
  filters: { query: '', status: 'all', type: 'all', sort: 'default', page: 1, pageSize: 25 }
};
const typeLabels = new Map();
const statusIntervalLabel = document.querySelector('#status-interval');
const services = document.querySelector('#services');
const monitorViewport = document.querySelector('.monitor-viewport');
const typeFilter = document.querySelector('#type-filter');
const previousPage = document.querySelector('#previous-page');
const nextPage = document.querySelector('#next-page');
let currentIntervalSeconds = 1;

function syncTypeOptions() {
  const known = new Set();
  const groups = (pageState.meta?.monitorTypeGroups || []).map((group) => ({
    label: group.label,
    options: group.options.map((item) => {
      known.add(item.value);
      typeLabels.set(item.value, item.label);
      return { value: item.value, label: item.label };
    })
  }));
  const available = new Set((pageState.data?.monitors || []).map((item) => item.type));
  if (pageState.filters.type !== 'all') available.add(pageState.filters.type);
  const extra = [...available].filter((type) => !known.has(type)).sort().map((type) => ({
    value: type,
    label: typeLabels.get(type) || type.toUpperCase()
  }));
  if (extra.length) groups.push({ label: '其他类型', options: extra });
  const key = JSON.stringify(groups);
  if (key === pageState.typeOptionsKey) return;
  pageState.typeOptionsKey = key;

  const options = document.createDocumentFragment();
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = '全部类型';
  options.append(all);
  for (const group of groups) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group.label;
    for (const item of group.options) {
      const option = document.createElement('option');
      option.value = item.value;
      option.textContent = item.label;
      optgroup.append(option);
    }
    options.append(optgroup);
  }
  typeFilter.replaceChildren(options);
  typeFilter.value = pageState.filters.type;
}

function monitorMetrics(item) {
  return `<div class="metrics">
    <span>延迟 <b>${milliseconds(item.latestResponseTime)}</b></span>
    <span>24h 在线 <b>${percent(item.day24h?.uptimeRatio)}</b></span>
    <span>7d 在线 <b>${percent(item.day7d?.uptimeRatio)}</b></span>
    <span>P95 <b>${milliseconds(item.day24h?.p95ResponseMs)}</b></span>
    <span>${item.followsGlobalInterval ? '全局间隔' : '单独间隔'} <b>${escapeHtml(item.intervalSeconds)}s</b></span>
  </div>`;
}

function monitorDetails(item) {
  return `${monitorMetrics(item)}
    <p class="check-message">${escapeHtml(item.message || '尚无检查结果')}</p>
    <p class="meta">${escapeHtml(typeLabels.get(item.type) || item.type.toUpperCase())} · ${item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleString() : '尚未检查'}</p>`;
}

function renderMonitorRow(item) {
  const id = String(item.monitorId);
  const detailsId = `status-details-${encodeURIComponent(id)}`;
  const expanded = pageState.expanded.has(id);
  const detailsLabel = expanded ? '收起详情' : '展开详情';
  return `
    <article class="monitor monitor-row ${statusClass(item.status)}">
      <div class="monitor-row-main">
        <div class="row-identity">
          <span class="status-dot" aria-hidden="true"></span>
          <div><h3>${escapeHtml(item.name)}</h3><p class="meta" title="${escapeHtml(item.target)}">${escapeHtml(item.target)}</p></div>
        </div>
        <div class="row-heartbeat">
          <div class="bars" role="img" aria-label="最近 ${Math.min(item.bars?.length || 0, 40)} 次检查">${renderBars(item.bars)}</div>
          <span class="row-status">${statusText(item.status)}</span>
        </div>
        <span class="row-value uptime-value"><span class="sr-only">24h 在线率 </span>${percent(item.day24h?.uptimeRatio)}</span>
        <span class="row-value latency-value"><span class="sr-only">最新延迟 </span>${milliseconds(item.latestResponseTime)}</span>
        <span class="row-value interval-value" title="${item.followsGlobalInterval ? '全局间隔' : '单独间隔'}"><span class="sr-only">检查间隔 </span>${escapeHtml(item.intervalSeconds)}s</span>
        <div class="row-actions"><button class="icon-button expand-button" type="button" data-action="details" data-id="${escapeHtml(id)}" aria-expanded="${expanded}" aria-controls="${detailsId}" title="${detailsLabel}" aria-label="${detailsLabel}：${escapeHtml(item.name)}"><span data-icon="chevron-down" aria-hidden="true"></span></button></div>
      </div>
      <div id="${detailsId}" class="monitor-details" ${expanded ? '' : 'hidden'}>${monitorDetails(item)}</div>
    </article>`;
}

function renderMonitorCard(item) {
  return `
    <article class="monitor ${statusClass(item.status)}">
      <div class="monitor-head">
        <div>
          <h3>${escapeHtml(item.name)}</h3>
          <p class="meta" title="${escapeHtml(item.target)}">${escapeHtml(typeLabels.get(item.type) || item.type.toUpperCase())} · ${escapeHtml(item.target)}</p>
        </div>
        <span class="badge">${statusText(item.status)}</span>
      </div>
      <div class="bars" role="img" aria-label="最近 ${Math.min(item.bars?.length || 0, 40)} 次检查">${renderBars(item.bars)}</div>
      ${monitorDetails(item)}
    </article>`;
}

function renderMonitors() {
  if (!pageState.data) return;
  const scrollTop = monitorViewport.scrollTop;
  const scrollLeft = monitorViewport.scrollLeft;
  const focusedId = services.contains(document.activeElement)
    ? document.activeElement.closest('button[data-action="details"]')?.dataset.id : null;
  const result = window.MonitorView.select(pageState.data.monitors, pageState.filters, typeLabels);
  pageState.filters.page = result.page;
  services.className = `monitor-grid ${pageState.view === 'list' ? 'compact-list' : 'card-grid'}`;
  document.querySelector('#list-column-head').hidden = pageState.view !== 'list';
  services.innerHTML = result.items.length ? result.items.map(
    pageState.view === 'list' ? renderMonitorRow : renderMonitorCard
  ).join('') : `<p class="empty-state">${pageState.data.monitors.length ? '没有符合筛选条件的监控项。' : '当前没有公开监控项。'}</p>`;
  services.setAttribute('aria-busy', 'false');
  window.UptimeIcons.render(services);
  monitorViewport.scrollTop = scrollTop;
  monitorViewport.scrollLeft = scrollLeft;
  if (focusedId !== null) {
    [...services.querySelectorAll('button[data-action="details"]')]
      .find((button) => button.dataset.id === focusedId)?.focus({ preventScroll: true });
  }

  const range = result.total ? `显示 ${result.from} - ${result.to} 项，共 ${result.total} 项` : '共 0 项';
  const resultRange = document.querySelector('#result-range');
  if (resultRange.textContent !== range) resultRange.textContent = range;
  const pageIndicator = document.querySelector('#page-indicator');
  pageIndicator.textContent = `${result.page} / ${result.pageCount}`;
  pageIndicator.setAttribute('aria-label', `第 ${result.page} 页，共 ${result.pageCount} 页`);
  previousPage.disabled = result.page <= 1;
  nextPage.disabled = result.page >= result.pageCount;
}

function render() {
  const data = pageState.data;
  const seconds = Number(data.settings?.globalIntervalSeconds);
  if (Number.isInteger(seconds) && seconds >= 1) {
    currentIntervalSeconds = seconds;
    statusIntervalLabel.textContent = `${seconds} 秒`;
  }
  document.querySelector('#updated-at').textContent = `更新于 ${new Date(data.generatedAt).toLocaleString()}`;
  document.querySelector('#service-count').textContent = `共 ${data.monitors.length} 项`;
  document.querySelector('#summary').innerHTML = [
    stat('总数', data.totals.monitors),
    stat('在线', data.totals.up),
    stat('异常', data.totals.down),
    stat('平均延迟', milliseconds(data.totals.averageResponseMs))
  ].join('');
  syncTypeOptions();
  renderMonitors();

  document.querySelector('#event-count').textContent = data.events.length;
  document.querySelector('#events').innerHTML = data.events.length ? data.events.map((event) => `
    <li class="${event.kind === 'incident' ? 'incident' : 'recovered'}">
      <time>${new Date(event.time).toLocaleString()}</time>
      ${escapeHtml(event.message)}
    </li>
  `).join('') : '<li class="empty">暂无事件。</li>';
}

async function loadMeta() {
  try {
    pageState.meta = await requestJson('/api/meta');
    syncTypeOptions();
    renderMonitors();
  } catch {
    syncTypeOptions();
  }
}

async function load(force = false) {
  if (pageState.loading && !force) return;
  pageState.loading = true;
  const generation = ++pageState.generation;
  try {
    const data = await requestJson('/api/state');
    if (generation !== pageState.generation) return;
    pageState.data = data;
    render();
  } catch {
    if (generation !== pageState.generation) return;
    document.querySelector('#updated-at').textContent = pageState.data
      ? `刷新失败 · 上次更新 ${new Date(pageState.data.generatedAt).toLocaleString()}`
      : '状态暂时不可用';
    if (!pageState.data) {
      services.innerHTML = '<p class="empty-state">状态暂时不可用。</p>';
      services.setAttribute('aria-busy', 'false');
      document.querySelector('#service-count').textContent = '暂时不可用';
      document.querySelector('#result-range').textContent = '暂时不可用';
      document.querySelector('#events').innerHTML = '<li class="empty">事件暂时不可用。</li>';
    }
  } finally {
    if (generation === pageState.generation) pageState.loading = false;
  }
}

function scheduleRefresh() {
  clearTimeout(window.statusRefreshTimer);
  window.statusRefreshTimer = setTimeout(async () => {
    await load();
    scheduleRefresh();
  }, currentIntervalSeconds * 1000);
}

function updateFilter(key, value) {
  pageState.filters[key] = value;
  pageState.filters.page = 1;
  renderMonitors();
  monitorViewport.scrollTop = 0;
}

document.querySelector('#monitor-search').addEventListener('input', (event) => {
  updateFilter('query', event.target.value);
});
document.querySelector('#status-filter').addEventListener('change', (event) => {
  updateFilter('status', event.target.value);
});
typeFilter.addEventListener('change', (event) => {
  updateFilter('type', event.target.value);
});
document.querySelector('#page-size').addEventListener('change', (event) => {
  updateFilter('pageSize', Number(event.target.value));
});
document.querySelector('#sort-order').addEventListener('change', (event) => {
  pageState.filters.sort = event.target.value;
  renderMonitors();
  monitorViewport.scrollTop = 0;
});

previousPage.addEventListener('click', () => {
  if (previousPage.disabled) return;
  pageState.filters.page -= 1;
  renderMonitors();
  monitorViewport.scrollTop = 0;
});
nextPage.addEventListener('click', () => {
  if (nextPage.disabled) return;
  pageState.filters.page += 1;
  renderMonitors();
  monitorViewport.scrollTop = 0;
});

services.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action="details"]');
  if (!button) return;
  const id = button.dataset.id;
  if (pageState.expanded.has(id)) pageState.expanded.delete(id);
  else pageState.expanded.add(id);
  const expanded = pageState.expanded.has(id);
  const label = expanded ? '收起详情' : '展开详情';
  button.setAttribute('aria-expanded', String(expanded));
  button.title = label;
  button.setAttribute('aria-label', `${label}：${button.closest('article').querySelector('h3').textContent}`);
  document.getElementById(button.getAttribute('aria-controls')).hidden = !expanded;
});

document.querySelector('.view-switch').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (!button) return;
  pageState.view = button.dataset.view;
  document.querySelectorAll('.view-switch button').forEach((item) => {
    item.setAttribute('aria-pressed', String(item === button));
  });
  renderMonitors();
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) load(true).finally(scheduleRefresh);
});

window.UptimeIcons.render();
loadMeta();
load(true).finally(scheduleRefresh);
