const { execFile } = require('child_process');
const crypto = require('crypto');
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const tls = require('tls');
const { URL } = require('url');
const dns = require('dns').promises;

function parseEndpoint(target, defaultPort) {
  try {
    const parsed = new URL(/^https?:\/\//i.test(target) ? target : `endpoint://${target}`);
    return {
      host: parsed.hostname,
      port: Number(parsed.port || (/^https:/i.test(parsed.protocol) ? 443 : defaultPort))
    };
  } catch {
    const separator = target.lastIndexOf(':');
    if (separator < 0) return { host: target, port: defaultPort };
    return {
      host: target.slice(0, separator),
      port: Number(target.slice(separator + 1) || defaultPort)
    };
  }
}

function checkTcp(target, timeoutMs) {
  return socketProbe({
    target,
    timeoutMs,
    validate: () => undefined,
    connectedMessage: (endpoint) => `TCP ${endpoint.host}:${endpoint.port} 可连接`
  });
}

function socketProbe(options) {
  const {
    target,
    defaultPort = 80,
    secure = false,
    payload = null,
    validate = () => undefined,
    connectedMessage = null,
    timeoutMs = 8000
  } = options;

  return new Promise((resolve) => {
    const endpoint = parseEndpoint(target, defaultPort);
    if (!endpoint.host || !Number.isInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535) {
      resolve({ status: 0, responseTime: 0, message: `无效的 host:port：${target}` });
      return;
    }

    const started = Date.now();
    let finished = false;
    let buffer = Buffer.alloc(0);
    const finish = (status, message) => {
      if (finished) return;
      finished = true;
      const responseTime = Date.now() - started;
      socket?.destroy();
      resolve({ status, responseTime, message });
    };

    const connectionOptions = { host: endpoint.host, port: endpoint.port };
    const socket = secure
      ? tls.connect({ ...connectionOptions, servername: net.isIP(endpoint.host) ? undefined : endpoint.host, rejectUnauthorized: true })
      : net.createConnection(connectionOptions);
    socket.setTimeout(timeoutMs);

    const readyEvent = secure ? 'secureConnect' : 'connect';
    socket.once(readyEvent, () => {
      if (payload) {
        socket.write(payload);
        inspect();
      } else {
        inspect();
        if (!finished && connectedMessage) finish(1, connectedMessage(endpoint));
      }
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 1024 * 1024) finish(0, '服务响应超过 1MB');
      else inspect();
    });
    socket.once('timeout', () => finish(0, `连接或响应超时 ${timeoutMs}ms`));
    socket.once('error', (error) => finish(0, error.message));

    function inspect() {
      if (typeof validate !== 'function') return;
      try {
        const result = validate(buffer, endpoint);
        if (result) finish(result.status, result.message);
      } catch (error) {
        finish(0, error.message);
      }
    }
  });
}

function checkBanner(target, timeoutMs, prefix, label, defaultPort) {
  return socketProbe({
    target,
    defaultPort,
    timeoutMs,
    validate: bannerValidator(prefix, label)
  });
}

function checkSecureBanner(target, timeoutMs, prefix, label, defaultPort) {
  return socketProbe({
    target,
    defaultPort,
    timeoutMs,
    secure: true,
    validate: bannerValidator(prefix, label)
  });
}

function bannerValidator(prefix, label) {
  return (buffer) => {
    const text = buffer.toString('utf8').trimStart();
    if (!text) return null;
    return text.toUpperCase().startsWith(prefix.toUpperCase())
      ? { status: 1, message: `${label} 握手正常` }
      : { status: 0, message: `${label} 响应异常：${text.slice(0, 80)}` };
  };
}

