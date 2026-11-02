const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const dgram = require('dgram');
const http = require('http');
const net = require('net');
const checker = require('../lib/checker');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('extended monitor configuration is validated', () => {
  const json = require('../lib/core').normalizeMonitor({
    name: 'Health', type: 'http_json', target: 'https://api.test/health',
    jsonPath: 'data.version', expectedValue: '3.2', intervalSeconds: '1'
  });
  assert.equal(json.valid, true);
  assert.equal(json.monitor.intervalSeconds, 1);
  assert.equal(json.monitor.jsonPath, 'data.version');

  const regex = require('../lib/core').normalizeMonitor({
    name: 'Release', type: 'regex', target: 'https://site.test/', bodyPattern: 'v[0-9]+', expectedStatus: 200
  });
  assert.equal(regex.valid, true);
  assert.equal(regex.monitor.bodyPattern, 'v[0-9]+');

  const badRegex = require('../lib/core').normalizeMonitor({
    name: 'Bad', type: 'regex', target: 'https://site.test/', bodyPattern: '['
  });
  assert.equal(badRegex.valid, false);
});

test('HTTP JSON and application protocol probes produce real results', async () => {
  const httpServer = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: { version: '2026.8' } }));
  });
  const redisServer = net.createServer((socket) => socket.on('data', () => socket.end('+PONG\r\n')));
  const mysqlServer = net.createServer((socket) => socket.end(Buffer.from([5, 0, 0, 0, 10])));
  const smtpServer = net.createServer((socket) => socket.end('220 mail.test ESMTP\r\n'));
  const websocketServer = net.createServer((socket) => {
    socket.once('data', (buffer) => {
      const key = /sec-websocket-key:\s*(.+)/i.exec(buffer.toString())[1].trim();
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.end([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '',
        ''
      ].join('\r\n'));
    });
  });

  const [httpPort, redisPort, mysqlPort, smtpPort, wsPort] = await Promise.all([
    listen(httpServer), listen(redisServer), listen(mysqlServer), listen(smtpServer), listen(websocketServer)
  ]);
  try {
    const jsonData = await checker.runCheck({
      type: 'http_json', target: `http://127.0.0.1:${httpPort}/health`, expectedStatus: 200,
      jsonPath: 'data.version', expectedValue: '2026', requestTimeoutMs: 1000
    });
    assert.equal(jsonData.status, 1);
    assert.match(jsonData.message, /2026\.8/);

    const redis = await checker.runCheck({ type: 'redis', target: `127.0.0.1:${redisPort}`, requestTimeoutMs: 1000 });
    assert.equal(redis.status, 1);
    assert.match(redis.message, /Redis PONG/);

    const mysql = await checker.runCheck({ type: 'mysql', target: `127.0.0.1:${mysqlPort}`, requestTimeoutMs: 1000 });
    assert.equal(mysql.status, 1);

    const smtp = await checker.runCheck({ type: 'smtp', target: `127.0.0.1:${smtpPort}`, requestTimeoutMs: 1000 });
    assert.equal(smtp.status, 1);

    const websocket = await checker.runCheck({ type: 'websocket', target: `ws://127.0.0.1:${wsPort}/socket`, requestTimeoutMs: 1000 });
    assert.equal(websocket.status, 1);
  } finally {
    await Promise.all([httpServer, redisServer, mysqlServer, smtpServer, websocketServer].map(close));
  }
});

