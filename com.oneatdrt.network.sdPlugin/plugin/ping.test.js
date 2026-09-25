'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { parsePingOutput, pingTcp, pingIcmp, createPinger, TCP_REMEMBER_MS, pageCount, turnPage, pageItems } = require('./ping');

// Real macOS `ping -c 1 -t 2 -q` output (addresses replaced with documentation ranges).
const REPLY = `PING ya.ru (203.0.113.42): 56 data bytes

--- ya.ru ping statistics ---
1 packets transmitted, 1 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 67.045/67.045/67.045/0.000 ms
`;
const NO_REPLY = `PING 198.51.100.1 (198.51.100.1): 56 data bytes

--- 198.51.100.1 ping statistics ---
1 packets transmitted, 0 packets received, 100.0% packet loss
`;

test('parses the average round-trip time', () => {
  assert.deepEqual(parsePingOutput(REPLY, '', 0), { ok: true, ms: 67.045 });
  const multi = REPLY.replace('67.045/67.045/67.045/0.000', '10.1/12.5/15.2/2.1');
  assert.deepEqual(parsePingOutput(multi, '', 0), { ok: true, ms: 12.5 });
});

test('no reply is a timeout', () => {
  assert.deepEqual(parsePingOutput(NO_REPLY, '', 2), { ok: false, error: 'timeout' });
});

test('unknown host', () => {
  assert.deepEqual(parsePingOutput('', 'ping: cannot resolve nonexistent.invalid: Unknown host\n', 68), { ok: false, error: 'unknown host' });
});

test('unreachable network', () => {
  const out = 'PING 198.51.100.1 (198.51.100.1): 56 data bytes\nping: sendto: No route to host\n';
  assert.deepEqual(parsePingOutput(out, 'ping: sendto: No route to host\n', 2), { ok: false, error: 'unreachable' });
});

test('other errors keep the last stderr line', () => {
  assert.deepEqual(parsePingOutput('', 'ping: something odd\n', 64), { ok: false, error: 'ping: something odd' });
  assert.deepEqual(parsePingOutput('', '', 1), { ok: false, error: 'exit 1' });
});

test('icmp refuses flag-like hosts and IPv6 without running ping', async () => {
  assert.deepEqual(await pingIcmp('-f'), { ok: false, error: 'bad host' });
  assert.deepEqual(await pingIcmp('2001:db8::1'), { ok: false, error: 'IPv6: use TCP' });
});

test('tcp ping measures a local connect and reports refused ports', async () => {
  const server = net.createServer((s) => s.destroy());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const ok = await pingTcp('127.0.0.1', { port, timeoutS: 1 });
  assert.equal(ok.ok, true);
  assert.ok(ok.ms >= 0 && ok.ms < 1000);
  await new Promise((r) => server.close(r));
  assert.deepEqual(await pingTcp('127.0.0.1', { port, timeoutS: 1 }), { ok: false, error: 'refused' });
  assert.deepEqual(await pingTcp('nonexistent.invalid', { timeoutS: 1 }), { ok: false, error: 'unknown host' });
});

test('8 hosts page as 3 + 3 + 2 and knob turns wrap', () => {
  const hosts = Array.from({ length: 8 }, (_, i) => `h${i}`);
  assert.equal(pageCount(8), 3);
  assert.equal(pageCount(3), 1);
  assert.equal(pageCount(0), 1);
  assert.deepEqual(pageItems(hosts, 0), ['h0', 'h1', 'h2']);
  assert.deepEqual(pageItems(hosts, 1), ['h3', 'h4', 'h5']);
  assert.deepEqual(pageItems(hosts, 2), ['h6', 'h7']);
  assert.deepEqual(pageItems(hosts, 9), ['h6', 'h7']);
  assert.equal(turnPage(0, 1, 8), 1);
  assert.equal(turnPage(2, 1, 8), 0);
  assert.equal(turnPage(0, -1, 8), 2);
  assert.equal(turnPage(1, 5, 8), 2);
  assert.equal(turnPage(1, 0, 8), 1);
  assert.equal(turnPage(0, 1, 3), 0);
});

test('ICMP falls back to TCP per host and remembers it', async () => {
  const calls = [];
  const icmp = async (host) => { calls.push(`icmp ${host}`); return host === 'blocked.example' ? { ok: false, error: 'timeout' } : { ok: true, ms: 10 }; };
  const tcp = async (host) => { calls.push(`tcp ${host}`); return { ok: true, ms: 30 }; };
  let t = 0;
  const pinger = createPinger({ icmp, tcp, now: () => t });

  assert.deepEqual(await pinger.ping('open.example'), { ok: true, ms: 10, via: 'icmp' });
  assert.deepEqual(await pinger.ping('blocked.example'), { ok: true, ms: 30, via: 'tcp' });
  calls.length = 0;
  assert.deepEqual(await pinger.ping('blocked.example'), { ok: true, ms: 30, via: 'tcp' });
  assert.deepEqual(calls, ['tcp blocked.example']);

  // After an hour ICMP is tried again.
  t += TCP_REMEMBER_MS;
  calls.length = 0;
  await pinger.ping('blocked.example');
  assert.deepEqual(calls, ['icmp blocked.example', 'tcp blocked.example']);
});

test('no TCP fallback for unknown hosts; ICMP error kept when TCP fails too; tcp method skips ICMP', async () => {
  const calls = [];
  const icmp = async (host) => { calls.push(`icmp ${host}`); return host === 'nx.example' ? { ok: false, error: 'unknown host' } : { ok: false, error: 'timeout' }; };
  const tcp = async (host) => { calls.push(`tcp ${host}`); return { ok: false, error: 'refused' }; };
  const pinger = createPinger({ icmp, tcp });
  assert.deepEqual(await pinger.ping('nx.example'), { ok: false, error: 'unknown host', via: 'icmp' });
  assert.deepEqual(await pinger.ping('down.example'), { ok: false, error: 'timeout', via: 'icmp' });
  assert.deepEqual(await pinger.ping('down.example', 'tcp'), { ok: false, error: 'refused', via: 'tcp' });
  assert.deepEqual(calls, ['icmp nx.example', 'icmp down.example', 'tcp down.example', 'tcp down.example']);
  const all = await pinger.pingAll([{ label: 'A', host: 'nx.example' }, { label: 'B', host: 'down.example' }]);
  assert.deepEqual(all.map((r) => [r.label, r.error]), [['A', 'unknown host'], ['B', 'timeout']]);
});
