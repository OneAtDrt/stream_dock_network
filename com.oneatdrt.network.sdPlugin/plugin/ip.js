'use strict';

const net = require('node:net');

const TIMEOUT_MS = 5000;
// 'auto': after a failed ipinfo lookup, try again on the next IP change or after this long.
const GEO_RETRY_MS = 60 * 60 * 1000;

function parseJson(text) {
  return typeof text === 'string' ? JSON.parse(text) : text;
}

function checkIp(ip) {
  const value = String(ip ?? '').trim();
  if (!net.isIP(value)) throw new Error(`not an IP address: ${value.slice(0, 40)}`);
  return value;
}

// ipinfo's org looks like "AS64500 Example Telecom"; the AS number isn't useful on a 176 px panel.
function stripAsn(org) {
  return org ? String(org).replace(/^AS\d+\s+/, '') : null;
}

// Each parse takes the raw response body and returns { ip, country, isp } (unknown fields null) or throws.
const PROVIDERS = {
  // Free tier: 50k requests/month, so 'auto' only asks it when the IP changes.
  ipinfo: {
    url: (token) => (token ? `https://ipinfo.io/json?token=${encodeURIComponent(token)}` : 'https://ipinfo.io/json'),
    geo: true,
    parse(body) {
      const j = parseJson(body);
      return { ip: checkIp(j.ip), country: j.country || null, isp: stripAsn(j.org) };
    },
  },
  ipify: {
    url: () => 'https://api.ipify.org?format=json',
    parse(body) {
      return { ip: checkIp(parseJson(body).ip), country: null, isp: null };
    },
  },
  icanhazip: {
    url: () => 'https://icanhazip.com',
    parse(body) {
      return { ip: checkIp(body), country: null, isp: null };
    },
  },
  // Plain HTTP only on the free tier, rate limited to 45 requests/min.
  'ip-api': {
    url: () => 'http://ip-api.com/json',
    geo: true,
    parse(body) {
      const j = parseJson(body);
      if (j.status !== 'success') throw new Error(`ip-api: ${j.message || j.status}`);
      return { ip: checkIp(j.query), country: j.countryCode || null, isp: j.isp || j.org || null };
    },
  },
};

// Where the IP comes from each check. Fallbacks are the unlimited IP-only services, so a failing
// ipinfo/ip-api never turns into extra calls to another rate-limited service.
function providerOrder(service) {
  const cheap = ['ipify', 'icanhazip'];
  if (!PROVIDERS[service]) return cheap;
  return [service, ...cheap.filter((name) => name !== service)];
}

// One per plugin process. lookup(service, { token }) →
//   { ok: true, ip, country, isp, provider, at } or { ok: false, error, cached } (cached = last good or null).
// service 'auto': IP from ipify (icanhazip fallback) every check; country/ISP from ipinfo only when
// the IP changes (cached per IP), and a failed ipinfo lookup is retried after an IP change or 1 h.
function createIpService({ fetchImpl = (...args) => fetch(...args), now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  const geoByIp = new Map();
  let geoTry = { ip: null, at: -Infinity };
  let lastGood = null;

  async function fetchProvider(name, token) {
    const provider = PROVIDERS[name];
    const res = await fetchImpl(provider.url(token), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json, text/plain' },
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const result = provider.parse(await res.text());
    if (provider.geo) geoByIp.set(result.ip, { country: result.country, isp: result.isp });
    return result;
  }

  async function firstOk(names, token, errors) {
    for (const name of names) {
      try {
        return { ...(await fetchProvider(name, token)), provider: name };
      } catch (err) {
        errors.push(`${name}: ${err.message}`);
      }
    }
    return null;
  }

  async function enrich(ip, token, errors) {
    if (geoByIp.has(ip)) return;
    if (geoTry.ip === ip && now() - geoTry.at < GEO_RETRY_MS) return;
    geoTry = { ip, at: now() };
    try {
      const geo = await fetchProvider('ipinfo', token);
      // Split routing (VPN for some traffic) can make ipinfo see another address; keep it for this IP too.
      if (geo.ip !== ip) geoByIp.set(ip, { country: geo.country, isp: geo.isp });
    } catch (err) {
      errors.push(`ipinfo: ${err.message}`);
    }
  }

  async function lookup(service, { token = '' } = {}) {
    const errors = [];
    const result = await firstOk(service === 'auto' ? ['ipify', 'icanhazip'] : providerOrder(service), token, errors);
    if (!result) return { ok: false, error: errors.join('; '), cached: lastGood };
    if (service === 'auto') await enrich(result.ip, token, errors);
    const geo = geoByIp.get(result.ip);
    lastGood = {
      ok: true,
      ip: result.ip,
      country: result.country || geo?.country || null,
      isp: result.isp || geo?.isp || null,
      provider: result.provider,
      at: now(),
    };
    return lastGood;
  }

  return { lookup, lastGood: () => lastGood };
}

module.exports = { PROVIDERS, GEO_RETRY_MS, providerOrder, createIpService, stripAsn };
