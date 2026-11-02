(function (root, factory) {
  const monitorView = factory();
  if (typeof module === 'object' && module.exports) module.exports = monitorView;
  if (root) root.MonitorView = monitorView;
}(typeof window === 'undefined' ? null : window, function () {
  'use strict';

  const statusOrder = new Map(['down', 'unknown', 'up', 'paused'].map((status, index) => [status, index]));

  function compareName(a, b) {
    return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-CN', { numeric: true });
  }

  function compareIdentity(a, b) {
    const left = String(a.monitorId ?? a.id ?? '');
    const right = String(b.monitorId ?? b.id ?? '');
    return left.localeCompare(right, 'zh-CN', { numeric: true }) || (left < right ? -1 : left > right ? 1 : 0);
  }

  function compareLatency(a, b) {
    const leftFinite = Number.isFinite(a.latestResponseTime);
    const rightFinite = Number.isFinite(b.latestResponseTime);
    if (leftFinite !== rightFinite) return leftFinite ? -1 : 1;
    return leftFinite ? b.latestResponseTime - a.latestResponseTime : 0;
  }

  function select(monitors, options = {}, typeLabels = new Map()) {
    const { query = '', status = 'all', type = 'all', sort = 'default' } = options;
    const tokens = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const requestedSize = Number(options.pageSize);
    const pageSize = [10, 25, 50].includes(requestedSize) ? requestedSize : 10;
    let filtered = monitors.filter((monitor) => {
      if (status !== 'all' && monitor.status !== status) return false;
      if (type !== 'all' && monitor.type !== type) return false;
      if (!tokens.length) return true;
      const text = [monitor.name, monitor.target, monitor.type, typeLabels.get(monitor.type)].join(' ').toLowerCase();
      return tokens.every((token) => text.includes(token));
    });

    const comparators = {
      name: compareName,
      status: (a, b) => ((statusOrder.get(a.status) ?? 4) - (statusOrder.get(b.status) ?? 4))
        || compareName(a, b) || compareIdentity(a, b),
      latency: (a, b) => compareLatency(a, b) || compareName(a, b) || compareIdentity(a, b)
    };
    if (Object.hasOwn(comparators, sort)) {
      const compare = comparators[sort];
      // Keep equal rows stable even when their names or identities collate equally.
      const sorted = filtered.map((monitor, index) => ({ monitor, index }));
      sorted.sort((a, b) => compare(a.monitor, b.monitor) || a.index - b.index);
      filtered = sorted.map((entry) => entry.monitor);
    }

    const total = filtered.length;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const requestedPage = Number(options.page);
    const page = Number.isFinite(requestedPage) ? Math.min(pageCount, Math.max(1, Math.floor(requestedPage))) : 1;
    const offset = (page - 1) * pageSize;
    return {
      items: filtered.slice(offset, offset + pageSize),
      total,
      page,
      pageCount,
      pageSize,
      from: total ? offset + 1 : 0,
      to: Math.min(total, offset + pageSize)
    };
  }

  return { select };
}));