const HEALTH_ENDPOINTS = {
  prometheus: { port: 9090, path: '/-/healthy', validateText: (body) => /prometheus/i.test(body), label: 'Prometheus healthy' },
  grafana: { port: 3000, path: '/api/health', validateJson: (data) => data?.database === 'ok', label: 'Grafana health' },
  elasticsearch: { port: 9200, path: '/', acceptedStatuses: [200, 401], label: 'Elasticsearch API' },
  influxdb: { port: 8086, path: '/health', validateJson: (data) => ['pass', 'ok'].includes(String(data?.status || data?.health).toLowerCase()), label: 'InfluxDB health' },
  etcd: { port: 2379, path: '/health', validateJson: (data) => ['true', true].includes(data?.health ?? data?.healthStatus), label: 'etcd health' },
  consul: { port: 8500, path: '/v1/status/leader', validateJson: (data) => typeof data === 'string' && data.length > 0, label: 'Consul API' },
  rabbitmq_management: { port: 15672, path: '/api/overview', acceptedStatuses: [200, 401], label: 'RabbitMQ Management API' },
  docker_registry: { port: 5000, path: '/v2/', acceptedStatuses: [200, 401], label: 'Docker Registry V2' },
  minio: { port: 9000, path: '/minio/health/live', label: 'MinIO live probe' },
  clickhouse: { port: 8123, path: '/ping', validateText: (body) => /^Ok\.?\s*$/i.test(body.trim()), label: 'ClickHouse HTTP ping' },
  couchdb: { port: 5984, path: '/', acceptedStatuses: [200, 401], validateOptionalJson: true, label: 'CouchDB API' },
  traefik: { port: 8080, path: '/ping', validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'Traefik ping' },
  nacos: { port: 8848, path: '/nacos/actuator/health', validateText: (body) => /up/i.test(body), label: 'Nacos health' },
  docker_engine: { port: 2375, path: '/_ping', validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'Docker Engine ping' },
  kubernetes: { port: 6443, path: '/readyz', secure: true, acceptedStatuses: [200, 401, 403], label: 'Kubernetes readyz' },
  nomad: { port: 4646, path: '/v1/status/leader', validateJson: (data) => typeof data === 'string' && data.length > 0, label: 'Nomad API' },
  vault: { port: 8200, path: '/v1/sys/health', acceptedStatuses: [200, 429, 472, 473], validateJson: (data) => data?.initialized === true && data?.sealed === false, label: 'Vault health' },
  harbor: {
    port: 80,
    path: '/api/v2.0/health',
    validateJson: (data) => data?.healthy === true || String(data?.status).toLowerCase() === 'healthy',
    label: 'Harbor health'
  },
  portainer: { port: 9000, path: '/api/status', validateOptionalJson: true, label: 'Portainer API' },
  jenkins: { port: 8080, path: '/login', acceptedStatuses: [200, 403], label: 'Jenkins UI' },
  gitlab: { port: 80, path: '/users/sign_in', acceptedStatuses: [200, 401, 403], label: 'GitLab web' },
  gitea: { port: 3000, path: '/api/health', validateJson: (data) => ['pass', 'ok'].includes(String(data?.status).toLowerCase()), label: 'Gitea health' },
  forgejo: { port: 3000, path: '/api/health', validateJson: (data) => ['pass', 'ok'].includes(String(data?.status).toLowerCase()), label: 'Forgejo health' },
  argocd: { port: 443, path: '/healthz', secure: true, validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'Argo CD healthz' },
  drone: { port: 80, path: '/healthz', label: 'Drone healthz' },
  woodpecker: { port: 8000, path: '/healthz', label: 'Woodpecker healthz' },
  sonarqube: { port: 9000, path: '/api/system/status', validateJson: (data) => String(data?.status).toUpperCase() === 'UP', label: 'SonarQube status' },
  nexus: { port: 8081, path: '/service/rest/v1/status/writable', acceptedStatuses: [200, 401], label: 'Nexus writable status' },
  artifactory: { port: 8082, path: '/artifactory/api/system/ping', acceptedStatuses: [200, 401], validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'Artifactory ping' },
  keycloak: { port: 9000, path: '/health/ready', validateJson: (data) => data?.status === 'UP', label: 'Keycloak readiness' },
  authentik: { port: 9000, path: '/api/v3/root/config/', acceptedStatuses: [200, 401, 403], validateOptionalJson: true, label: 'authentik API' },
  authelia: { port: 9091, path: '/api/health', validateJson: (data) => String(data?.status).toLowerCase() === 'ok', label: 'Authelia health' },
  nextcloud: { port: 80, path: '/status.php', validateJson: (data) => data?.installed !== false && Boolean(data?.version), label: 'Nextcloud status.php' },
  jellyfin: { port: 8096, path: '/System/Info/Public', validateJson: (data) => Boolean(data?.ProductName || data?.Version), label: 'Jellyfin public info' },
  plex: { port: 32400, path: '/identity', acceptedStatuses: [200, 401], validateText: (body) => /MediaContainer/i.test(body), label: 'Plex identity' },
  immich: { port: 2283, path: '/api/server/ping', validateText: (body) => /pong/i.test(body), label: 'Immich ping' },
  home_assistant: { port: 8123, path: '/api/', acceptedStatuses: [200, 401], label: 'Home Assistant API' },
  node_red: { port: 1880, path: '/', label: 'Node-RED editor' },
  netdata: { port: 19999, path: '/api/v1/info', validateJson: (data) => Boolean(data?.version), label: 'Netdata info' },
  proxmox: { port: 8006, path: '/api2/json/access/version', secure: true, acceptedStatuses: [200, 401, 403], validateOptionalJson: true, label: 'Proxmox API' },
  envoy: { port: 9901, path: '/ready', validateText: (body) => /LIVE/i.test(body), label: 'Envoy admin readiness' },
  airflow: {
    port: 8080,
    path: '/health',
    validateJson: (data) => data?.metadatabase?.status === 'healthy' && data?.scheduler?.status === 'healthy',
    label: 'Airflow health'
  },
  superset: { port: 8088, path: '/health', validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'Superset health' },
  metabase: { port: 3000, path: '/api/health', validateJson: (data) => String(data?.status).toLowerCase() === 'ok', label: 'Metabase health' },
  redash: { port: 5000, path: '/ping', validateText: (body) => /PONG/i.test(body), label: 'Redash ping' },
  mattermost: { port: 8065, path: '/api/v4/system/ping', validateOptionalJson: true, label: 'Mattermost ping' },
  matrix_synapse: { port: 8008, path: '/_matrix/client/versions', validateJson: (data) => Array.isArray(data?.versions), label: 'Synapse versions' },
  ghost: { port: 2368, path: '/ghost/api/admin/site/', acceptedStatuses: [200, 401], validateOptionalJson: true, label: 'Ghost Admin API' },
  alertmanager: { port: 9093, path: '/-/healthy', validateText: (body) => /alertmanager/i.test(body), label: 'Alertmanager healthy' },
  victoriametrics: { port: 8428, path: '/health', validateText: (body) => /^OK\s*$/i.test(body.trim()), label: 'VictoriaMetrics health' },
  loki: { port: 3100, path: '/ready', validateText: (body) => /ready/i.test(body), label: 'Loki readiness' },
  prometheus_pushgateway: { port: 9091, path: '/-/healthy', validateText: (body) => /pushgateway/i.test(body), label: 'Pushgateway healthy' },
  thanos_query: { port: 9090, path: '/-/healthy', validateText: (body) => /thanos/i.test(body), label: 'Thanos Query healthy' },
  zipkin: { port: 9411, path: '/health', label: 'Zipkin health' },
  jaeger_query: { port: 16686, path: '/', label: 'Jaeger Query UI' },
  opentelemetry_collector: { port: 13133, path: '/', label: 'OpenTelemetry Collector health' },
  ceph_rgw: { port: 7480, path: '/swift/healthcheck', acceptedStatuses: [200, 204], label: 'Ceph RGW healthcheck' }
};

function healthEndpointUrl(monitor, definition) {
  if (/^https?:\/\//i.test(monitor.target)) {
    const endpoint = new URL(monitor.target);
    if (endpoint.pathname === '/') endpoint.pathname = definition.path;
    return endpoint.href;
  }
  const endpoint = parseEndpoint(monitor.target, definition.port);
  return `${definition.secure ? 'https' : 'http'}://${endpoint.host}:${endpoint.port}${definition.path}`;
}

async function checkHealthEndpoint(monitor) {
  const started = Date.now();
  try {
    const definition = HEALTH_ENDPOINTS[monitor.type];
    const target = healthEndpointUrl(monitor, definition);
    const { response, body, responseTime } = await requestHttp({ ...monitor, target });
    const accepted = definition.acceptedStatuses || [200];
    if (!accepted.includes(response.status)) {
      return { status: 0, responseTime, message: `${definition.label} HTTP ${response.status}` };
    }
    if ([401, 403].includes(response.status)) {
      return { status: 1, responseTime, message: `${definition.label} 可达（HTTP ${response.status}，需要认证）` };
    }
    if (definition.validateText && !definition.validateText(body)) {
      return { status: 0, responseTime, message: `${definition.label} 响应内容无效` };
    }
    if (definition.validateJson) {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return { status: 0, responseTime, message: `${definition.label} 响应不是有效 JSON` };
      }
      if (!definition.validateJson(payload)) {
        return { status: 0, responseTime, message: `${definition.label} 健康状态异常` };
      }
    }
    if (definition.validateOptionalJson && body.trim().startsWith('{')) {
      try {
        JSON.parse(body);
      } catch {
        return { status: 0, responseTime, message: `${definition.label} 响应不是有效 JSON` };
      }
    }
    return { status: 1, responseTime, message: `${definition.label} HTTP ${response.status}` };
  } catch (error) {
    return { status: 0, responseTime: error.responseTime ?? Date.now() - started, message: error.message };
  }
}

