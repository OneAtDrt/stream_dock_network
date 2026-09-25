'use strict';

// The Stream Dock plugin API has no way to colour knob rings, so we talk to the N4 Pro directly
// over USB HID, opened NON-exclusively (hidapi seizes the device by default on macOS, which knocks
// Stream Dock off it and freezes the screen). Protocol from mirajazz:
// report 0 + "CRT\0\0SETLB" + [r,g,b] per knob, padded to 1024 bytes.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const VENDOR_ID = 0x5548;
const PRODUCT_IDS = [0x1021, 0x1023, 0x1008]; // N4 Pro E, VSD N4 Pro, N4 Pro
const USAGE_PAGE = 0xffa0;
const PACKET_SIZE = 1024;
const KNOB_COUNT = 4;
const HEADER = [0x00, 0x43, 0x52, 0x54, 0x00, 0x00, 0x53, 0x45, 0x54, 0x4c, 0x42];
const CONFIG_FILE = path.join(os.homedir(), 'Library/Application Support/HotSpot/StreamDock/config/StreamDockConfig.plist');

let HID = null;
try {
  HID = require('node-hid');
} catch {
  // Without node-hid the knob panel still works; only the ring colour is skipped.
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Ring colours chosen in the Stream Dock app live in its INI-style config:
//   [DeviceLightBrightness]
//   N4ProE000000000000\2=#19fa1f
function parseRingColors(text) {
  const colors = Array.from({ length: KNOB_COUNT }, () => [0, 0, 0]);
  const section = /\[DeviceLightBrightness\]([\s\S]*?)(?:\n\[|$)/.exec(text || '');
  if (!section) return colors;
  for (const match of section[1].matchAll(/^N4Pro\w*\\(\d)=(#[0-9a-fA-F]{6})\s*$/gm)) {
    const index = Number(match[1]);
    if (index < KNOB_COUNT) colors[index] = hexToRgb(match[2]);
  }
  return colors;
}

function readRingColors() {
  try {
    return parseRingColors(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return Array.from({ length: KNOB_COUNT }, () => [0, 0, 0]);
  }
}

function buildPacket(colors) {
  const buf = Buffer.alloc(1 + PACKET_SIZE);
  Buffer.from(HEADER).copy(buf);
  colors.slice(0, KNOB_COUNT).flat().forEach((value, i) => { buf[HEADER.length + i] = value; });
  return buf;
}

function writeColors(colors) {
  if (!HID) throw new Error('node-hid unavailable');
  const info = HID.devices().find((d) => d.vendorId === VENDOR_ID && PRODUCT_IDS.includes(d.productId) && d.usagePage === USAGE_PAGE);
  if (!info) throw new Error('N4 Pro not found');
  const device = new HID.HID(info.path, { nonExclusive: true });
  try {
    device.write([...buildPacket(colors)]);
  } finally {
    device.close();
  }
}

// One packet sets all four rings, so each packet must carry every plugin's current colour. Rings we
// own live in `owned`; other Stream Dock plugins (e.g. Audio and Network) publish theirs in a shared
// file, so a write here doesn't reset their knobs. Entries of plugins that are no longer running
// are ignored. Knobs nobody owns show the colour chosen in the Stream Dock app.
const SHARED_FILE = process.env.ONEATDRT_RINGS_FILE || path.join(os.tmpdir(), 'oneatdrt-knob-rings.json');
const owned = new Map();

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function readShared() {
  try {
    return JSON.parse(fs.readFileSync(SHARED_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

// Other live plugins' rings + ours, and our entries published back to the shared file.
function mergeShared(shared, pid = process.pid, alive = isAlive) {
  const merged = {};
  for (const [index, entry] of Object.entries(shared)) {
    if (entry && entry.pid !== pid && Array.isArray(entry.rgb) && alive(entry.pid)) merged[index] = entry;
  }
  for (const [index, rgb] of owned) merged[index] = { pid, rgb };
  return merged;
}

function writeAll() {
  const merged = mergeShared(readShared());
  try {
    const tmp = `${SHARED_FILE}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(merged));
    fs.renameSync(tmp, SHARED_FILE);
  } catch {
    // Sharing is best effort; the device write below still happens.
  }
  const colors = readRingColors();
  for (const [index, entry] of Object.entries(merged)) {
    if (Number(index) >= 0 && Number(index) < KNOB_COUNT) colors[Number(index)] = entry.rgb;
  }
  writeColors(colors);
}

function setKnobColor(knobIndex, rgb) {
  if (knobIndex < 0 || knobIndex >= KNOB_COUNT) return;
  owned.set(knobIndex, rgb);
  writeAll();
}

// Hands a ring back to the Stream Dock app's colour (e.g. when the action leaves the page).
function releaseKnob(knobIndex) {
  if (!owned.delete(knobIndex)) return;
  writeAll();
}

module.exports = { setKnobColor, releaseKnob, readRingColors, parseRingColors, buildPacket, hexToRgb, mergeShared, owned };
