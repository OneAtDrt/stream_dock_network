'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize, normalizeHosts, kindOf, isValidHost, DEFAULT_HOSTS, MAX_HOSTS } = require('./settings');

test('action UUIDs map to kinds', () => {
  assert.equal(kindOf('com.oneatdrt.network.status'), 'status');
  assert.equal(kindOf('com.oneatdrt.network.ping'), 'ping');
  assert.equal(kindOf('com.oneatdrt.network.speed'), 'speed');
  assert.equal(kindOf('com.oneatdrt.network.knob'), 'knob');
  assert.equal(kindOf('com.example.other'), null);
});

test('empty settings give defaults', () => {
  assert.deepEqual(normalize('status', {}), { interval: 10, ipService: 'auto', ipinfoToken: '', pingMethod: 'icmp', slowMs: 300 });
  assert.deepEqual(normalize('knob', {}), {
    interval: 10, ipService: 'auto', ipinfoToken: '', pingMethod: 'icmp', slowMs: 300,
    hosts: DEFAULT_HOSTS, speedInterval: 2, unit: 'auto', mode: 'bytes',
  });
  assert.deepEqual(normalize('ping', undefined), { interval: 10, pingMethod: 'icmp', hosts: DEFAULT_HOSTS });
  assert.deepEqual(normalize('speed', null), { interval: 2, unit: 'auto', mode: 'bytes' });
  assert.throws(() => normalize('nope', {}));
});

test('intervals are clamped and rounded', () => {
  assert.equal(normalize('status', { interval: 1 }).interval, 5);
  assert.equal(normalize('status', { interval: 99999 }).interval, 3600);
  assert.equal(normalize('ping', { interval: '0' }).interval, 2);
  assert.equal(normalize('speed', { interval: 0.2 }).interval, 1);
  assert.equal(normalize('speed', { interval: '3.6' }).interval, 4);
  assert.equal(normalize('speed', { interval: 'abc' }).interval, 2);
  assert.equal(normalize('speed', { interval: '' }).interval, 2);
  assert.equal(normalize('status', { slowMs: 1 }).slowMs, 50);
  assert.equal(normalize('knob', { interval: 1, speedInterval: 500 }).interval, 5);
  assert.equal(normalize('knob', { speedInterval: 500 }).speedInterval, 60);
});

test('enums fall back to defaults', () => {
  const s = normalize('status', { ipService: 'evil', pingMethod: 'udp' });
  assert.equal(s.ipService, 'auto');
  assert.equal(s.pingMethod, 'icmp');
  assert.equal(normalize('status', { ipService: 'ip-api' }).ipService, 'ip-api');
  assert.deepEqual(normalize('speed', { unit: 'TB', mode: 'bits' }), { interval: 2, unit: 'auto', mode: 'bits' });
});

test('host list: min 1 (else defaults), max 8, invalid entries dropped', () => {
  assert.deepEqual(normalizeHosts([]), DEFAULT_HOSTS);
  assert.deepEqual(normalizeHosts('x'), DEFAULT_HOSTS);
  assert.deepEqual(normalizeHosts([{ label: 'X', host: '-oProxy' }]), DEFAULT_HOSTS);
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `H${i}`, host: `h${i}.example.com` }));
  assert.equal(normalizeHosts(many).length, MAX_HOSTS);
  assert.deepEqual(normalizeHosts([{ label: '  Home  ', host: ' 192.0.2.1 ' }, { host: 'bad host' }]), [{ label: 'Home', host: '192.0.2.1' }]);
});

test('labels are trimmed to 8 chars and derived from the host when empty', () => {
  assert.deepEqual(normalizeHosts([{ label: '', host: 'speedtest.example.net' }]), [{ label: 'speedtes', host: 'speedtest.example.net' }]);
  assert.equal(normalizeHosts([{ label: 'VeryLongLabel', host: 'a.example' }])[0].label, 'VeryLong');
});

test('host validation', () => {
  for (const ok of ['ya.ru', '203.0.113.7', '2001:db8::1', 'my-host.local', 'localhost']) assert.ok(isValidHost(ok), ok);
  for (const bad of ['', '-c', 'a b', 'a;rm', 'host/', '$(x)', 'x'.repeat(254), undefined]) assert.ok(!isValidHost(bad), String(bad));
});

test('default hosts are not shared by reference', () => {
  const a = normalizeHosts([]);
  a[0].label = 'changed';
  assert.equal(DEFAULT_HOSTS[0].label, 'US');
});

test('ipinfo token: alphanumeric only, else empty', () => {
  assert.equal(normalize('status', { ipinfoToken: ' abc123DEF ' }).ipinfoToken, 'abc123DEF');
  assert.equal(normalize('status', { ipinfoToken: 'abc&x=1' }).ipinfoToken, '');
  assert.equal(normalize('knob', { ipinfoToken: 42 }).ipinfoToken, '42');
  assert.equal(normalize('knob', { ipinfoToken: null }).ipinfoToken, '');
});

test('knob hosts are validated like the Ping action', () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ label: `H${i}`, host: `h${i}.example.com` }));
  assert.equal(normalize('knob', { hosts: many }).hosts.length, 8);
  assert.deepEqual(normalize('knob', { hosts: [] }).hosts, DEFAULT_HOSTS);
});