function checkRedis(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 6379,
    timeoutMs,
    payload: '*1\r\n$4\r\nPING\r\n',
    validate: (buffer) => {
      const text = buffer.toString('utf8').trim();
      if (!text) return null;
      return /^\+PONG/i.test(text)
        ? { status: 1, message: 'Redis PONG' }
        : { status: 0, message: `Redis 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkMemcached(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 11211,
    timeoutMs,
    payload: 'stats\r\n',
    validate: (buffer) => {
      const text = buffer.toString('utf8').trim();
      if (!text) return null;
      return /^(STAT|END)/m.test(text)
        ? { status: 1, message: 'Memcached stats 正常' }
        : { status: 0, message: `Memcached 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkRedisTls(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 6379,
    timeoutMs,
    secure: true,
    payload: '*1\r\n$4\r\nPING\r\n',
    validate: (buffer) => {
      const text = buffer.toString('utf8').trim();
      if (!text) return null;
      return /^\+PONG/i.test(text)
        ? { status: 1, message: 'Redis TLS PONG' }
        : { status: 0, message: `Redis TLS 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkMysql(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 3306,
    timeoutMs,
    validate: (buffer) => {
      if (buffer.length < 5) return null;
      const length = buffer.readUIntLE(0, 3);
      const sequence = buffer[3];
      return length > 0 && sequence === 0
        ? { status: 1, message: `MySQL 初始握手正常（协议 ${buffer[4]}）` }
        : { status: 0, message: 'MySQL 初始握手包无效' };
    }
  });
}

function checkPostgres(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 5432,
    timeoutMs,
    payload: Buffer.from([0x00, 0x00, 0x00, 0x08, 0x04, 0xd2, 0x16, 0x2f]),
    validate: (buffer) => {
      if (!buffer.length) return null;
      const mode = String.fromCharCode(buffer[0]);
      return ['S', 'N'].includes(mode)
        ? { status: 1, message: mode === 'S' ? 'PostgreSQL 支持 SSL' : 'PostgreSQL 服务可达（未启用 SSL）' }
        : { status: 0, message: 'PostgreSQL SSLRequest 响应无效' };
    }
  });
}

function mqttRemainingLength(length) {
  const bytes = [];
  do {
    let byte = length % 128;
    length = Math.floor(length / 128);
    if (length > 0) byte |= 0x80;
    bytes.push(byte);
  } while (length > 0);
  return Buffer.from(bytes);
}

function checkMqtt(target, timeoutMs) {
  const clientId = `uptime-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const variableHeader = Buffer.from([
    0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0x02, 0x00, 0x3c
  ]);
  const clientPayload = Buffer.from([clientId.length >> 8, clientId.length & 0xff, ...Buffer.from(clientId)]);
  const remaining = variableHeader.length + clientPayload.length;
  const payload = Buffer.concat([Buffer.from([0x10]), mqttRemainingLength(remaining), variableHeader, clientPayload]);

  return socketProbe({
    target,
    defaultPort: 1883,
    timeoutMs,
    payload,
    validate: (buffer) => {
      if (buffer.length < 4) return null;
      if (buffer[0] !== 0x20 || buffer[1] !== 0x02) return { status: 0, message: 'MQTT CONNACK 报文无效' };
      const code = buffer[3];
      return code === 0
        ? { status: 1, message: 'MQTT CONNACK 已接受' }
        : { status: 0, message: `MQTT 连接被拒绝（代码 ${code}）` };
    }
  });
}

function checkAmqp(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 5672,
    timeoutMs,
    payload: Buffer.from([0x41, 0x4d, 0x51, 0x50, 0x00, 0x00, 0x09, 0x01]),
    validate: (buffer) => {
      if (buffer.length < 8) return null;
      const payloadSize = buffer.readUInt32BE(3);
      if (buffer[0] !== 0x01 || buffer.readUInt16BE(1) !== 0) {
        return { status: 0, message: 'AMQP 响应不是 Connection.Start 帧' };
      }
      if (buffer.length < payloadSize + 8) return null;
      if (payloadSize < 4 || buffer.readUInt16BE(7) !== 10 || buffer.readUInt16BE(9) !== 10) {
        return { status: 0, message: 'AMQP 方法不是 Connection.Start' };
      }
      return buffer[7 + payloadSize] === 0xce
        ? { status: 1, message: 'AMQP Connection.Start 正常' }
        : { status: 0, message: 'AMQP 帧结束标记无效' };
    }
  });
}

function kafkaRequest(apiKey, apiVersion) {
  const request = Buffer.alloc(10);
  request.writeInt16BE(apiKey, 0);
  request.writeInt16BE(apiVersion, 2);
  request.writeInt32BE(1, 4);
  request.writeInt16BE(-1, 8); // null client_id in Kafka request header v0

  // Kafka wraps every request in an outer int32 size prefix.
  const packet = Buffer.alloc(request.length + 4);
  packet.writeUInt32BE(request.length, 0);
  request.copy(packet, 4);
  return packet;
}

function checkKafka(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 9092,
    timeoutMs,
    payload: kafkaRequest(18, 0), // ApiVersions v0
    validate: (buffer) => {
      if (buffer.length < 14) return null;
      const errorCode = buffer.readInt16BE(8);
      if (errorCode === 35) return { status: 1, message: 'Kafka broker 可达（ApiVersions 版本被禁用）' };
      return errorCode === 0
        ? { status: 1, message: `Kafka ApiVersions 正常（${buffer.readInt32BE(10)} 个 API）` }
        : { status: 0, message: `Kafka ApiVersions 失败（代码 ${errorCode}）` };
    }
  });
}

function mongodbHelloPacket() {
  const document = Buffer.alloc(31);
  document.writeUInt32LE(document.length, 0);
  document[4] = 0x10; // BSON int32
  document.write('hello\0', 5);
  document.writeInt32LE(1, 11);
  document[15] = 0x02; // BSON string
  document.write('$db\0', 16);
  document.writeUInt32LE(6, 20);
  document.write('admin\0', 24);
  const request = Buffer.alloc(21 + document.length);
  request.writeUInt32LE(request.length, 0);
  request.writeInt32LE(1, 4);
  request.writeInt32LE(0, 8);
  request.writeInt32LE(2013, 12); // OP_MSG
  request.writeUInt32LE(0, 16);
  request[20] = 0; // body section
  document.copy(request, 21);
  return request;
}

function mongodbCommandOk(document) {
  const length = document.readInt32LE(0);
  if (length < 5 || length > document.length || document[length - 1] !== 0) return false;
  let cursor = 4;
  while (cursor < length - 1) {
    const type = document[cursor++];
    const keyEnd = document.indexOf(0, cursor);
    if (keyEnd < cursor || keyEnd >= length) return false;
    const key = document.toString('utf8', cursor, keyEnd);
    cursor = keyEnd + 1;
    if (key === 'ok') {
      if (type === 0x01) return document.readDoubleLE(cursor) === 1;
      if (type === 0x10) return document.readInt32LE(cursor) === 1;
      return false;
    }
    // Skip top-level fields; nested documents are length-prefixed BSON values.
    if ([0x01, 0x09, 0x11, 0x12].includes(type)) cursor += 8;
    else if (type === 0x02) cursor += 4 + document.readInt32LE(cursor);
    else if ([0x03, 0x04].includes(type)) cursor += document.readInt32LE(cursor);
    else if (type === 0x05) cursor += 5 + document.readInt32LE(cursor);
    else if (type === 0x07) cursor += 12;
    else if (type === 0x08) cursor += 1;
    else if (type === 0x10) cursor += 4;
    else if (type !== 0x0a) return false;
  }
  return false;
}

function checkMongodb(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 27017,
    timeoutMs,
    payload: mongodbHelloPacket(),
    validate: (buffer) => {
      if (buffer.length < 16) return null;
      const messageLength = buffer.readUInt32LE(0);
      if (messageLength < 26 || messageLength > 1024 * 1024) return { status: 0, message: 'MongoDB 消息长度无效' };
      if (buffer.length < messageLength) return null;
      const opcode = buffer.readInt32LE(12);
      if (opcode !== 2013) return { status: 0, message: `MongoDB 响应协议无效（opCode ${opcode}）` };
      if (buffer.readInt32LE(8) !== 1 || buffer[20] !== 0) return { status: 0, message: 'MongoDB 响应标识或正文无效' };
      return mongodbCommandOk(buffer.subarray(21, messageLength))
        ? { status: 1, message: 'MongoDB OP_MSG hello 正常' }
        : { status: 0, message: 'MongoDB hello 命令失败' };
    }
  });
}

