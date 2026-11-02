const crypto = require('crypto');

const MONITOR_TYPE_GROUPS = [
  {
    label: 'HTTP 与内容',
    options: [
      ['http', 'HTTP 状态'], ['keyword', 'HTTP 关键字'],
      ['http_json', 'HTTP JSON 字段'], ['regex', 'HTTP 正则']
    ]
  },
  {
    label: '网络与传输',
    options: [
      ['tcp', 'TCP 端口'], ['ping', 'Ping'], ['dns', 'DNS 记录'],
      ['ssl', 'SSL 证书'], ['websocket', 'WebSocket 握手'], ['ntp', 'NTP 时间'],
      ['sip', 'SIP 服务'], ['snmp', 'SNMP sysDescr'], ['whois', 'WHOIS 查询']
    ]
  },
  {
    label: '数据库与缓存',
    options: [
      ['redis', 'Redis'], ['redis_tls', 'Redis TLS'], ['memcached', 'Memcached'],
      ['mysql', 'MySQL / MariaDB'], ['postgres', 'PostgreSQL'],
      ['mongodb', 'MongoDB'], ['mssql', 'SQL Server'], ['cassandra', 'Cassandra']
    ]
  },
  {
    label: '消息与协调',
    options: [
      ['mqtt', 'MQTT Broker'], ['amqp', 'RabbitMQ / AMQP'], ['kafka', 'Kafka Broker'],
      ['zookeeper', 'ZooKeeper'], ['beanstalkd', 'Beanstalkd'],
      ['gearman', 'Gearman'], ['nats', 'NATS']
    ]
  },
  {
    label: '目录、代理与远程',
    options: [
      ['ldap', 'LDAP 匿名绑定'], ['ldaps', 'LDAPS 匿名绑定'],
      ['socks5', 'SOCKS5 Proxy'], ['vnc', 'VNC Server'],
      ['xmpp', 'XMPP Server'], ['irc', 'IRC Server']
    ]
  },
  {
    label: '邮件与文件服务',
    options: [
      ['smtp', 'SMTP'], ['smtps', 'SMTPS'], ['imap', 'IMAP'], ['imaps', 'IMAPS'],
      ['pop3', 'POP3'], ['pop3s', 'POP3S'], ['ftp', 'FTP'], ['ftps', 'FTPS'],
      ['ssh', 'SSH']
    ]
  },
  {
    label: '可观测性',
    options: [
      ['prometheus', 'Prometheus'], ['grafana', 'Grafana'],
      ['elasticsearch', 'Elasticsearch'], ['influxdb', 'InfluxDB'],
      ['etcd', 'etcd'], ['consul', 'Consul'],
      ['rabbitmq_management', 'RabbitMQ Management'],
      ['docker_registry', 'Docker Registry'], ['minio', 'MinIO'],
      ['clickhouse', 'ClickHouse'], ['couchdb', 'CouchDB'],
      ['traefik', 'Traefik'], ['nacos', 'Nacos'],
      ['alertmanager', 'Alertmanager'], ['victoriametrics', 'VictoriaMetrics'],
      ['loki', 'Loki'], ['prometheus_pushgateway', 'Prometheus Pushgateway'],
      ['thanos_query', 'Thanos Query'], ['zipkin', 'Zipkin'],
      ['jaeger_query', 'Jaeger Query'],
      ['opentelemetry_collector', 'OpenTelemetry Collector'],
      ['netdata', 'Netdata'], ['envoy', 'Envoy Admin']
    ]
  },
  {
    label: '基础设施与研发',
    options: [
      ['docker_engine', 'Docker Engine'], ['kubernetes', 'Kubernetes API'],
      ['nomad', 'Nomad'], ['vault', 'Vault'], ['harbor', 'Harbor'],
      ['portainer', 'Portainer'], ['jenkins', 'Jenkins'], ['gitlab', 'GitLab'],
      ['gitea', 'Gitea'], ['forgejo', 'Forgejo'], ['argocd', 'Argo CD'],
      ['drone', 'Drone CI'], ['woodpecker', 'Woodpecker CI'],
      ['sonarqube', 'SonarQube'], ['nexus', 'Nexus Repository'],
      ['artifactory', 'Artifactory'], ['keycloak', 'Keycloak'],
      ['authentik', 'authentik'], ['authelia', 'Authelia'],
      ['proxmox', 'Proxmox VE'], ['ceph_rgw', 'Ceph RGW']
    ]
  },
  {
    label: '应用与数据平台',
    options: [
      ['nextcloud', 'Nextcloud'], ['jellyfin', 'Jellyfin'], ['plex', 'Plex'],
      ['immich', 'Immich'], ['home_assistant', 'Home Assistant'],
      ['node_red', 'Node-RED'], ['airflow', 'Apache Airflow'],
      ['superset', 'Apache Superset'], ['metabase', 'Metabase'],
      ['redash', 'Redash'], ['mattermost', 'Mattermost'],
      ['matrix_synapse', 'Matrix Synapse'], ['ghost', 'Ghost']
    ]
  }
];
const MONITOR_TYPES = MONITOR_TYPE_GROUPS.flatMap((group) => group.options.map(([value]) => value));
const HOST_PORT_TYPES = new Set([
  'tcp', 'redis', 'memcached', 'mysql', 'postgres', 'mqtt', 'smtp', 'ssh',
  'ftp', 'imap', 'pop3', 'amqp', 'kafka', 'mongodb', 'mssql', 'ldap',
  'socks5', 'vnc', 'zookeeper', 'sip', 'snmp', 'smtps', 'imaps', 'pop3s',
  'ftps', 'ldaps', 'redis_tls', 'beanstalkd', 'gearman', 'nats', 'cassandra',
  'xmpp', 'irc', 'whois'
]);
const HEALTH_HTTP_TYPES = new Set([
  'prometheus', 'grafana', 'elasticsearch', 'influxdb', 'etcd', 'consul',
  'rabbitmq_management', 'docker_registry', 'minio', 'clickhouse', 'couchdb',
  'traefik', 'nacos', 'docker_engine', 'kubernetes', 'nomad', 'vault',
  'harbor', 'portainer', 'jenkins', 'gitlab', 'gitea', 'forgejo', 'argocd',
  'drone', 'woodpecker', 'sonarqube', 'nexus', 'artifactory', 'keycloak',
  'authentik', 'authelia', 'nextcloud', 'jellyfin', 'plex', 'immich',
  'home_assistant', 'node_red', 'netdata', 'proxmox', 'envoy', 'airflow',
  'superset', 'metabase', 'redash', 'mattermost', 'matrix_synapse', 'ghost',
  'alertmanager', 'victoriametrics', 'loki', 'prometheus_pushgateway',
  'thanos_query', 'zipkin', 'jaeger_query', 'opentelemetry_collector',
  'ceph_rgw'
]);
const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV'];
const GLOBAL_INTERVAL_MIN = 1;
const GLOBAL_INTERVAL_MAX = 86400;

