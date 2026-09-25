'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { connectionState } = require('./status');
const { renderStatus, renderPing, renderSpeed } = require('./render');

const fast = { ok: true, ms: 20 };
const slow = { ok: true, ms: 900 };
const lost = { ok: false, error: 'timeout' };

test('unknown before any result', () => {
  assert.equal(connectionState({ ip: null, pings: null }), 'unknown');
});

test('online if the IP lookup works OR any ping answers', () => {
  assert.equal(connectionState({ ip: { ok: true }, pings: [fast, fast] }), 'online');
  assert.equal(connectionState({ ip: { ok: false }, pings: [fast, fast] }), 'online');
  assert.equal(connectionState({ ip: { ok: true }, pings: null }), 'online');
});

test('offline when both fail', () => {
  assert.equal(connectionState({ ip: { ok: false }, pings: [lost, lost] }), 'offline');
  assert.equal(connectionState({ ip: { ok: false }, pings: [] }), 'offline');
});

test('slow: at least half the hosts fail, or all replies are slow', () => {
  assert.equal(connectionState({ ip: { ok: true }, pings: [fast, lost] }), 'slow');
  assert.equal(connectionState({ ip: { ok: true }, pings: [fast, fast, lost] }), 'online');
  assert.equal(connectionState({ ip: { ok: true }, pings: [fast, lost, lost] }), 'slow');
  assert.equal(connectionState({ ip: { ok: false }, pings: [slow, lost] }), 'slow');
  assert.equal(connectionState({ ip: { ok: true }, pings: [slow, slow] }), 'slow');
  assert.equal(connectionState({ ip: { ok: true }, pings: [slow, fast] }), 'online');
  assert.equal(connectionState({ ip: { ok: true }, pings: [slow], slowMs: 1000 }), 'online');
});

// Placeholder renderers: only the interface is checked (valid SVG data URI, right size, key text).
function svg(uri) {
  assert.match(uri, /^data:image\/svg\+xml;charset=utf8,/);
  return decodeURIComponent(uri.split(',').slice(1).join(','));
}

test('renderers return sized SVGs with the key info', () => {
  const rate = { value: '12', unit: 'MB/s' };
  const status = svg(renderStatus({ state: 'online', ip: '203.0.113.5', country: 'NL', isp: 'Example <ISP>', down: rate, up: rate, page: 0, pages: 3 }));
  assert.match(status, /width="176" height="112"/);
  assert.match(status, /203\.0\.113\.5/);
  assert.match(status, /Example &lt;ISP&gt;/);
  assert.match(status, />12 MB\/s</); // compact ↓/↑ line (arrows are drawn shapes)
  assert.equal((status.match(/<circle cx="\d+" cy="18" r="3"/g) || []).length, 3); // knob page dots
  assert.match(svg(renderStatus({ state: 'offline', down: null, up: null }, { square: true })), /width="144" height="144"/);

  const hosts = [{ label: 'US', ms: 87.4 }, { label: 'RU', ms: null, error: 'timeout' }, { label: 'EU', ms: null, pending: true }, { label: 'JP', ms: 250 }];
  const ping = svg(renderPing({ hosts, page: 0, method: 'ICMP', knobPage: 1, pages: 4 }));
  assert.match(ping, />US</);
  assert.match(ping, />87 ms</);
  assert.match(ping, />timeout</);
  assert.doesNotMatch(ping, />JP</);
  assert.match(svg(renderPing({ hosts, page: 1, method: 'TCP' })), />JP</);

  const speed = svg(renderSpeed({ down: rate, up: { value: '1.2', unit: 'MB/s' }, histDown: [1, 3], histUp: [2, 1], mode: 'bytes', iface: 'en0' }, { square: true }));
  assert.match(speed, />12</);
  assert.match(speed, />MB\/s</);
  assert.match(speed, /polyline/); // history graph
  assert.match(speed, /width="144" height="144"/);
});
