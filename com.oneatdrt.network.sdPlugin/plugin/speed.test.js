'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDefaultInterface, parseNetstat, computeRate, createSampler } = require('./speed');

const ROUTE = `   route to: default
destination: default
       mask: default
    gateway: 192.0.2.1
  interface: en1
      flags: <UP,GATEWAY,DONE,STATIC,PRCLONING,GLOBAL>
`;

// `netstat -ibn -I en1` (MAC and addresses anonymised).
const NETSTAT = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
en1        1500  <Link#26>   aa:bb:cc:dd:ee:ff 25598055     0 21543452266 17223967     0 7931638602     0
en1        1500  fe80::1%en1 fe80::1:2:3:4    25598055     - 21543452266 17223967     - 7931638602     -
en1        1500  192.0.2     192.0.2.10     25598055     - 21543452266 17223967     - 7931638602     -
`;
// Tunnel interfaces have no MAC, so the Address column is empty.
const NETSTAT_UTUN = `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
utun4      1380  <Link#30>                          1200     0     345678      900     0     123456     0
`;

test('default interface from route output', () => {
  assert.equal(parseDefaultInterface(ROUTE), 'en1');
  assert.equal(parseDefaultInterface('route: writing to routing socket: not in table'), null);
  assert.equal(parseDefaultInterface(''), null);
});

test('netstat Link row byte counters', () => {
  assert.deepEqual(parseNetstat(NETSTAT, 'en1'), { ibytes: 21543452266, obytes: 7931638602 });
  assert.deepEqual(parseNetstat(NETSTAT_UTUN, 'utun4'), { ibytes: 345678, obytes: 123456 });
  assert.equal(parseNetstat(NETSTAT, 'en0'), null);
  assert.equal(parseNetstat('', 'en1'), null);
});

test('rate = delta / elapsed; resets and interface changes give null', () => {
  const a = { iface: 'en1', at: 1000, ibytes: 1000, obytes: 500 };
  assert.deepEqual(computeRate(a, { iface: 'en1', at: 3000, ibytes: 5000, obytes: 1500 }), { down: 2000, up: 500 });
  assert.equal(computeRate(null, a), null);
  assert.equal(computeRate(a, { ...a, iface: 'en0', at: 2000 }), null);
  assert.equal(computeRate(a, { ...a, at: 2000, ibytes: 10 }), null);
  assert.equal(computeRate(a, { ...a }), null);
});

test('sampler keeps a bounded history and follows interface changes', async () => {
  let t = 0;
  let counter = 0;
  let iface = 'en1';
  const exec = async (file, args) => {
    if (file.endsWith('route')) return `  interface: ${iface}\n`;
    counter += 1000;
    return `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\n${args[2]} 1500 <Link#1> aa:bb:cc:dd:ee:ff 1 0 ${counter} 1 0 ${counter / 2} 0\n`;
  };
  const sampler = createSampler({ exec, now: () => (t += 1000), historySize: 5 });
  const first = await sampler.sample();
  assert.equal(first.down, null);
  assert.equal(first.iface, 'en1');
  const second = await sampler.sample();
  assert.deepEqual([second.down, second.up], [1000, 500]);
  for (let i = 0; i < 6; i += 1) await sampler.sample();
  assert.equal((await sampler.sample()).history.length, 5);

  // Wi-Fi → Ethernet: picked up at the next route check, and the first reading there has no rate.
  iface = 'en0';
  let switched = null;
  for (let i = 0; i < 10 && !switched; i += 1) {
    const r = await sampler.sample();
    if (r.iface === 'en0') switched = r;
  }
  assert.ok(switched);
  assert.equal(switched.down, null);
  assert.equal((await sampler.sample()).down, 1000);
});

test('sampler reports no interface when there is no default route', async () => {
  const sampler = createSampler({ exec: async () => '' });
  assert.deepEqual(await sampler.sample(), { iface: null, down: null, up: null, history: [] });
});