function id() {
  return crypto.randomUUID();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeMonitor(input, globalIntervalSeconds = 60) {
  const errors = [];
  const name = String(input.name || '').trim();
  const type = String(input.type || 'http').toLowerCase();
  const target = String(input.target || '').trim();
  const keyword = String(input.keyword || '').trim();
  const dnsRecordType = String(input.dnsRecordType || 'A').toUpperCase();
  const expectedValue = String(input.expectedValue || '').trim();
  const jsonPath = String(input.jsonPath || '').trim();
  const bodyPattern = String(input.bodyPattern || '').trim();
  const sslWarnDays = clampInteger(input.sslWarnDays ?? 30, 0, 3650, 30);
  const snmpCommunity = String(input.snmpCommunity || 'public').trim().slice(0, 128) || 'public';

  if (!name) errors.push('名称不能为空');
  if (!MONITOR_TYPES.includes(type)) errors.push(`类型必须是 ${MONITOR_TYPES.join('、')}`);
  if (!target) errors.push('目标地址不能为空');
  if (['http', 'keyword', 'http_json'].includes(type) && !/^https?:\/\//i.test(target)) {
    errors.push('HTTP 目标必须以 http:// 或 https:// 开头');
  }
  if (type === 'ping' && !isSafeHost(target)) errors.push('Ping 目标必须是主机名或 IP');
  if (type === 'dns' && !isSafeHost(target)) errors.push('DNS 目标必须是主机名');
  if (type === 'dns' && !DNS_RECORD_TYPES.includes(dnsRecordType)) {
    errors.push(`DNS 记录类型必须是 ${DNS_RECORD_TYPES.join('、')}`);
  }
  if (type === 'websocket') {
    try {
      const endpoint = new URL(target);
      if (!['ws:', 'wss:'].includes(endpoint.protocol) || !endpoint.hostname) errors.push('WebSocket 目标必须是 ws:// 或 wss:// URL');
    } catch {
      errors.push('WebSocket 目标必须是 ws:// 或 wss:// URL');
    }
  }
  if (!HEALTH_HTTP_TYPES.has(type)) {
    if (HOST_PORT_TYPES.has(type) && !/^[a-z0-9][a-z0-9._-]*(:[1-9][0-9]{0,4})?$/i.test(target)) {
      errors.push('服务目标必须是 hostname 或 hostname:port');
    }
  } else if (/^https?:\/\//i.test(target)) {
    try {
      const endpoint = new URL(target);
      if (!endpoint.hostname) errors.push('健康端点必须是可访问的 HTTP 地址');
    } catch {
      errors.push('健康端点必须是可访问的 HTTP 地址');
    }
  } else if (!/^[a-z0-9][a-z0-9._-]*(:[1-9][0-9]{0,4})?$/i.test(target)) {
    errors.push('健康端点必须是 hostname、hostname:port 或 HTTP 地址');
  }
  if (type === 'ntp' && !isSafeHost(target)) errors.push('NTP 目标必须是主机名或 IP');
  if (type === 'regex') {
    if (!target.startsWith('http://') && !target.startsWith('https://')) errors.push('正则目标必须以 http:// 或 https:// 开头');
    try {
      if (String(input.bodyPattern || '').trim()) new RegExp(String(input.bodyPattern).trim());
      else errors.push('正则检查必须填写表达式');
    } catch (error) {
      errors.push(`正则表达式无效：${error.message}`);
    }
  }

  const individualInterval = input.useGlobalInterval === true
    ? null
    : (Object.prototype.hasOwnProperty.call(input, 'intervalOverrideSeconds')
      ? input.intervalOverrideSeconds
      : (input.intervalSeconds ?? input.interval));
  const rawIndividualInterval = individualInterval == null || individualInterval === ''
    ? null
    : Number.parseInt(individualInterval, 10);
  const intervalOverrideSeconds = rawIndividualInterval == null || !Number.isFinite(rawIndividualInterval)
    ? null
    : clampInteger(individualInterval, 1, 86400, 1);
  const requestTimeoutMs = clampInteger(input.requestTimeoutMs ?? input.timeout ?? 8000, 500, 60000, 500);
  if (type === 'keyword' && !keyword) errors.push('关键字检查必须填写关键字');

  const monitor = {
    id: input.id || id(),
    name,
    type,
    target,
    intervalOverrideSeconds,
    intervalSeconds: intervalOverrideSeconds ?? clampInteger(globalIntervalSeconds, GLOBAL_INTERVAL_MIN, GLOBAL_INTERVAL_MAX, 60),
    requestTimeoutMs,
    active: input.active === undefined ? true : input.active !== 'false' && input.active !== '0' && Boolean(input.active),
    createdAt: input.createdAt || nowIso(),
    lastRunAt: input.lastRunAt || null
  };
  if (['http', 'keyword', 'http_json', 'regex'].includes(type) || HEALTH_HTTP_TYPES.has(type)) {
    monitor.expectedStatus = clampInteger(input.expectedStatus || 200, 100, 599, 200);
  }
  if (type === 'keyword') monitor.keyword = keyword;
  if (type === 'http_json') {
    monitor.jsonPath = jsonPath;
    monitor.expectedValue = expectedValue;
  }
  if (type === 'regex') monitor.bodyPattern = bodyPattern;
  if (type === 'dns') {
    monitor.dnsRecordType = dnsRecordType;
    monitor.expectedValue = expectedValue;
  }
  if (type === 'whois') monitor.expectedValue = expectedValue;
  if (type === 'ssl') monitor.sslWarnDays = sslWarnDays;
  if (type === 'snmp') monitor.snmpCommunity = snmpCommunity;

  return {
    valid: errors.length === 0,
    errors,
    monitor
  };
}

function normalizeSettings(input = {}) {
  const globalIntervalSeconds = clampInteger(
    input.globalIntervalSeconds ?? input.intervalSeconds ?? 60,
    GLOBAL_INTERVAL_MIN,
    GLOBAL_INTERVAL_MAX,
    60
  );
  return { globalIntervalSeconds };
}

function individualIntervalOverride(monitor = {}) {
  if (Object.prototype.hasOwnProperty.call(monitor, 'intervalOverrideSeconds')) {
    return monitor.intervalOverrideSeconds == null
      ? null
      : clampInteger(monitor.intervalOverrideSeconds, GLOBAL_INTERVAL_MIN, GLOBAL_INTERVAL_MAX, null);
  }
  return monitor.intervalSeconds == null
    ? null
    : clampInteger(monitor.intervalSeconds, GLOBAL_INTERVAL_MIN, GLOBAL_INTERVAL_MAX, null);
}

function effectiveInterval(monitor, settings = {}) {
  return individualIntervalOverride(monitor)
    ?? normalizeSettings(settings).globalIntervalSeconds;
}

function isSafeHost(value) {
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(value) && !value.includes('..');
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function heartbeatIsUp(beat) {
  return beat && Number(beat.status) >= 1;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function windowUptime(heartbeats, sinceMs, currentTime = Date.now()) {
  const relevant = heartbeats.filter((beat) => {
    const timestamp = Date.parse(beat.time);
    return Number.isFinite(timestamp) && timestamp >= currentTime - sinceMs;
  });
  if (!relevant.length) return null;
  const up = relevant.filter(heartbeatIsUp).length;
  return {
    samples: relevant.length,
    uptimeRatio: up / relevant.length,
    averageResponseMs: average(relevant.map((beat) => beat.responseTime)),
    p95ResponseMs: percentile(relevant.map((beat) => beat.responseTime), 0.95)
  };
}

function average(values) {
  const usable = values.filter((value) => Number.isFinite(value));
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function summarize(monitor, heartbeats, currentTime = Date.now(), globalIntervalSeconds = 60) {
  const sorted = [...heartbeats].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const latest = sorted[sorted.length - 1] || null;
  const day = windowUptime(sorted, 24 * 60 * 60 * 1000, currentTime);
  const week = windowUptime(sorted, 7 * 24 * 60 * 60 * 1000, currentTime);
  const bars = sorted.slice(-40).map((beat) => ({
    time: beat.time,
    status: heartbeatIsUp(beat) ? 'up' : 'down',
    responseTime: beat.responseTime ?? null
  }));
  const intervalOverrideSeconds = individualIntervalOverride(monitor);
  return {
    monitorId: monitor.id,
    name: monitor.name,
    type: monitor.type,
    target: monitor.target,
    active: monitor.active,
    intervalOverrideSeconds,
    followsGlobalInterval: intervalOverrideSeconds == null,
    intervalSeconds: intervalOverrideSeconds ?? globalIntervalSeconds,
    status: !monitor.active ? 'paused' : latest ? (heartbeatIsUp(latest) ? 'up' : 'down') : 'unknown',
    message: latest?.message || '',
    latestResponseTime: latest?.responseTime ?? null,
    lastCheckedAt: latest?.time || null,
    expectedStatus: monitor.expectedStatus ?? null,
    keyword: monitor.keyword || '',
    jsonPath: monitor.jsonPath || '',
    bodyPattern: monitor.bodyPattern || '',
    dnsRecordType: monitor.dnsRecordType || null,
    expectedValue: monitor.expectedValue || '',
    sslWarnDays: monitor.sslWarnDays ?? null,
    day24h: day,
    day7d: week,
    bars
  };
}

function deriveEvents(previousBeat, nextBeat, monitor) {
  const previousUp = previousBeat ? heartbeatIsUp(previousBeat) : null;
  const nextUp = heartbeatIsUp(nextBeat);
  if (previousUp === null || previousUp === nextUp) return [];
  return [{
    id: id(),
    monitorId: monitor.id,
    monitorName: monitor.name,
    time: nextBeat.time,
    kind: nextUp ? 'recovered' : 'incident',
    message: nextUp
      ? `${monitor.name} 已恢复`
      : `${monitor.name} 异常：${nextBeat.message || '连接失败'}`
  }];
}

function deriveHistoryEvents(previousBeat, nextBeat, monitor) {
  if (!previousBeat) {
    return heartbeatIsUp(nextBeat) ? [] : [{
      id: id(),
      monitorId: monitor.id,
      monitorName: monitor.name,
      time: nextBeat.time,
      kind: 'incident',
      message: `${monitor.name} 异常：${nextBeat.message || '连接失败'}`
    }];
  }
  return deriveEvents(previousBeat, nextBeat, monitor);
}

function normalizeImportRow(row) {
  const statusText = String(row.status ?? row.state ?? '').toLowerCase();
  const numericStatus = Number(row.status);
  const isUp = ['1', '2', 'up', 'online', 'ok', 'true'].includes(statusText)
    || (Number.isFinite(numericStatus) && ((numericStatus >= 100 && numericStatus < 400) || numericStatus === 1 || numericStatus === 2));
  const rawTime = row.timestamp || row.time || row.createdAt;
  const parsedTime = new Date(rawTime);
  const validTime = Boolean(rawTime) && !Number.isNaN(parsedTime.getTime());
  const responseTime = Number(row.responseTime ?? row.duration ?? row.ms ?? 0);
  const name = String(row.monitorName || row.name || row.target || '').trim();
  const type = String(row.type || 'http').toLowerCase();
  const keyword = String(row.keyword || '').trim();
  const dnsRecordType = String(row.dnsRecordType || 'A').toUpperCase();
  const expectedValue = String(row.expectedValue || '').trim();
  const jsonPath = String(row.jsonPath || '').trim();
  const bodyPattern = String(row.bodyPattern || '').trim();
  const sslWarnDays = row.sslWarnDays;
  const snmpCommunity = String(row.snmpCommunity || 'public').trim() || 'public';
  const target = String(row.target || ((type !== 'tcp' && /^https?:\/\//i.test(name)) ? name : '')).trim();
  const reasons = [];
  if (!name) reasons.push('缺少 monitorName/name');
  if (!target) reasons.push('缺少 target');
  if (!validTime) reasons.push('时间无效');
  if (type === 'keyword' && !keyword) reasons.push('关键字检查缺少 keyword');
  if (type === 'regex' && !bodyPattern) reasons.push('正则检查缺少 bodyPattern');
  return {
    valid: reasons.length === 0,
    reason: reasons.join('；'),
    monitor: { name, type, target, keyword, jsonPath, bodyPattern, dnsRecordType, expectedValue, sslWarnDays, snmpCommunity },
    heartbeat: {
      time: validTime ? parsedTime.toISOString() : null,
      status: isUp ? 1 : 0,
      responseTime: Number.isFinite(responseTime) ? Math.max(0, responseTime) : 0,
      message: String(row.message || row.error || '')
    }
  };
}

module.exports = {
  average,
  clampInteger,
  deriveEvents,
  deriveHistoryEvents,
  effectiveInterval,
  heartbeatIsUp,
  id,
  individualIntervalOverride,
  DNS_RECORD_TYPES,
  HEALTH_HTTP_TYPES,
  MONITOR_TYPE_GROUPS,
  MONITOR_TYPES,
  normalizeSettings,
  normalizeImportRow,
  normalizeMonitor,
  nowIso,
  percentile,
  summarize,
  windowUptime
};


