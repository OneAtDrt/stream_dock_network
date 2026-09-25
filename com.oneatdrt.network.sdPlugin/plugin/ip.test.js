'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROVIDERS, GEO_RETRY_MS, providerOrder, createIpService, stripAsn } = require('./ip');

// Fixtures use documentation addresses (RFC 5737) and ASNs (RFC 5398). No test touches the network.
const IPINFO = (ip = '203.0.113.5') => JSON.stringify({ ip, city: 'Example', country: 'NL', org: 'AS64500 Example Telecom B.V.' });
const IPIFY = (ip = '203.0.113.5') => JSON.stringify({ ip });
const IPAPI = JSON.stringify({ status: 'success', country: 'Netherlands', countryCode: 'NL', isp: 'Example Telecom', org: 'Example Org', query: '203.0.113.5' });
const IPAPI_FAIL = JSON.stringify({ status: 'fail', message: 'reserved range', query: '10.0.0.1' });

test('provider parsers', () => {
  assert.deepEqual(PROVIDERS.ipinfo.parse(IPINFO()), { ip: '203.0.113.5', country: 'NL', isp: 'Example Telecom B.V.' });
  assert.deepEqual(PROVIDERS.ipify.parse(IPIFY()), { ip: '203.0.113.5', country: null, isp: null });
  assert.deepEqual(PROVIDERS['ip-api'].parse(IPAPI), { ip: '203.0.113.5', country: 'NL', isp: 'Example Telecom' });
  assert.deepEqual(PROVIDERS.icanhazip.parse('203.0.113.5\n'), { ip: '203.0.113.5', country: null, isp: null });
  assert.equal(PROVIDERS.icanhazip.parse('2001:db8::5\n').ip, '2001:db8::5');
});

test('provider parsers reject junk (captive portals, errors)', () => {
  assert.throws(() => PROVIDERS.ipinfo.parse('<html>Login</html>'));
  assert.throws(() => PROVIDERS.icanhazip.parse('<html>Login</html>'));
  assert.throws(() => PROVIDERS.ipify.parse('{"ip":"not-an-ip"}'));
  assert.throws(() => PROVIDERS['ip-api'].parse(IPAPI_FAIL), /reserved range/);
});

test('ipinfo URL carries the optional token', () => {
  assert.equal(PROVIDERS.ipinfo.url(''), 'https://ipinfo.io/json');
  assert.equal(PROVIDERS.ipinfo.url('abc123'), 'https://ipinfo.io/json?token=abc123');
});

test('stripAsn', () => {
  assert.equal(stripAsn('AS64500 Example Telecom'), 'Example Telecom');
  assert.equal(stripAsn('Example'), 'Example');
  assert.equal(stripAsn(undefined), null);
});

test('fallbacks are the unlimited IP-only services', () => {
  assert.deepEqual(providerOrder('ipinfo'), ['ipinfo', 'ipify', 'icanhazip']);
  assert.deepEqual(providerOrder('ip-api'), ['ip-api', 'ipify', 'icanhazip']);
  assert.deepEqual(providerOrder('icanhazip'), ['icanhazip', 'ipify']);
  assert.deepEqual(providerOrder('bogus'), ['ipify', 'icanhazip']);
});

// Fake fetch: routes[host] is [status, body], an Error, or a function returning either. Records every URL.
function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const host = new URL(url).hostname;
    let r = routes[host];
    if (typeof r === 'function') r = r();
    if (!r || r instanceof Error) throw r || new Error('network down');
    return { ok: r[0] === 200, status: r[0], text: async () => r[1] };
  };
  return { fetchImpl, calls, count: (host) => calls.filter((u) => new URL(u).hostname === host).length };
}

function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

test("auto: ipinfo only on first sight of an IP, not on every check", async () => {
  let ip = '203.0.113.5';
  const net = fakeFetch({ 'api.ipify.org': () => [200, IPIFY(ip)], 'ipinfo.io': () => [200, IPINFO(ip)] });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: clock().now });

  const first = await svc.lookup('auto');
  assert.deepEqual([first.ok, first.ip, first.country, first.isp, first.provider], [true, '203.0.113.5', 'NL', 'Example Telecom B.V.', 'ipify']);
  for (let i = 0; i < 20; i += 1) await svc.lookup('auto');
  assert.equal(net.count('api.ipify.org'), 21);
  assert.equal(net.count('ipinfo.io'), 1);

  ip = '198.51.100.9';
  const changed = await svc.lookup('auto');
  assert.equal(changed.ip, '198.51.100.9');
  assert.equal(net.count('ipinfo.io'), 2);

  // Back to a known IP: country/ISP come from the per-IP cache.
  ip = '203.0.113.5';
  const back = await svc.lookup('auto');
  assert.equal(back.country, 'NL');
  assert.equal(net.count('ipinfo.io'), 2);
});

