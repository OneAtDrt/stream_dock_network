'use strict';

// Pure defaults + validation. Also loaded by the Property Inspector (as window.NetworkSettings),
// so it must not require anything.

const ACTIONS = {
  'com.oneatdrt.network.status': 'status',
  'com.oneatdrt.network.ping': 'ping',
  'com.oneatdrt.network.speed': 'speed',
  // The combined knob: turning cycles Status → Ping page(s) → Speed.
  'com.oneatdrt.network.knob': 'knob',
};

// Anycast addresses (8.8.8.8, 1.1.1.1) always answer from the nearest node, so each region
// gets a host that really lives there.
const DEFAULT_HOSTS = [
  { label: 'US', host: 'speedtest.newark.linode.com' },
  { label: 'EU', host: 'speedtest.frankfurt.linode.com' },
  { label: 'RU', host: 'ya.ru' },
];

const MIN_HOSTS = 1;
const MAX_HOSTS = 8;
const MAX_LABEL = 8;
const IP_SERVICES = ['auto', 'ipinfo', 'ipify', 'icanhazip', 'ip-api'];
const PING_METHODS = ['icmp', 'tcp'];
const SPEED_UNITS = ['auto', 'KB', 'MB', 'GB'];
const SPEED_MODES = ['bytes', 'bits'];

// Seconds: [default, min, max]. ip-api allows 45 requests/min, so status never polls faster than every 5 s.
const INTERVALS = {
  status: [10, 5, 3600],
  ping: [10, 2, 3600],
  speed: [2, 1, 60],
};
INTERVALS.knob = INTERVALS.status;
// Status turns "slow" when every reply is slower than this (ms).
const SLOW_MS = [300, 50, 5000];
// ipinfo.io access tokens are short alphanumeric strings.
const TOKEN_RE = /^[A-Za-z0-9]{1,64}$/;

const DEFAULTS = {
  status: { interval: INTERVALS.status[0], ipService: 'auto', ipinfoToken: '', pingMethod: 'icmp', slowMs: SLOW_MS[0] },
  ping: { interval: INTERVALS.ping[0], pingMethod: 'icmp', hosts: DEFAULT_HOSTS },
  speed: { interval: INTERVALS.speed[0], unit: 'auto', mode: 'bytes' },
};
DEFAULTS.knob = { ...DEFAULTS.status, hosts: DEFAULT_HOSTS, speedInterval: INTERVALS.speed[0], unit: 'auto', mode: 'bytes' };

// Hostname, IPv4 or IPv6. No leading '-', so a host can never be read as a ping flag.
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9_](?:[A-Za-z0-9_.:-]*[A-Za-z0-9_.])?$/;

function kindOf(actionUuid) {
  return ACTIONS[actionUuid] || null;
}

function clampNumber(value, [fallback, min, max]) {
  const n = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function normalizeToken(value) {
  const token = String(value ?? '').trim();
  return TOKEN_RE.test(token) ? token : '';
}

function isValidHost(host) {
  return typeof host === 'string' && HOST_RE.test(host);
}

// Keeps valid entries (max 8); an empty or missing list falls back to the defaults.
function normalizeHosts(list) {
  const hosts = [];
  for (const entry of Array.isArray(list) ? list : []) {
    const host = String(entry?.host ?? '').trim();
    if (!isValidHost(host)) continue;
    const label = String(entry?.label ?? '').trim().slice(0, MAX_LABEL) || host.split('.')[0].slice(0, MAX_LABEL);
    hosts.push({ label, host });
    if (hosts.length === MAX_HOSTS) break;
  }
  return hosts.length >= MIN_HOSTS ? hosts : DEFAULT_HOSTS.map((h) => ({ ...h }));
}

// Settings from Stream Dock (possibly empty, stale or hand-edited) → a complete, valid object.
function normalize(kind, raw = {}) {
  const s = raw && typeof raw === 'object' ? raw : {};
  if (kind === 'status' || kind === 'knob') {
    const status = {
      interval: clampNumber(s.interval, INTERVALS.status),
      ipService: oneOf(s.ipService, IP_SERVICES, DEFAULTS.status.ipService),
      ipinfoToken: normalizeToken(s.ipinfoToken),
      pingMethod: oneOf(s.pingMethod, PING_METHODS, DEFAULTS.status.pingMethod),
      slowMs: clampNumber(s.slowMs, SLOW_MS),
    };
    if (kind === 'status') return status;
    return {
      ...status,
      hosts: normalizeHosts(s.hosts),
      speedInterval: clampNumber(s.speedInterval, INTERVALS.speed),
      unit: oneOf(s.unit, SPEED_UNITS, DEFAULTS.knob.unit),
      mode: oneOf(s.mode, SPEED_MODES, DEFAULTS.knob.mode),
    };
  }
  if (kind === 'ping') {
    return {
      interval: clampNumber(s.interval, INTERVALS.ping),
      pingMethod: oneOf(s.pingMethod, PING_METHODS, DEFAULTS.ping.pingMethod),
      hosts: normalizeHosts(s.hosts),
    };
  }
  if (kind === 'speed') {
    return {
      interval: clampNumber(s.interval, INTERVALS.speed),
      unit: oneOf(s.unit, SPEED_UNITS, DEFAULTS.speed.unit),
      mode: oneOf(s.mode, SPEED_MODES, DEFAULTS.speed.mode),
    };
  }
  throw new Error(`unknown action kind: ${kind}`);
}

const api = {
  ACTIONS, DEFAULT_HOSTS, DEFAULTS, INTERVALS, SLOW_MS, MIN_HOSTS, MAX_HOSTS, MAX_LABEL,
  IP_SERVICES, PING_METHODS, SPEED_UNITS, SPEED_MODES,
  kindOf, normalize, normalizeHosts, normalizeToken, isValidHost,
};

if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.NetworkSettings = api;
