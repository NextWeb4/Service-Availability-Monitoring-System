const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { runCheck, healthEndpointUrl, HEALTH_ENDPOINTS } = require('../lib/checker');

const examples = [
  ['prometheus', '/-/healthy', 'Prometheus Server is Healthy.'],
  ['grafana', '/api/health', { database: 'ok' }],
  ['elasticsearch', '/', { cluster_name: 'test' }],
  ['influxdb', '/health', { status: 'pass' }],
  ['etcd', '/health', { health: 'true' }],
  ['consul', '/v1/status/leader', '"127.0.0.1:8300"'],
  ['rabbitmq_management', '/api/overview', { rabbitmq_version: '4.0' }],
  ['docker_registry', '/v2/', {}],
  ['minio', '/minio/health/live', ''],
  ['clickhouse', '/ping', 'Ok.\n'],
  ['couchdb', '/', { couchdb: 'Welcome' }],
  ['traefik', '/ping', 'OK'],
  ['nacos', '/nacos/actuator/health', '{"status":"UP"}'],
  ['docker_engine', '/_ping', 'OK'],
  ['kubernetes', '/readyz', 'ok'],
  ['nomad', '/v1/status/leader', '"127.0.0.1:4647"'],
  ['vault', '/v1/sys/health', { initialized: true, sealed: false }],
  ['harbor', '/api/v2.0/health', { status: 'healthy' }],
  ['portainer', '/api/status', { Version: '2.0' }],
  ['jenkins', '/login', '<html>Jenkins</html>'],
  ['gitlab', '/users/sign_in', '<html>GitLab</html>'],
  ['gitea', '/api/health', { status: 'pass' }],
  ['forgejo', '/api/health', { status: 'pass' }],
  ['argocd', '/healthz', 'OK'],
  ['drone', '/healthz', ''],
  ['woodpecker', '/healthz', ''],
  ['sonarqube', '/api/system/status', { status: 'UP' }],
  ['nexus', '/service/rest/v1/status/writable', ''],
  ['artifactory', '/artifactory/api/system/ping', 'OK'],
  ['keycloak', '/health/ready', { status: 'UP' }],
  ['authentik', '/api/v3/root/config/', {}],
  ['authelia', '/api/health', { status: 'OK' }],
  ['nextcloud', '/status.php', { installed: true, version: '30.0.1' }],
  ['jellyfin', '/System/Info/Public', { ProductName: 'Jellyfin', Version: '10.0' }],
  ['plex', '/identity', '<MediaContainer machineIdentifier="test"/>'],
  ['immich', '/api/server/ping', { res: 'pong' }],
  ['home_assistant', '/api/', { message: 'API running.' }],
  ['node_red', '/', '<html>Node-RED</html>'],
  ['netdata', '/api/v1/info', { version: '2.0' }],
  ['proxmox', '/api2/json/access/version', { data: { version: '8.0' } }],
  ['envoy', '/ready', 'LIVE\n'],
  ['airflow', '/health', { metadatabase: { status: 'healthy' }, scheduler: { status: 'healthy' } }],
  ['superset', '/health', 'OK'],
  ['metabase', '/api/health', { status: 'ok' }],
  ['redash', '/ping', 'PONG.'],
  ['mattermost', '/api/v4/system/ping', { status: 'OK' }],
  ['matrix_synapse', '/_matrix/client/versions', { versions: ['v1.1'] }],
  ['ghost', '/ghost/api/admin/site/', { site: { title: 'Test' } }],
  ['alertmanager', '/-/healthy', 'OK Alertmanager'],
  ['victoriametrics', '/health', 'OK'],
  ['loki', '/ready', 'ready'],
  ['prometheus_pushgateway', '/-/healthy', 'OK Pushgateway'],
  ['thanos_query', '/-/healthy', 'OK Thanos'],
  ['zipkin', '/health', { status: 'UP' }],
  ['jaeger_query', '/', '<html>Jaeger UI</html>'],
  ['opentelemetry_collector', '/', { status: 'Server available' }],
  ['ceph_rgw', '/swift/healthcheck', 'OK']
];

test('all 57 HTTP service probes request the expected path and accept healthy responses', async () => {
  assert.deepEqual(examples.map(([type]) => type).sort(), Object.keys(HEALTH_ENDPOINTS).sort());
  let active;
  let receivedPath;
  const upstream = http.createServer((request, response) => {
    receivedPath = request.url;
    response.writeHead(active.status || 200, { 'content-type': 'application/json' });
    response.end(typeof active.body === 'string' ? active.body : JSON.stringify(active.body));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const target = `http://127.0.0.1:${upstream.address().port}`;
  try {
    for (const [type, pathname, body] of examples) {
      active = { body };
      const result = await runCheck({ type, target, requestTimeoutMs: 1000 });
      assert.equal(receivedPath, pathname, type);
      assert.equal(result.status, 1, `${type}: ${result.message}`);
      active = { body: 'Unavailable', status: 503 };
      const failed = await runCheck({ type, target, requestTimeoutMs: 1000 });
      assert.equal(failed.status, 0, `${type} must reject HTTP 503`);
    }
    const unhealthy = [
      ['vault', { initialized: true, sealed: true }],
      ['airflow', { metadatabase: { status: 'healthy' }, scheduler: { status: 'unhealthy' } }],
      ['consul', '""'], ['nomad', '""'],
      ['grafana', { database: 'error' }], ['keycloak', { status: 'DOWN' }]
    ];
    for (const [type, body] of unhealthy) {
      active = { body };
      assert.equal((await runCheck({ type, target, requestTimeoutMs: 1000 })).status, 0, type);
    }
    active = { body: 'Unauthorized', status: 401 };
    const protectedApi = await runCheck({ type: 'plex', target, requestTimeoutMs: 1000 });
    assert.equal(protectedApi.status, 1);
    assert.match(protectedApi.message, /401.*需要认证/);
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test('HTTP service URLs preserve explicit schemes, standard ports and custom health paths', () => {
  const grafana = HEALTH_ENDPOINTS.grafana;
  assert.equal(healthEndpointUrl({ target: 'grafana.internal' }, grafana), 'http://grafana.internal:3000/api/health');
  assert.equal(healthEndpointUrl({ target: 'https://grafana.internal' }, grafana), 'https://grafana.internal/api/health');
  assert.equal(healthEndpointUrl({ target: 'https://proxy.internal/custom/health?check=1' }, grafana), 'https://proxy.internal/custom/health?check=1');
  assert.equal(healthEndpointUrl({ target: 'http://cluster.internal:8080/readyz' }, HEALTH_ENDPOINTS.kubernetes), 'http://cluster.internal:8080/readyz');
  assert.equal(healthEndpointUrl({ target: 'keycloak.internal' }, HEALTH_ENDPOINTS.keycloak), 'http://keycloak.internal:9000/health/ready');
});
