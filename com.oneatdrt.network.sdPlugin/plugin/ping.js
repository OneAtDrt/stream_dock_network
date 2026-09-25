'use strict';

const { execFile } = require('node:child_process');
const dns = require('node:dns').promises;
const net = require('node:net');

const PING = '/sbin/ping';
const TIMEOUT_S = 2;
const TCP_PORT = 443;
const PAGE_SIZE = 3;

// Output of `ping -c 1 -t <s> -q <host>` → { ok, ms } or { ok: false, error }.
// Exit codes: 0 reply, 2 no reply, 68 unknown host (EX_NOHOST).
function parsePingOutput(stdout = '', stderr = '', code = 0) {
  const rtt = /round-trip [^=]+= [\d.]+\/([\d.]+)\//.exec(stdout);
  if (rtt) return { ok: true, ms: Number(rtt[1]) };
  const text = `${stderr}\n${stdout}`;
  if (/cannot resolve|Unknown host/i.test(text) || code === 68) return { ok: false, error: 'unknown host' };
  if (/No route to host|Network is unreachable|Host is down/i.test(text)) return { ok: false, error: 'unreachable' };
  if (/100(\.0)?% packet loss/.test(text) || code === 2) return { ok: false, error: 'timeout' };
  return { ok: false, error: (stderr.trim().split('\n').pop() || `exit ${code}`).slice(0, 80) };
}

function pingIcmp(host, { timeoutS = TIMEOUT_S } = {}) {
  if (String(host).startsWith('-')) return Promise.resolve({ ok: false, error: 'bad host' });
  // macOS ping is IPv4 only (IPv6 needs ping6); TCP mode handles IPv6 literals.
  if (net.isIPv6(host)) return Promise.resolve({ ok: false, error: 'IPv6: use TCP' });
  return new Promise((resolve) => {
    // execFile, never a shell; settings.isValidHost also rejects a leading '-'.
    execFile(PING, ['-c', '1', '-t', String(timeoutS), '-q', host], { timeout: (timeoutS + 2) * 1000 }, (err, stdout, stderr) => {
      if (err && err.killed) return resolve({ ok: false, error: 'timeout' });
      resolve(parsePingOutput(stdout, stderr, err ? err.code : 0));
    });
  });
}

// TCP handshake time to port 443. DNS is resolved first so only the connect is timed.
async function pingTcp(host, { timeoutS = TIMEOUT_S, port = TCP_PORT } = {}) {
  let address;
  try {
    address = net.isIP(host) ? host : (await dns.lookup(host)).address;
  } catch {
    return { ok: false, error: 'unknown host' };
  }
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const socket = net.connect({ host: address, port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutS * 1000, () => done({ ok: false, error: 'timeout' }));
    socket.once('connect', () => done({ ok: true, ms: Number(process.hrtime.bigint() - started) / 1e6 }));
    socket.once('error', (err) => done({ ok: false, error: err.code === 'ECONNREFUSED' ? 'refused' : 'unreachable' }));
  });
}

// ICMP fallback: a host whose ICMP ping fails but answers on TCP 443 (ping blocked by a firewall
// or VPN) is pinged over TCP from then on. Re-checked with ICMP after this long.
const TCP_REMEMBER_MS = 60 * 60 * 1000;

// One per plugin process, so the per-host fallback is shared by every action.
// ping(host, method) → { ok, ms?, error?, via: 'icmp' | 'tcp' }. method: 'icmp' (with fallback) | 'tcp'.
function createPinger({ icmp = pingIcmp, tcp = pingTcp, now = Date.now, timeoutS = TIMEOUT_S } = {}) {
  const tcpSince = new Map();

  async function ping(host, method = 'icmp') {
    const since = tcpSince.get(host);
    const remembered = since !== undefined && now() - since < TCP_REMEMBER_MS;
    if (method === 'tcp' || remembered) return { ...(await tcp(host, { timeoutS })), via: 'tcp' };
    tcpSince.delete(host);
    const viaIcmp = await icmp(host, { timeoutS });
    // A name that doesn't resolve won't work over TCP either.
    if (viaIcmp.ok || viaIcmp.error === 'unknown host') return { ...viaIcmp, via: 'icmp' };
    const viaTcp = await tcp(host, { timeoutS });
    if (!viaTcp.ok) return { ...viaIcmp, via: 'icmp' };
    tcpSince.set(host, now());
    return { ...viaTcp, via: 'tcp' };
  }

  // All hosts in parallel → [{ label, host, ok, ms?, error?, via }] in list order.
  function pingAll(hosts, method = 'icmp') {
    return Promise.all(hosts.map(async ({ label, host }) => ({ label, host, ...(await ping(host, method)) })));
  }

  return { ping, pingAll };
}

function pageCount(total, size = PAGE_SIZE) {
  return Math.max(1, Math.ceil(total / size));
}

// Knob turns move one page per tick direction and wrap around.
function turnPage(page, ticks, total, size = PAGE_SIZE) {
  const pages = pageCount(total, size);
  const step = Math.sign(Number(ticks) || 0);
  return (((page + step) % pages) + pages) % pages;
}

function pageItems(list, page, size = PAGE_SIZE) {
  const pages = pageCount(list.length, size);
  const p = Math.min(Math.max(0, page), pages - 1);
  return list.slice(p * size, p * size + size);
}

module.exports = { PAGE_SIZE, TCP_REMEMBER_MS, parsePingOutput, pingIcmp, pingTcp, createPinger, pageCount, turnPage, pageItems };
