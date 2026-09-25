'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');
const { kindOf, normalize, DEFAULT_HOSTS, INTERVALS } = require('./settings');
const { createIpService } = require('./ip');
const { createPinger, pageCount, turnPage } = require('./ping');
const { createSampler } = require('./speed');
const { connectionState } = require('./status');
const { knobPages, turnKnob } = require('./knob-pages');
const { formatRate } = require('./units');
const { renderStatus, renderPing, renderSpeed } = require('./render');
const { setKnobColor, releaseKnob } = require('./knob-led');

// How long the status panel says "COPIED" after a press.
const COPIED_MS = 1500;
// Ring writes wait for Stream Dock to finish sending the panel image, and are re-sent rarely
// in case it repaints the rings on a page switch (same approach as the Audio Control plugin).
const RING_DELAY_MS = 800;
const RING_REASSERT_MS = 60000;
const RING_COLORS = { online: [0x19, 0xfa, 0x1f], slow: [255, 140, 0], offline: [255, 0, 0] };
// Last connection colour, kept across page switches and restarts (Stream Dock repaints the rings with
// the app colours then), so the knob lights up at once instead of staying dark until the first check.
const LAST_RING_FILE = path.join(require('node:os').tmpdir(), 'oneatdrt-network-ring.json');
const LAST_RING_MAX_AGE_MS = 60 * 60 * 1000;
let lastKnownRing = readLastRing();