function mssqlPreloginPacket() {
  const descriptors = [
    [0x00, 26, 6], // VERSION
    [0x01, 32, 1], // ENCRYPTION
    [0x02, 33, 1], // INSTOPT
    [0x03, 34, 4], // THREADID
    [0x04, 38, 1] // MARS
  ];
  const payloadLength = 39;
  const totalLength = 8 + payloadLength;
  const packet = Buffer.alloc(totalLength);
  packet[0] = 0x12;
  packet[1] = 0x01;
  packet.writeUInt16BE(packet.length, 2);
  packet[7] = 0;
  let cursor = 8;
  for (const [token, offset, length] of descriptors) {
    packet[cursor++] = token;
    packet.writeUInt16BE(offset, cursor); cursor += 2;
    packet.writeUInt16BE(length, cursor); cursor += 2;
  }
  packet[cursor++] = 0xff;
  const payloadStart = 8;
  packet.set([0x0f, 0x00, 0x00, 0x0f, 0x00, 0x00], payloadStart + 26);
  packet[payloadStart + 32] = 0x00; // encryption not supported
  packet[payloadStart + 33] = 0x00; // default instance
  packet.writeUInt32BE(0, payloadStart + 34);
  packet[payloadStart + 38] = 0x00; // MARS off
  return packet;
}

function checkMssql(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 1433,
    timeoutMs,
    payload: mssqlPreloginPacket(),
    validate: (buffer) => {
      if (buffer.length < 9) return null;
      return buffer[0] === 0x04
        ? { status: 1, message: 'MSSQL PRELOGIN 响应正常' }
        : { status: 0, message: `MSSQL 响应类型异常（0x${buffer[0].toString(16)}）` };
    }
  });
}

function berHeader(buffer, position) {
  if (position >= buffer.length) throw new Error('BER 数据不完整');
  const tag = buffer[position];
  let cursor = position + 1;
  let length = buffer[cursor++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (!count || cursor + count > buffer.length) throw new Error('BER 长度无效');
    length = 0;
    for (let index = 0; index < count; index += 1) length = length * 256 + buffer[cursor++];
  }
  if (cursor + length > buffer.length) throw new Error('BER 元素不完整');
  return { tag, valueStart: cursor, valueEnd: cursor + length };
}

function berSkip(buffer, position) {
  const element = berHeader(buffer, position);
  return element.valueEnd;
}

function berInteger(buffer, position) {
  const element = berHeader(buffer, position);
  if (element.tag !== 0x02 && element.tag !== 0x0a) throw new Error('BER 整数类型无效');
  let value = 0;
  for (let cursor = element.valueStart; cursor < element.valueEnd; cursor += 1) value = value * 256 + buffer[cursor];
  return { value, next: element.valueEnd };
}

function validateLdapBindResponse(buffer) {
  try {
    const root = berHeader(buffer, 0);
    if (root.tag !== 0x30 || !root.valueEnd) return null;
    const messageIdEnd = berSkip(buffer, root.valueStart);
    const bindResponse = berHeader(buffer, messageIdEnd);
    if (bindResponse.tag !== 0x61) return { status: 0, message: 'LDAP 响应不是 BindResponse' };
    const resultCode = berInteger(buffer, bindResponse.valueStart);
    return resultCode.value === 0
      ? { status: 1, message: 'LDAP 匿名绑定成功' }
      : { status: 0, message: `LDAP 绑定失败（结果码 ${resultCode.value}）` };
  } catch {
    return null;
  }
}

function checkLdap(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 389,
    timeoutMs,
    payload: Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x60, 0x07, 0x02, 0x01, 0x03, 0x04, 0x00, 0x80, 0x00]),
    validate: validateLdapBindResponse
  });
}

