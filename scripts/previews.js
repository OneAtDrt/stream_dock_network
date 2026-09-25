#!/usr/bin/env node
'use strict';

// Renders the README preview images with the plugin's real render.js into docs/previews/<name>.png
// at 2× device scale. Needs Google Chrome (headless). Usage: node scripts/previews.js
// All sample content is made up: documentation IP addresses (RFC 5737), an example ISP and ping times.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const { renderStatus, renderPing, renderSpeed } = require('../com.oneatdrt.network.sdPlugin/plugin/render');

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(__dirname, '..', 'docs', 'previews');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'network-previews-'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Headless Chrome writes the screenshot but doesn't always exit, so wait for the file, then stop it.
async function screenshot(html, width, height, out, scale = 2) {
  const page = path.join(TMP, 'page.html');
  fs.writeFileSync(page, html);
  fs.rmSync(out, { force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${path.join(TMP, 'profile')}`, `--force-device-scale-factor=${scale}`,
    `--window-size=${width},${height}`, `--screenshot=${out}`, `file://${page}`
  ], { stdio: 'ignore', detached: true });
  let exited = false;
  chrome.on('exit', () => { exited = true; });
  try {
    for (let waited = 0; !fs.existsSync(out); waited += 100) {
      if (exited || waited > 30000) throw new Error(`Chrome produced no screenshot for ${path.basename(out)}`);
      await sleep(100);
    }
    await sleep(300); // let the write finish
  } finally {
    if (!exited) {
      try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
      while (!exited) await sleep(50);
    }
  }
  return out;
}

const pageHtml = (body, style = '') => `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:#000;overflow:hidden}img{display:block}${style}</style></head><body>${body}</body></html>`;

const knob = (name, uri, caption) => [name, uri, 176, 112, caption];
const key = (name, uri, caption) => [name, uri, 144, 144, caption];

// Smooth made-up traffic history in bytes/s, oldest first.
const history = (base, swing) => Array.from({ length: 30 }, (_, i) => Math.max(0, base + Math.sin(i / 2.5) * swing + (i % 7) * swing * 0.2));
const rate = (value, unit) => ({ value, unit });
const hosts = [
  { label: 'US', host: 'us.example', ms: 182, via: 'icmp' },
  { label: 'EU', host: 'eu.example', ms: 94, via: 'icmp' },
  { label: 'RU', host: 'ru.example', ms: 61, via: 'icmp' }
];
const online = { state: 'online', ip: '203.0.113.42', country: 'NL', isp: 'Example Fiber B.V.', down: rate('12.4', 'MB/s'), up: rate('846', 'KB/s') };

function previews() {
  return [
    knob('knob-status', renderStatus({ ...online, page: 0, pages: 3 }), 'Network knob · page 1: Status'),
    knob('knob-ping', renderPing({ hosts, page: 0, method: 'ICMP', knobPage: 1, pages: 3 }), 'Network knob · page 2: Ping'),
    knob('knob-speed', renderSpeed({ down: rate('12.4', 'MB/s'), up: rate('846', 'KB/s'), histDown: history(9e6, 4e6), histUp: history(8e5, 4e5), mode: 'bytes', iface: 'en0', knobPage: 2, pages: 3 }), 'Network knob · page 3: Speed'),
    knob('status-slow', renderStatus({ ...online, state: 'slow', down: rate('3.1', 'KB/s'), up: rate('0.9', 'KB/s') }), 'Status: slow'),
    knob('status-offline', renderStatus({ state: 'offline', ip: null, down: null, up: null }), 'Status: offline'),
    knob('status-copied', renderStatus({ ...online, copied: true }), 'Status: IP copied (press)'),
    knob('ping-timeout', renderPing({ hosts: [{ ...hosts[0], ms: null, error: 'timeout' }, hosts[1], { ...hosts[2], ms: 58, via: 'tcp' }], page: 0, method: 'ICMP' }), 'Ping: timeout, one host via TCP'),
    knob('ping-page2', renderPing({ hosts: [...hosts, { label: 'JP', ms: 251 }, { label: 'DE', ms: 88 }], page: 1, method: 'ICMP' }), 'Ping: 5 hosts, page 2 of 2'),
    knob('speed-bits', renderSpeed({ down: rate('99', 'Mbit/s'), up: rate('6.8', 'Mbit/s'), histDown: history(9e6, 4e6), histUp: history(8e5, 4e5), mode: 'bits', iface: 'en0' }), 'Speed: in bits'),
    key('key-status', renderStatus(online, { square: true }), 'Status on a key'),
    key('key-ping', renderPing({ hosts, page: 0, method: 'ICMP' }, { square: true }), 'Ping on a key')
  ];
}

const GALLERY = ['knob-status', 'knob-ping', 'knob-speed', 'status-slow', 'status-offline', 'ping-timeout'];

function checkPng(file, width, height) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = Number(/pixelWidth: (\d+)/.exec(out)[1]);
  const h = Number(/pixelHeight: (\d+)/.exec(out)[1]);
  if (w !== width || h !== height) throw new Error(`${path.basename(file)}: ${w}×${h}, expected ${width}×${height}`);
  // A blank screenshot compresses to almost nothing.
  if (fs.statSync(file).size < 2000) throw new Error(`${path.basename(file)} looks blank`);
  return `${w}×${h}`;
}

// The main states in a captioned grid on a dark backdrop.
async function gallery(items) {
  const cols = 3;
  const pad = 20;
  const gap = 16;
  const rows = Math.ceil(items.length / cols);
  const cellH = 112 + 6 + 14;
  const W = pad * 2 + cols * 176 + (cols - 1) * gap;
  const H = pad * 2 + rows * cellH + (rows - 1) * gap;
  const cells = items.map(([, uri, , , caption]) => `<figure><img width="176" height="112" src="${uri}"><figcaption>${caption}</figcaption></figure>`).join('');
  const html = pageHtml(`<div class="grid">${cells}</div>`, `
body{background:#0a0a0a}
.grid{display:grid;grid-template-columns:repeat(${cols},176px);gap:${gap}px;padding:${pad}px}
figure{margin:0;width:176px}img{border-radius:6px}
figcaption{font:500 11px/14px -apple-system,Helvetica,Arial,sans-serif;color:#94a3b8;margin-top:6px;text-align:center;white-space:nowrap}`);
  const file = await screenshot(html, W, H, path.join(OUT, 'gallery.png'));
  console.log(`gallery.png ${checkPng(file, W * 2, H * 2)}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const list = previews();
  for (const [name, uri, w, h] of list) {
    const file = await screenshot(pageHtml(`<img width="${w}" height="${h}" src="${uri}">`), w, h, path.join(OUT, `${name}.png`));
    console.log(`${name}.png ${checkPng(file, w * 2, h * 2)}`);
  }
  await gallery(GALLERY.map((n) => list.find((p) => p[0] === n)));
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => fs.rmSync(TMP, { recursive: true, force: true }));
