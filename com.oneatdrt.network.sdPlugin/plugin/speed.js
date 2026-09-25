'use strict';

const { execFile } = require('node:child_process');

const HISTORY = 30;
// Re-check the default route every N samples, so a Wi-Fi ↔ Ethernet switch is picked up.
const ROUTE_EVERY = 10;

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 3000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// `route -n get default` → 'en0' (null when there is no default route).
function parseDefaultInterface(output) {
  const m = /^\s*interface:\s*(\S+)/m.exec(output || '');
  return m ? m[1] : null;
}

// `netstat -ibn -I <if>` → { ibytes, obytes } from the <Link#…> row. Counted from the right,
// because the Address column is empty for interfaces without a MAC (utun, ppp).
function parseNetstat(output, iface) {
  for (const line of String(output || '').split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols[0] !== iface || !/^<Link#\d+>$/.test(cols[2] || '')) continue;
    const n = cols.length;
    const ibytes = Number(cols[n - 5]);
    const obytes = Number(cols[n - 2]);
    if (Number.isFinite(ibytes) && Number.isFinite(obytes)) return { ibytes, obytes };
  }
  return null;
}

// Two counter readings → { down, up } bytes/s, or null when they can't be compared
// (first reading, interface changed, counters went backwards after a reset/wake).
function computeRate(prev, next) {
  if (!prev || !next || prev.iface !== next.iface) return null;
  const seconds = (next.at - prev.at) / 1000;
  const down = next.ibytes - prev.ibytes;
  const up = next.obytes - prev.obytes;
  if (seconds <= 0 || down < 0 || up < 0) return null;
  return { down: down / seconds, up: up / seconds };
}

// One sampler per plugin process. sample() → { iface, down, up, history } (down/up null until
// two readings exist). history holds the last 30 { down, up } rates, oldest first.
function createSampler({ exec = run, now = Date.now, historySize = HISTORY } = {}) {
  let iface = null;
  let prev = null;
  let count = 0;
  const history = [];

  async function sample() {
    if (!iface || count % ROUTE_EVERY === 0) {
      iface = parseDefaultInterface(await exec('/sbin/route', ['-n', 'get', 'default']).catch(() => ''));
    }
    count += 1;
    if (!iface) {
      prev = null;
      return { iface: null, down: null, up: null, history: history.slice() };
    }
    const counters = parseNetstat(await exec('/usr/sbin/netstat', ['-ibn', '-I', iface]), iface);
    if (!counters) {
      iface = null;
      prev = null;
      return { iface: null, down: null, up: null, history: history.slice() };
    }
    const next = { iface, at: now(), ...counters };
    const rate = computeRate(prev, next);
    prev = next;
    if (rate) {
      history.push(rate);
      if (history.length > historySize) history.shift();
    }
    return { iface, down: rate ? rate.down : null, up: rate ? rate.up : null, history: history.slice() };
  }

  return { sample };
}

module.exports = { parseDefaultInterface, parseNetstat, computeRate, createSampler };