test('auto: a failed ipinfo keeps the IP, shows no country, and retries only after 1 h or an IP change', async () => {
  let ip = '203.0.113.5';
  let ipinfoUp = false;
  const c = clock();
  const net = fakeFetch({
    'api.ipify.org': () => [200, IPIFY(ip)],
    'ipinfo.io': () => (ipinfoUp ? [200, IPINFO(ip)] : [429, 'rate limited']),
  });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: c.now });

  const r = await svc.lookup('auto');
  assert.deepEqual([r.ok, r.ip, r.country, r.isp], [true, '203.0.113.5', null, null]);
  ipinfoUp = true;
  c.t += GEO_RETRY_MS - 1000;
  assert.equal((await svc.lookup('auto')).country, null);
  assert.equal(net.count('ipinfo.io'), 1);

  c.t += 1000;
  assert.equal((await svc.lookup('auto')).country, 'NL');
  assert.equal(net.count('ipinfo.io'), 2);

  // IP change triggers a lookup right away, even within the hour.
  ipinfoUp = false;
  ip = '198.51.100.9';
  await svc.lookup('auto');
  assert.equal(net.count('ipinfo.io'), 3);
  ipinfoUp = true;
  ip = '198.51.100.10';
  assert.equal((await svc.lookup('auto')).country, 'NL');
  assert.equal(net.count('ipinfo.io'), 4);
});

test('auto: icanhazip is the fallback for the IP; ipinfo is not used for the IP itself', async () => {
  const net = fakeFetch({ 'api.ipify.org': new Error('timeout'), 'icanhazip.com': [200, '203.0.113.5\n'], 'ipinfo.io': [200, IPINFO()] });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: clock().now });
  const r = await svc.lookup('auto', { token: 'tok123' });
  assert.deepEqual([r.ok, r.provider, r.country], [true, 'icanhazip', 'NL']);
  assert.ok(net.calls.includes('https://ipinfo.io/json?token=tok123'));

  const down = createIpService({ fetchImpl: fakeFetch({ 'ipinfo.io': [200, IPINFO()] }).fetchImpl });
  const failed = await down.lookup('auto');
  assert.equal(failed.ok, false);
  assert.match(failed.error, /ipify: network down; icanhazip: network down/);
  assert.equal(failed.cached, null);
});

test('auto: split routing (ipinfo sees another IP) still fills in the country', async () => {
  const net = fakeFetch({ 'api.ipify.org': [200, IPIFY('203.0.113.5')], 'ipinfo.io': [200, IPINFO('198.51.100.1')] });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: clock().now });
  assert.equal((await svc.lookup('auto')).country, 'NL');
  await svc.lookup('auto');
  assert.equal(net.count('ipinfo.io'), 1);
});

test('ipinfo mode asks ipinfo every check (with token); fallback is ipify and keeps the cached country', async () => {
  let ipinfoUp = true;
  const net = fakeFetch({ 'ipinfo.io': () => (ipinfoUp ? [200, IPINFO()] : new Error('timeout')), 'api.ipify.org': [200, IPIFY()] });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: clock().now });
  await svc.lookup('ipinfo', { token: 'abc' });
  await svc.lookup('ipinfo', { token: 'abc' });
  assert.equal(net.count('ipinfo.io'), 2);
  assert.equal(net.calls[0], 'https://ipinfo.io/json?token=abc');

  ipinfoUp = false;
  const r = await svc.lookup('ipinfo');
  assert.deepEqual([r.provider, r.ip, r.country], ['ipify', '203.0.113.5', 'NL']);
});

test('all providers down → not ok, with the last good result cached', async () => {
  let up = true;
  const net = fakeFetch({ 'api.ipify.org': () => (up ? [200, IPIFY()] : new Error('offline')) });
  const svc = createIpService({ fetchImpl: net.fetchImpl, now: clock().now });
  await svc.lookup('ipify');
  up = false;
  const r = await svc.lookup('ipify');
  assert.equal(r.ok, false);
  assert.equal(r.cached.ip, '203.0.113.5');
  assert.equal(svc.lastGood().ip, '203.0.113.5');
});