function readLastRing() {
  try {
    const saved = JSON.parse(fs.readFileSync(LAST_RING_FILE, 'utf8'));
    return Array.isArray(saved.rgb) && Date.now() - saved.at < LAST_RING_MAX_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

function rememberRing(rgb) {
  if (lastKnownRing && lastKnownRing.rgb.join(',') === rgb.join(',') && Date.now() - lastKnownRing.at < RING_REASSERT_MS) return;
  lastKnownRing = { rgb, at: Date.now() };
  try {
    fs.writeFileSync(LAST_RING_FILE, JSON.stringify(lastKnownRing));
  } catch {
    // Best effort: the in-memory copy still covers page switches.
  }
}
const LOG_FILE = path.join(__dirname, 'log', 'plugin.log');

const startup = parseStartupArgs(process.argv);
const ws = new WebSocket(`ws://127.0.0.1:${startup.port}`);
const ipService = createIpService();
const pinger = createPinger();
const sampler = createSampler();

// context -> { kind, square, knobIndex, settings, page, copiedUntil, keys, lastImage, lastRing, ringAt }
// page: host page for Ping, knob page for the Network knob.
const contexts = new Map();
// Shared polling loops, so e.g. three Ping keys with the same hosts send one set of pings.
// key -> { key, task, subs: Map(context -> interval s), timer, running, again, stopped, lastRun, last, failing }
const loops = new Map();
let ringTimer = null;

ws.on('open', () => {
  log('connected');
  send({ uuid: startup.pluginUuid, event: startup.registerEvent });
});

ws.on('close', () => process.exit(0));

ws.on('message', (raw) => {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    return;
  }
  const { event, context, payload = {} } = message;

  if (event === 'willAppear') {
    const kind = kindOf(message.action);
    if (!kind) return;
    const square = payload.controller === 'Keypad';
    const knobIndex = square ? -1 : Number(payload.coordinates?.column ?? -1);
    contexts.set(context, {
      kind, square, knobIndex, settings: normalize(kind, payload.settings), page: 0, copiedUntil: 0,
      keys: {}, lastImage: null, lastRing: null, ringAt: 0,
    });
    log(`appear ${kind} ${payload.controller} at ${JSON.stringify(payload.coordinates)}`);
    subscribeContext(context);
    paint(context);
    if (kind === 'knob' && knobIndex >= 0) scheduleRings();
    return;
  }

  const item = contexts.get(context);
  if (!item) return;

  if (event === 'willDisappear') {
    unsubscribeContext(context);
    contexts.delete(context);
    // Leaving the page: hand the ring back to the colour chosen in the Stream Dock app.
    if (item.lastRing) setTimeout(() => ringCall(() => releaseKnob(item.knobIndex)), RING_DELAY_MS);
  } else if (event === 'didReceiveSettings') {
    applySettings(context, payload.settings);
  } else if (event === 'sendToPlugin') {
    // The Property Inspector also pushes settings here, in case setSettings isn't echoed back.
    if (payload.type === 'settings') applySettings(context, payload.settings);
    // Only on connect: echoing every save would reset fields the user is still typing in.
    if (payload.type === 'hello') {
      send({ event: 'sendToPropertyInspector', context, action: message.action, payload: { type: 'settings', settings: item.settings } });
    }
  } else if (event === 'dialRotate') {
    if (item.kind === 'ping') item.page = turnPage(item.page, payload.ticks, item.settings.hosts.length);
    if (item.kind === 'knob') item.page = turnKnob(item.page, payload.ticks, knobPages(item.settings.hosts.length).length);
    paint(context);
  } else if (event === 'dialDown' || event === 'keyUp') {
    press(context, item, item.kind === 'knob' ? currentKnobPage(item).kind : item.kind);
  }
});

function press(context, item, pageKind) {
  if (pageKind === 'status') {
    const ip = shownIp(item);
    if (ip) {
      copyToClipboard(ip.ip);
      item.copiedUntil = Date.now() + COPIED_MS;
      paint(context);
      setTimeout(() => paint(context), COPIED_MS + 50);
    }
    runNow(item.keys.ip);
    runNow(item.keys.ping);
  } else if (pageKind === 'ping') {
    runNow(item.keys.ping);
  } else if (pageKind === 'speed') {
    item.settings = { ...item.settings, mode: item.settings.mode === 'bits' ? 'bytes' : 'bits' };
    send({ event: 'setSettings', context, payload: item.settings });
    paint(context);
  }
}

function applySettings(context, raw) {
  const item = contexts.get(context);
  item.settings = normalize(item.kind, raw);
  if (item.kind === 'ping') item.page = Math.min(item.page, pageCount(item.settings.hosts.length) - 1);
  if (item.kind === 'knob') item.page = Math.min(item.page, knobPages(item.settings.hosts.length).length - 1);
  unsubscribeContext(context);
  subscribeContext(context);
  paint(context);
}

function currentKnobPage(item) {
  const pages = knobPages(item.settings.hosts.length);
  return { ...pages[Math.min(item.page, pages.length - 1)], index: Math.min(item.page, pages.length - 1), total: pages.length };
}

// --- shared loops -------------------------------------------------------------------------

function subscribeContext(context) {
  const item = contexts.get(context);
  const s = item.settings;
  item.keys = {};
  if (item.kind === 'status' || item.kind === 'knob') {
    // Status always pings the default hosts; the knob pings its own list (shown on its Ping pages).
    const hosts = item.kind === 'knob' ? s.hosts : DEFAULT_HOSTS;
    item.keys.ip = `ip:${s.ipService}${s.ipinfoToken ? `:${crypto.createHash('sha256').update(s.ipinfoToken).digest('hex').slice(0, 8)}` : ''}`;
    subscribe(item.keys.ip, context, s.interval, () => ipService.lookup(s.ipService, { token: s.ipinfoToken }));
    subscribePing(item, context, s.pingMethod, hosts, s.interval);
    // The Status page shows a compact ↓/↑ line, so the speed sampler runs while it's visible.
    subscribeSpeed(item, context, item.kind === 'knob' ? s.speedInterval : INTERVALS.speed[0]);
  } else if (item.kind === 'ping') {
    subscribePing(item, context, s.pingMethod, s.hosts, s.interval);
  } else {
    subscribeSpeed(item, context, s.interval);
  }
}

function subscribePing(item, context, method, hosts, interval) {
  const list = hosts.map(({ host }) => ({ host }));
  item.keys.ping = `ping:${method}:${list.map((h) => h.host).join(',')}`;
  subscribe(item.keys.ping, context, interval, () => pinger.pingAll(list, method));
}

function subscribeSpeed(item, context, interval) {
  item.keys.speed = 'speed';
  subscribe('speed', context, interval, () => sampler.sample());
}

function subscribe(key, context, intervalS, task) {
  let loop = loops.get(key);
  if (!loop) {
    loop = { key, task, subs: new Map(), timer: null, running: false, again: false, stopped: false, lastRun: 0, last: null, failing: false };
    loops.set(key, loop);
    loop.subs.set(context, intervalS);
    runLoop(loop);
    return;
  }
  loop.subs.set(context, intervalS);
  // A shorter interval may now be due sooner.
  if (!loop.running) schedule(loop);
}

function unsubscribeContext(context) {
  for (const loop of [...loops.values()]) {
    if (!loop.subs.delete(context) || loop.subs.size) continue;
    loop.stopped = true;
    clearTimeout(loop.timer);
    loops.delete(loop.key);
  }
}

function schedule(loop) {
  clearTimeout(loop.timer);
  if (loop.stopped) return;
  const intervalMs = Math.min(...loop.subs.values()) * 1000;
  loop.timer = setTimeout(() => runLoop(loop), Math.max(0, loop.lastRun + intervalMs - Date.now()));
}

function runNow(key) {
  const loop = key && loops.get(key);
  if (loop) runLoop(loop);
}

async function runLoop(loop) {
  if (loop.stopped) return;
  if (loop.running) {
    loop.again = true;
    return;
  }
  clearTimeout(loop.timer);
  loop.running = true;
  loop.lastRun = Date.now();
  try {
    loop.last = await loop.task();
    if (loop.failing) log(`${loop.key} recovered`);
    loop.failing = false;
  } catch (err) {
    if (!loop.failing) log(`${loop.key} failed: ${err.message}`);
    loop.failing = true;
  }
  loop.running = false;
  if (loop.key.startsWith('ip:') && loop.last) logOnce(loop, loop.last.ok ? null : loop.last.error);
  for (const context of loop.subs.keys()) paint(context);
  if (loop.again) {
    loop.again = false;
    runLoop(loop);
  } else {
    schedule(loop);
  }
}

function logOnce(loop, message) {
  if (loop.lastError === message) return;
  loop.lastError = message;
  log(`${loop.key}: ${message || 'ok'}`);
}

// --- panels -------------------------------------------------------------------------------

function lastOf(key) {
  return (key && loops.get(key)?.last) ?? null;
}

function shownIp(item) {
  const ip = lastOf(item.keys.ip);
  return ip ? (ip.ok ? ip : ip.cached) : null;
}

function stateOf(item) {
  return connectionState({ ip: lastOf(item.keys.ip), pings: lastOf(item.keys.ping), slowMs: item.settings.slowMs });
}

function rates(item) {
  const s = lastOf(item.keys.speed);
  const opts = { unit: item.settings.unit || 'auto', mode: item.settings.mode || 'bytes' };
  return { s, down: s ? formatRate(s.down ?? NaN, opts) : null, up: s ? formatRate(s.up ?? NaN, opts) : null };
}

function statusModel(item, nav = {}) {
  const ip = lastOf(item.keys.ip);
  const shown = shownIp(item);
  const { down, up } = rates(item);
  return {
    state: stateOf(item),
    ip: shown?.ip ?? null,
    country: shown?.country ?? null,
    isp: shown?.isp ?? null,
    stale: Boolean(ip && !ip.ok && shown),
    copied: Date.now() < item.copiedUntil,
    down,
    up,
    ...nav,
  };
}

function pingModel(item, hostPage, nav = {}) {
  const results = lastOf(item.keys.ping) || [];
  const hosts = item.settings.hosts.map((h, i) => {
    const r = results[i];
    if (!r) return { label: h.label, host: h.host, ms: null, pending: true };
    return { label: h.label, host: h.host, ms: r.ok ? r.ms : null, error: r.ok ? null : r.error, via: r.via };
  });
  return { hosts, page: hostPage, method: item.settings.pingMethod.toUpperCase(), ...nav };
}

function speedModel(item, nav = {}) {
  const { s, down, up } = rates(item);
  const history = s?.history ?? [];
  return {
    down: down || formatRate(NaN, item.settings),
    up: up || formatRate(NaN, item.settings),
    histDown: history.map((h) => h.down),
    histUp: history.map((h) => h.up),
    mode: item.settings.mode,
    // Before the first sample, don't claim there's no network.
    iface: s ? s.iface : 'pending',
    ...nav,
  };
}

function render(item) {
  const opts = { square: item.square };
  if (item.kind === 'status') return renderStatus(statusModel(item), opts);
  if (item.kind === 'ping') return renderPing(pingModel(item, item.page), opts);
  if (item.kind === 'speed') return renderSpeed(speedModel(item), opts);
  // Network knob: Status uses page/pages for its dots, Ping/Speed use knobPage/pages (as in the mockups).
  const current = currentKnobPage(item);
  if (current.kind === 'status') return renderStatus(statusModel(item, { page: current.index, pages: current.total }), opts);
  if (current.kind === 'ping') return renderPing(pingModel(item, current.hostPage, { knobPage: current.index, pages: current.total }), opts);
  return renderSpeed(speedModel(item, { knobPage: current.index, pages: current.total }), opts);
}

function paint(context) {
  const item = contexts.get(context);
  if (!item) return;
  if (item.kind === 'knob') scheduleRings();
  let image;
  try {
    image = render(item);
  } catch (err) {
    log(`render ${item.kind} failed: ${err.message}`);
    return;
  }
  if (image === item.lastImage) return;
  item.lastImage = image;
  send({ event: 'setImage', context, payload: { target: 0, image } });
}

// --- knob ring (Network knob only): green online, amber slow, red offline ---------------------

function scheduleRings() {
  clearTimeout(ringTimer);
  ringTimer = setTimeout(paintRings, RING_DELAY_MS);
}

function paintRings() {
  const now = Date.now();
  for (const item of contexts.values()) {
    if (item.kind !== 'knob' || item.knobIndex < 0) continue;
    let rgb = RING_COLORS[stateOf(item)];
    if (rgb) rememberRing(rgb);
    // No results yet (just appeared / restarted): show the last known colour if it's recent.
    else if (lastKnownRing && Date.now() - lastKnownRing.at < LAST_RING_MAX_AGE_MS) rgb = lastKnownRing.rgb;
    if (!rgb) continue;
    const key = rgb.join(',');
    if (key === item.lastRing && now - item.ringAt < RING_REASSERT_MS) continue;
    if (ringCall(() => setKnobColor(item.knobIndex, rgb))) {
      item.lastRing = key;
      item.ringAt = now;
    }
  }
}

let ringErrorLogged = false;
function ringCall(fn) {
  try {
    fn();
    ringErrorLogged = false;
    return true;
  } catch (err) {
    if (!ringErrorLogged) log(`knob ring update failed: ${err.message}`);
    ringErrorLogged = true;
    return false;
  }
}

function copyToClipboard(value) {
  try {
    const child = spawn('/usr/bin/pbcopy');
    child.on('error', (err) => log(`pbcopy failed: ${err.message}`));
    child.stdin.end(String(value));
  } catch (err) {
    log(`pbcopy failed: ${err.message}`);
  }
}

function send(message) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function log(line) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Logging must never break the plugin.
  }
}

function parseStartupArgs(argv) {
  const flags = new Map();
  for (let i = 2; i < argv.length - 1; i += 1) {
    if (argv[i].startsWith('-')) flags.set(argv[i].replace(/^-+/, ''), argv[i + 1]);
  }
  return { port: flags.get('port'), pluginUuid: flags.get('pluginUUID'), registerEvent: flags.get('registerEvent') };
}