function checkLdaps(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 636,
    timeoutMs,
    secure: true,
    payload: Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x60, 0x07, 0x02, 0x01, 0x03, 0x04, 0x00, 0x80, 0x00]),
    validate: validateLdapBindResponse
  });
}

function checkSocks5(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 1080,
    timeoutMs,
    payload: Buffer.from([0x05, 0x01, 0x00]),
    validate: (buffer) => {
      if (buffer.length < 2) return null;
      if (buffer[0] !== 0x05) return { status: 0, message: 'SOCKS 协议版本不支持' };
      return buffer[1] === 0
        ? { status: 1, message: 'SOCKS5 无认证协商成功' }
        : { status: 0, message: `SOCKS5 方法被拒绝（代码 ${buffer[1]}）` };
    }
  });
}

function checkVnc(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 5900,
    timeoutMs,
    validate: (buffer) => {
      if (buffer.length < 12) return null;
      const banner = buffer.subarray(0, 12).toString('ascii');
      return /^RFB \d{3}\.\d{3}\n$/.test(banner)
        ? { status: 1, message: `VNC 握手正常（${banner.trim()}）` }
        : { status: 0, message: 'VNC RFB 横幅无效' };
    }
  });
}

function checkZookeeper(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 2181,
    timeoutMs,
    payload: Buffer.from('mntr\n', 'utf8'),
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      const version = text.match(/(?:^|\n)zk_version[\t =]+([^\r\n]+)/i);
      return version
        ? { status: 1, message: `ZooKeeper mntr 正常：${version[1].slice(0, 100)}` }
        : { status: 0, message: `ZooKeeper 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkBeanstalkd(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 11300,
    timeoutMs,
    payload: 'list-tubes\r\n',
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      return text.startsWith('OK ')
        ? { status: 1, message: 'Beanstalkd list-tubes 正常' }
        : { status: 0, message: `Beanstalkd 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkGearman(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 4730,
    timeoutMs,
    payload: 'version\r\n',
    validate: (buffer) => {
      const text = buffer.toString('utf8').trim();
      if (!text) return null;
      return /^VERSION\b/i.test(text)
        ? { status: 1, message: `Gearman 版本正常：${text.slice(0, 100)}` }
        : { status: 0, message: `Gearman 响应异常：${text.slice(0, 80)}` };
    }
  });
}

function checkNats(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 4222,
    timeoutMs,
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      if (!/^INFO\s+\{/i.test(text)) return { status: 0, message: 'NATS 响应不是 INFO' };
      try {
        const payload = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
        return { status: 1, message: `NATS INFO 正常：${payload.server_id || payload.server_name || 'server'}` };
      } catch {
        return { status: 0, message: 'NATS INFO JSON 无效' };
      }
    }
  });
}

function checkCassandra(target, timeoutMs) {
  const options = Buffer.from([0x04, 0x00, 0x00, 0x01, 0x05, 0x00, 0x00, 0x00, 0x00]);
  return socketProbe({
    target,
    defaultPort: 9042,
    timeoutMs,
    payload: options,
    validate: (buffer) => {
      if (buffer.length < 9) return null;
      if (buffer[0] !== 0x84) return { status: 0, message: `Cassandra 响应协议版本无效（${buffer[0]}）` };
      if (buffer[4] === 0x06) return { status: 1, message: 'Cassandra native protocol SUPPORTED' };
      return buffer[4] === 0x00
        ? { status: 0, message: 'Cassandra 返回 ERROR 帧' }
        : { status: 0, message: `Cassandra 响应 opcode 无效（${buffer[4]}）` };
    }
  });
}

function checkXmpp(target, timeoutMs) {
  const endpoint = parseEndpoint(target, 5222);
  const streamOpen = [
    "<?xml version='1.0'?>",
    `<stream:stream to='${endpoint.host}' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`
  ].join('');
  return socketProbe({
    target,
    defaultPort: 5222,
    timeoutMs,
    payload: Buffer.from(streamOpen, 'utf8'),
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      return /<stream:(stream|features)|id=/i.test(text)
        ? { status: 1, message: 'XMPP 流握手正常' }
        : { status: 0, message: `XMPP 响应无效：${text.slice(0, 80)}` };
    }
  });
}

function checkIrc(target, timeoutMs) {
  return socketProbe({
    target,
    defaultPort: 6667,
    timeoutMs,
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      return /(NOTICE AUTH|PING :|\S+\s+001\s)/i.test(text)
        ? { status: 1, message: 'IRC 服务响应正常' }
        : null;
    }
  });
}

function checkWhois(monitor) {
  const query = String(monitor.expectedValue || 'example.com').trim() || 'example.com';
  return socketProbe({
    target: monitor.target,
    defaultPort: 43,
    timeoutMs: monitor.requestTimeoutMs,
    payload: Buffer.from(`${query}\r\n`, 'utf8'),
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      return { status: 1, message: `WHOIS ${query} 查询响应正常` };
    }
  });
}