test('new binary protocol probes validate protocol-specific responses', async () => {
  let kafkaRequest;
  const amqpServer = net.createServer((socket) => socket.on('data', () => {
    socket.end(Buffer.from([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0x0a, 0x00, 0x0a, 0xce]));
  }));
  const kafkaServer = net.createServer((socket) => socket.on('data', (request) => {
    kafkaRequest = request;
    const response = Buffer.alloc(14);
    response.writeInt32BE(10, 0);
    response.writeInt32BE(1, 4);
    response.writeInt16BE(0, 8);
    response.writeInt32BE(1, 10);
    socket.end(response);
  }));
  let mongoRequest;
  const mongodbServer = net.createServer((socket) => socket.on('data', (request) => {
    mongoRequest = request;
    const response = Buffer.alloc(38);
    response.writeUInt32LE(response.length, 0);
    response.writeInt32LE(1, 4);
    response.writeInt32LE(1, 8);
    response.writeInt32LE(2013, 12);
    response.writeUInt32LE(17, 21);
    response[25] = 0x01;
    response.write('ok\0', 26);
    response.writeDoubleLE(1, 29);
    socket.end(response);
  }));
  const mssqlServer = net.createServer((socket) => socket.on('data', () => socket.end(Buffer.from([4, 1, 0, 12, 0, 0, 0, 0, 0xfd, 0, 0xfd, 0]))));
  const ldapServer = net.createServer((socket) => socket.on('data', () => socket.end(Buffer.from([0x30, 0x0c, 0x02, 0x01, 0x01, 0x61, 0x07, 0x0a, 0x01, 0x00, 0x04, 0x00, 0x04, 0x00]))));
  const socksServer = net.createServer((socket) => socket.on('data', () => socket.end(Buffer.from([5, 0]))));
  const vncServer = net.createServer((socket) => socket.end('RFB 003.008\n'));
  const zookeeperServer = net.createServer((socket) => socket.on('data', () => socket.end('zk_version\t3.9.1\n')));

  const servers = [amqpServer, kafkaServer, mongodbServer, mssqlServer, ldapServer, socksServer, vncServer, zookeeperServer];
  const ports = await Promise.all(servers.map(listen));
  const [amqpPort, kafkaPort, mongodbPort, mssqlPort, ldapPort, socksPort, vncPort, zookeeperPort] = ports;
  const targets = {
    amqp: `127.0.0.1:${amqpPort}`,
    kafka: `127.0.0.1:${kafkaPort}`,
    mongodb: `127.0.0.1:${mongodbPort}`,
    mssql: `127.0.0.1:${mssqlPort}`,
    ldap: `127.0.0.1:${ldapPort}`,
    socks5: `127.0.0.1:${socksPort}`,
    vnc: `127.0.0.1:${vncPort}`,
    zookeeper: `127.0.0.1:${zookeeperPort}`
  };
  try {
    const checks = [
      ['amqp', 'AMQP Connection.Start 正常'],
      ['kafka', 'Kafka ApiVersions 正常'],
      ['mongodb', 'MongoDB OP_MSG hello 正常'],
      ['mssql', 'MSSQL PRELOGIN 响应正常'],
      ['ldap', 'LDAP 匿名绑定成功'],
      ['socks5', 'SOCKS5 无认证协商成功'],
      ['vnc', 'VNC 握手正常'],
      ['zookeeper', 'ZooKeeper mntr 正常']
    ];
    for (const [type, message] of checks) {
      const result = await checker.runCheck({ type, target: targets[type], requestTimeoutMs: 1000 });
      assert.equal(result.status, 1, `${type}: ${result.message}`);
      assert.match(result.message, new RegExp(message));
    }
    assert.equal(kafkaRequest.readUInt32BE(0), 10);
    assert.equal(kafkaRequest.readInt16BE(4), 18);
    assert.equal(kafkaRequest.readInt16BE(6), 0);
    assert.equal(kafkaRequest.readInt32BE(8), 1);
    assert.equal(kafkaRequest.readInt16BE(12), -1);
    assert.ok(mongoRequest.includes(Buffer.from('$db\0')));
    assert.ok(mongoRequest.includes(Buffer.from('admin\0')));
  } finally {
    await Promise.all(servers.map(close));
  }
});

test('additional service protocols validate their own responses', async () => {
  const beanstalkd = net.createServer((socket) => socket.on('data', () => socket.end('OK 14\r\n---\n- default\n')));
  const gearman = net.createServer((socket) => socket.on('data', () => socket.end('VERSION 1.1.21\r\n')));
  const nats = net.createServer((socket) => socket.end('INFO {"server_id":"test-nats"}\r\n'));
  const cassandra = net.createServer((socket) => socket.on('data', () => {
    socket.end(Buffer.from([0x84, 0x00, 0x00, 0x01, 0x06, 0x00, 0x00, 0x00, 0x00]));
  }));
  const xmpp = net.createServer((socket) => socket.on('data', () => socket.end(
    "<stream:stream xmlns:stream='http://etherx.jabber.org/streams' id='test'>"
  )));
  const irc = net.createServer((socket) => socket.end('NOTICE AUTH :*** Looking up your hostname\r\n'));
  const whois = net.createServer((socket) => socket.on('data', () => socket.end('domain: EXAMPLE.COM\r\n')));
  const servers = [beanstalkd, gearman, nats, cassandra, xmpp, irc, whois];
  const ports = await Promise.all(servers.map(listen));
  try {
    const types = ['beanstalkd', 'gearman', 'nats', 'cassandra', 'xmpp', 'irc', 'whois'];
    for (let index = 0; index < types.length; index += 1) {
      const result = await checker.runCheck({
        type: types[index],
        target: `127.0.0.1:${ports[index]}`,
        expectedValue: 'example.com',
        requestTimeoutMs: 1000
      });
      assert.equal(result.status, 1, `${types[index]}: ${result.message}`);
    }
  } finally {
    await Promise.all(servers.map(close));
  }
});