function checkWebsocket(target, timeoutMs) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(target);
      if (!['ws:', 'wss:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('bad URL');
    } catch {
      resolve({ status: 0, responseTime: 0, message: 'WebSocket 目标必须是 ws:// 或 wss:// URL' });
      return;
    }

    const started = Date.now();
    let finished = false;
    let buffer = Buffer.alloc(0);
    const finish = (status, message) => {
      if (finished) return;
      finished = true;
      socket?.destroy();
      resolve({ status, responseTime: Date.now() - started, message });
    };

    const key = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    const pathname = `${parsed.pathname || '/'}${parsed.search}`;
    const socket = parsed.protocol === 'wss:'
      ? tls.connect({ host: parsed.hostname, port: Number(parsed.port || 443), servername: parsed.hostname })
      : net.createConnection({ host: parsed.hostname, port: Number(parsed.port || 80) });

    socket.setTimeout(timeoutMs);
    const readyEvent = parsed.protocol === 'wss:' ? 'secureConnect' : 'connect';
    socket.once(readyEvent, () => {
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        `Host: ${parsed.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '',
        ''
      ].join('\r\n'));
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const text = buffer.slice(0, end).toString('utf8');
      const lines = text.split(/\r\n/);
      const headers = new Map(lines.slice(1).map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()];
      }));
      if (/^HTTP\/1\.1\s*101/.test(lines[0]) && headers.get('sec-websocket-accept') === expectedAccept) {
        finish(1, `WebSocket 升级成功 ${parsed.pathname || '/'}`);
      } else {
        finish(0, `WebSocket 升级失败：${lines[0].slice(0, 100)}`);
      }
    });
    socket.once('timeout', () => finish(0, `WebSocket 超时 ${timeoutMs}ms`));
    socket.once('error', (error) => finish(0, error.message));
  });
}

function checkNtp(target, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const packet = Buffer.alloc(48);
    packet[0] = 0x1b;
    const socket = dgram.createSocket('udp4');
    let finished = false;
    const finish = (status, message) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve({ status, responseTime: Date.now() - started, message });
    };
    const timer = setTimeout(() => finish(0, `NTP 超时 ${timeoutMs}ms`), timeoutMs);
    socket.once('error', (error) => finish(0, error.message));
    socket.on('message', (buffer) => {
      if (buffer.length < 48) return finish(0, 'NTP 响应包过短');
      const seconds = buffer.readUInt32BE(40);
      const timestamp = seconds * 1000 - 2208988800000;
      const date = new Date(timestamp);
      if (!Number.isFinite(date.getTime()) || Math.abs(date.getTime() - Date.now()) > 24 * 3600000) {
        finish(0, 'NTP 时间戳无效');
        return;
      }
      finish(1, `NTP 时间同步正常：${date.toISOString()}`);
    });
    const endpoint = parseEndpoint(target, 123);
    socket.send(packet, endpoint.port, endpoint.host, (error) => {
      if (error) finish(0, error.message);
    });
  });
}

function udpProbe(options) {
  const {
    target,
    defaultPort,
    payload,
    validate,
    label,
    timeoutMs = 8000,
    maxResponseBytes = 65535
  } = options;

  return new Promise((resolve) => {
    const endpoint = parseEndpoint(target, defaultPort);
    if (!endpoint.host || !Number.isInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535) {
      resolve({ status: 0, responseTime: 0, message: `无效的 UDP host:port：${target}` });
      return;
    }

    const started = Date.now();
    let finished = false;
    let response = Buffer.alloc(0);
    const socket = dgram.createSocket('udp4');
    const finish = (status, message) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      resolve({ status, responseTime: Date.now() - started, message });
    };
    const timer = setTimeout(() => finish(0, `${label} 超时 ${timeoutMs}ms`), timeoutMs);
    socket.on('error', (error) => finish(0, error.message));
    socket.on('message', (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (response.length > maxResponseBytes) return finish(0, 'UDP 响应过大');
      try {
        const result = validate(response);
        if (result) finish(result.status, result.message);
      } catch (error) {
        finish(0, error.message);
      }
    });
    socket.connect(endpoint.port, endpoint.host, (error) => {
      if (error) return finish(0, error.message);
      let requestPayload;
      try {
        requestPayload = typeof payload === 'function'
          ? payload({ endpoint, local: socket.address() })
          : payload;
      } catch (payloadError) {
        return finish(0, payloadError.message);
      }
      socket.send(requestPayload, (sendError) => {
        if (sendError) finish(0, sendError.message);
      });
    });
  });
}

function checkSip(target, timeoutMs) {
  const branch = `z9hG4bK-${crypto.randomUUID()}`;
  const callId = crypto.randomUUID();

  return udpProbe({
    target,
    defaultPort: 5060,
    payload: ({ endpoint, local }) => Buffer.from([
      `OPTIONS sip:${endpoint.host}:${endpoint.port} SIP/2.0`,
      `Via: SIP/2.0/UDP ${local.address}:${local.port};branch=${branch};rport`,
      'From: <sip:uptime-probe@localhost>;tag=uptime',
      `To: <sip:${endpoint.host}:${endpoint.port}>`,
      `Call-ID: ${callId}`,
      'CSeq: 1 OPTIONS',
      'Max-Forwards: 70',
      'Content-Length: 0',
      '',
      ''
    ].join('\r\n'), 'utf8'),
    label: 'SIP',
    timeoutMs,
    validate: (buffer) => {
      const text = buffer.toString('utf8');
      if (!text.trim()) return null;
      if (!/^SIP\/2\.0\s+\d{3}/m.test(text)) return { status: 0, message: 'SIP 响应无效' };
      const statusLine = text.split(/\r?\n/)[0].slice(0, 120);
      return { status: 1, message: `SIP 服务响应正常：${statusLine}` };
    }
  });
}

function berEncode(tag, content) {
  if (content.length < 128) {
    return Buffer.concat([Buffer.from([tag, content.length]), content]);
  }
  const lengthBytes = [];
  let length = content.length;
  while (length > 0) {
    lengthBytes.unshift(length & 0xff);
    length >>>= 8;
  }
  return Buffer.concat([Buffer.from([tag, 0x80 | lengthBytes.length]), ...lengthBytes.map((byte) => Buffer.from([byte])), content]);
}

function encodeSnmpInteger(value) {
  if (!value) return Buffer.from([0]);
  const bytes = [];
  let current = value;
  while (current > 0) {
    bytes.unshift(current & 0xff);
    current >>>= 8;
  }
  if (bytes[0] & 0x80) bytes.unshift(0);
  return Buffer.from(bytes);
}

function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    if (part < 128) {
      bytes.push(part);
      continue;
    }
    const group = [];
    let current = part;
    do {
      group.unshift(current & 0x7f);
      current >>>= 7;
    } while (current > 0);
    for (let index = 0; index < group.length - 1; index += 1) group[index] |= 0x80;
    bytes.push(...group);
  }
  return Buffer.from(bytes);
}

function snmpGetRequest(community) {
  const oid = encodeOid('1.3.6.1.2.1.1.1.0'); // sysDescr.0
  const variableBinding = berEncode(0x30, Buffer.concat([berEncode(0x06, oid), Buffer.from([0x05, 0x00])]));
  const variableBindings = berEncode(0x30, variableBinding);
  const pdu = berEncode(0xa0, Buffer.concat([
    berEncode(0x02, encodeSnmpInteger(Math.floor(Math.random() * 0x7fffffff))),
    berEncode(0x02, Buffer.from([0])),
    berEncode(0x02, Buffer.from([0])),
    variableBindings
  ]));
  return berEncode(0x30, Buffer.concat([
    berEncode(0x02, Buffer.from([1])),
    berEncode(0x04, Buffer.from(String(community || 'public'), 'utf8')),
    pdu
  ]));
}

function checkSnmp(monitor) {
  return udpProbe({
    target: monitor.target,
    defaultPort: 161,
    payload: snmpGetRequest(monitor.snmpCommunity),
    label: 'SNMP',
    timeoutMs: monitor.requestTimeoutMs,
    validate: (buffer) => {
      try {
        const message = berHeader(buffer, 0);
        if (message.tag !== 0x30 || !message.valueEnd) return null;
        let cursor = message.valueStart;
        const version = berInteger(buffer, cursor);
        cursor = version.next;
        const community = berHeader(buffer, cursor);
        cursor = community.valueEnd;
        const pdu = berHeader(buffer, cursor);
        if (pdu.tag !== 0xa2) return { status: 0, message: 'SNMP 响应不是 GetResponse' };
        cursor = pdu.valueStart;
        const requestId = berInteger(buffer, cursor);
        cursor = requestId.next;
        const errorStatus = berInteger(buffer, cursor);
        cursor = errorStatus.next;
        cursor = berSkip(buffer, cursor);
        const bindings = berHeader(buffer, cursor);
        const binding = berHeader(buffer, bindings.valueStart);
        if (binding.tag !== 0x30) throw new Error('SNMP varbind 无效');
        const oidEnd = berSkip(buffer, binding.valueStart);
        const value = berHeader(buffer, oidEnd);
        const description = value.tag === 0x04
          ? buffer.subarray(value.valueStart, value.valueEnd).toString('utf8')
          : '';
        if (errorStatus.value !== 0) {
          return { status: 0, message: `SNMP 查询失败（错误 ${errorStatus.value}）` };
        }
        return { status: 1, message: `SNMP 正常：${description.slice(0, 120)}` };
      } catch {
        return null;
      }
    }
  });
}

function readJsonPath(value, path) {
  const parts = String(path || '').split(/[.[\]]+/).filter(Boolean);
  return parts.reduce((current, part) => (current == null ? undefined : current[part]), value);
}

async function requestHttp(monitor) {
  const started = Date.now();
  try {
    const response = await fetch(monitor.target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(monitor.requestTimeoutMs),
      headers: { 'user-agent': 'HistoryUptime/0.1', accept: '*/*' },
      cache: 'no-store'
    });
    const body = await response.text();
    return { response, body, responseTime: Date.now() - started };
  } catch (error) {
    throw Object.assign(new Error(error.name === 'TimeoutError' ? `请求超时 ${monitor.requestTimeoutMs}ms` : error.message), {
      responseTime: Date.now() - started
    });
  }
}

async function checkHttp(monitor) {
  try {
    const { response, body, responseTime } = await requestHttp(monitor);
    const statusCode = response.status;
    if (statusCode !== monitor.expectedStatus) return { status: 0, responseTime, message: `HTTP ${statusCode}` };
    if (monitor.type === 'keyword' && !body.toLowerCase().includes(monitor.keyword.toLowerCase())) {
      return { status: 0, responseTime, message: `未找到关键字：${monitor.keyword}` };
    }
    if (monitor.type === 'regex' && !new RegExp(monitor.bodyPattern).test(body)) {
      return { status: 0, responseTime, message: `正文不匹配正则：${monitor.bodyPattern}` };
    }
    if (monitor.type === 'http_json') {
      let payload;
      try {
        payload = JSON.parse(body);
      } catch (error) {
        return { status: 0, responseTime, message: `响应不是有效 JSON：${error.message}` };
      }
      if (!monitor.jsonPath) return { status: 1, responseTime, message: `HTTP ${statusCode} JSON 有效` };
      const value = readJsonPath(payload, monitor.jsonPath);
      const actual = value === undefined || value === null ? '' : String(value);
      if (!monitor.expectedValue || actual.toLowerCase().includes(monitor.expectedValue.toLowerCase())) {
        return { status: 1, responseTime, message: `HTTP ${statusCode} ${monitor.jsonPath}=${actual.slice(0, 100) || 'null'}` };
      }
      return { status: 0, responseTime, message: `JSON 不匹配：${monitor.jsonPath}=${actual.slice(0, 100)}` };
    }
    return { status: 1, responseTime, message: `HTTP ${statusCode}` };
  } catch (error) {
    return { status: 0, responseTime: error.responseTime ?? 0, message: error.message };
  }
}

function checkPing(target, timeoutMs) {
  return new Promise((resolve) => {
    if (!target || !/^[a-z0-9][\w.:-]*$/i.test(target)) {
      resolve({ status: 0, responseTime: 0, message: '无效的主机名或 IP' });
      return;
    }

    const started = Date.now();
    const windows = os.platform() === 'win32';
    const args = windows
      ? ['-n', '1', '-w', String(Math.min(60000, timeoutMs)), target]
      : ['-c', '1', '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), target];
    execFile('ping', args, { timeout: timeoutMs + 1000, windowsHide: true }, (error, stdout) => {
      const responseTime = Date.now() - started;
      if (!error) {
        const match = String(stdout).match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i);
        resolve({
          status: 1,
          responseTime: match ? Math.round(Number(match[1])) : responseTime,
          message: `PING ${target} 正常`
        });
        return;
      }
      resolve({
        status: 0,
        responseTime,
        message: error.killed ? `PING 超时 ${timeoutMs}ms` : `PING 失败（exit ${error.code ?? 'unknown'}）`
      });
    });
  });
}

async function checkDns(monitor) {
  const started = Date.now();
  const resolver = new dns.Resolver({ timeout: monitor.requestTimeoutMs, tries: 1 });
  let timer;
  try {
    const lookup = resolver.resolve(monitor.target, monitor.dnsRecordType || 'A');
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`DNS 超时 ${monitor.requestTimeoutMs}ms`)), monitor.requestTimeoutMs);
    });
    let records = await Promise.race([lookup, timeout]);
    records = records.flat(Infinity).map((item) => String(item));
    const expected = String(monitor.expectedValue || '').trim().toLowerCase();
    if (expected && !records.some((record) => record.toLowerCase().includes(expected))) {
      return { status: 0, responseTime: Date.now() - started, message: `DNS 记录不匹配：${expected}` };
    }
    if (!records.length) {
      return { status: 0, responseTime: Date.now() - started, message: 'DNS 记录为空' };
    }
    return {
      status: 1,
      responseTime: Date.now() - started,
      message: `${monitor.dnsRecordType || 'A'} ${(records[0] || '').slice(0, 120)}`
    };
  } catch (error) {
    return { status: 0, responseTime: Date.now() - started, message: `DNS 失败：${error.message}` };
  } finally {
    clearTimeout(timer);
    resolver.cancel?.();
  }
}

function checkSsl(monitor) {
  return new Promise((resolve) => {
    const endpoint = parseEndpoint(monitor.target, 443);
    if (!endpoint.host || !Number.isInteger(endpoint.port) || endpoint.port <= 0 || endpoint.port > 65535) {
      resolve({ status: 0, responseTime: 0, message: '无效的 SSL host:port' });
      return;
    }

    const started = Date.now();
    let finished = false;
    const socket = tls.connect({
      host: endpoint.host,
      port: endpoint.port,
      servername: net.isIP(endpoint.host) ? undefined : endpoint.host,
      rejectUnauthorized: true
    });
    const finish = (status, message) => {
      if (finished) return;
      finished = true;
      const responseTime = Date.now() - started;
      socket.destroy();
      resolve({ status, responseTime, message });
    };

    socket.setTimeout(monitor.requestTimeoutMs);
    socket.once('timeout', () => finish(0, `SSL 超时 ${monitor.requestTimeoutMs}ms`));
    socket.once('error', (error) => finish(0, error.message));
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      const expiresAt = Date.parse(certificate?.valid_to || '');
      if (!certificate || !Object.keys(certificate).length || !Number.isFinite(expiresAt)) {
        finish(0, '未获取到有效证书');
        return;
      }
      const remainingDays = Math.floor((expiresAt - Date.now()) / 86400000);
      const warnDays = Number.isFinite(Number(monitor.sslWarnDays)) ? Number(monitor.sslWarnDays) : 30;
      if (remainingDays < 0) {
        finish(0, `证书已于 ${Math.abs(remainingDays)} 天前过期`);
        return;
      }
      if (remainingDays < warnDays) {
        finish(0, `证书剩余 ${remainingDays} 天，低于阈值 ${warnDays} 天`);
        return;
      }
      finish(1, `证书有效，剩余 ${remainingDays} 天`);
    });
  });
}

const PROTOCOL_CHECKERS = {
  tcp: (monitor) => checkTcp(monitor.target, monitor.requestTimeoutMs),
  ping: (monitor) => checkPing(monitor.target, monitor.requestTimeoutMs),
  dns: checkDns,
  ssl: checkSsl,
  websocket: (monitor) => checkWebsocket(monitor.target, monitor.requestTimeoutMs),
  redis: (monitor) => checkRedis(monitor.target, monitor.requestTimeoutMs),
  redis_tls: (monitor) => checkRedisTls(monitor.target, monitor.requestTimeoutMs),
  memcached: (monitor) => checkMemcached(monitor.target, monitor.requestTimeoutMs),
  mysql: (monitor) => checkMysql(monitor.target, monitor.requestTimeoutMs),
  postgres: (monitor) => checkPostgres(monitor.target, monitor.requestTimeoutMs),
  mqtt: (monitor) => checkMqtt(monitor.target, monitor.requestTimeoutMs),
  amqp: (monitor) => checkAmqp(monitor.target, monitor.requestTimeoutMs),
  kafka: (monitor) => checkKafka(monitor.target, monitor.requestTimeoutMs),
  mongodb: (monitor) => checkMongodb(monitor.target, monitor.requestTimeoutMs),
  mssql: (monitor) => checkMssql(monitor.target, monitor.requestTimeoutMs),
  ldap: (monitor) => checkLdap(monitor.target, monitor.requestTimeoutMs),
  ldaps: (monitor) => checkLdaps(monitor.target, monitor.requestTimeoutMs),
  socks5: (monitor) => checkSocks5(monitor.target, monitor.requestTimeoutMs),
  vnc: (monitor) => checkVnc(monitor.target, monitor.requestTimeoutMs),
  zookeeper: (monitor) => checkZookeeper(monitor.target, monitor.requestTimeoutMs),
  beanstalkd: (monitor) => checkBeanstalkd(monitor.target, monitor.requestTimeoutMs),
  gearman: (monitor) => checkGearman(monitor.target, monitor.requestTimeoutMs),
  nats: (monitor) => checkNats(monitor.target, monitor.requestTimeoutMs),
  cassandra: (monitor) => checkCassandra(monitor.target, monitor.requestTimeoutMs),
  xmpp: (monitor) => checkXmpp(monitor.target, monitor.requestTimeoutMs),
  irc: (monitor) => checkIrc(monitor.target, monitor.requestTimeoutMs),
  whois: checkWhois,
  smtp: (monitor) => checkBanner(monitor.target, monitor.requestTimeoutMs, '220', 'SMTP', 25),
  smtps: (monitor) => checkSecureBanner(monitor.target, monitor.requestTimeoutMs, '220', 'SMTPS', 465),
  ssh: (monitor) => checkBanner(monitor.target, monitor.requestTimeoutMs, 'SSH-', 'SSH', 22),
  ftp: (monitor) => checkBanner(monitor.target, monitor.requestTimeoutMs, '220', 'FTP', 21),
  ftps: (monitor) => checkSecureBanner(monitor.target, monitor.requestTimeoutMs, '220', 'FTPS', 990),
  imap: (monitor) => checkBanner(monitor.target, monitor.requestTimeoutMs, '* OK', 'IMAP', 143),
  imaps: (monitor) => checkSecureBanner(monitor.target, monitor.requestTimeoutMs, '* OK', 'IMAPS', 993),
  pop3: (monitor) => checkBanner(monitor.target, monitor.requestTimeoutMs, '+OK', 'POP3', 110),
  pop3s: (monitor) => checkSecureBanner(monitor.target, monitor.requestTimeoutMs, '+OK', 'POP3S', 995),
  ntp: (monitor) => checkNtp(monitor.target, monitor.requestTimeoutMs),
  sip: (monitor) => checkSip(monitor.target, monitor.requestTimeoutMs),
  snmp: checkSnmp
};

async function runCheck(monitor) {
  if (HEALTH_ENDPOINTS[monitor.type]) return checkHealthEndpoint(monitor);
  if (PROTOCOL_CHECKERS[monitor.type]) return PROTOCOL_CHECKERS[monitor.type](monitor);
  return checkHttp(monitor);
}

module.exports = {
  healthEndpointUrl,
  HEALTH_ENDPOINTS,
  PROTOCOL_CHECKERS,
  checkAmqp,
  checkBanner,
  checkDns,
  checkHttp,
  checkJsonPath: readJsonPath,
  checkKafka,
  checkLdap,
  checkMemcached,
  checkMongodb,
  checkMqtt,
  checkMysql,
  checkNtp,
  checkPing,
  checkPostgres,
  checkRedis,
  checkSip,
  checkSsl,
  checkSocks5,
  checkTcp,
  checkVnc,
  checkWebsocket,
  checkZookeeper,
  parseEndpoint,
  runCheck
};