test('SIP, SNMP, and built-in health endpoints read real responses', async () => {
  const healthServer = http.createServer((request, response) => {
    if (request.url === '/-/healthy') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('Prometheus Server is Healthy.\n');
      return;
    }
    response.writeHead(404); response.end();
  });
  const sipSocket = dgram.createSocket('udp4');
  const snmpSocket = dgram.createSocket('udp4');
  await Promise.all([
    listen(healthServer),
    new Promise((resolve) => sipSocket.bind(0, '127.0.0.1', resolve)),
    new Promise((resolve) => snmpSocket.bind(0, '127.0.0.1', resolve))
  ]);
  sipSocket.on('message', (packet, remote) => sipSocket.send('SIP/2.0 200 OK\r\nContent-Length: 0\r\n\r\n', remote.port, remote.address));
  snmpSocket.on('message', (packet, remote) => snmpSocket.send(
    Buffer.from('303102010104067075626c6963a2240201010201000201003019301706082b06010201010100040b5465737420646576696365', 'hex'),
    remote.port,
    remote.address
  ));
  try {
    const prometheus = await checker.runCheck({
      type: 'prometheus', target: `127.0.0.1:${healthServer.address().port}`, requestTimeoutMs: 1000
    });
    assert.equal(prometheus.status, 1);

    const sip = await checker.runCheck({ type: 'sip', target: `127.0.0.1:${sipSocket.address().port}`, requestTimeoutMs: 1000 });
    assert.equal(sip.status, 1);

    const snmp = await checker.runCheck({
      type: 'snmp', target: `127.0.0.1:${snmpSocket.address().port}`, snmpCommunity: 'public', requestTimeoutMs: 1000
    });
    assert.equal(snmp.status, 1);
    assert.match(snmp.message, /Test device/);
  } finally {
    await Promise.all([
      close(healthServer),
      new Promise((resolve) => sipSocket.close(resolve)),
      new Promise((resolve) => snmpSocket.close(resolve))
    ]);
  }
});

test('NTP probe reads a local UDP time response', async () => {
  const socket = dgram.createSocket('udp4');
  await new Promise((resolve) => socket.bind(0, '127.0.0.1', resolve));
  socket.on('message', (packet, remote) => {
    const response = Buffer.alloc(48);
    packet.copy(response, 0, 0, 48);
    const seconds = Math.floor(Date.now() / 1000) + 2208988800;
    response.writeUInt32BE(seconds, 40);
    socket.send(response, remote.port, remote.address);
  });
  try {
    const result = await checker.runCheck({
      type: 'ntp', target: `127.0.0.1:${socket.address().port}`, requestTimeoutMs: 1000
    });
    assert.equal(result.status, 1);
    assert.match(result.message, /NTP 时间同步正常/);
  } finally {
    socket.close();
  }
});

test('MQTT accepts only a successful CONNACK return code', async () => {
  let code = 0;
  const upstream = net.createServer((socket) => socket.on('data', () => socket.end(Buffer.from([0x20, 0x02, 0x00, code]))));
  const port = await listen(upstream);
  try {
    const monitor = { type: 'mqtt', target: `127.0.0.1:${port}`, requestTimeoutMs: 1000 };
    assert.equal((await checker.runCheck(monitor)).status, 1);
    code = 5;
    const rejected = await checker.runCheck(monitor);
    assert.equal(rejected.status, 0);
    assert.match(rejected.message, /代码 5/);
  } finally {
    await close(upstream);
  }
});
