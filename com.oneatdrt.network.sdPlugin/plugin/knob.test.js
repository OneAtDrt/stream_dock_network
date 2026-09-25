'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { knobPages, turnKnob } = require('./knob-pages');
const { parseRingColors, buildPacket, hexToRgb } = require('./knob-led');

test('knob pages: Status, one Ping page per 3 hosts, Speed', () => {
  assert.deepEqual(knobPages(3), [{ kind: 'status' }, { kind: 'ping', hostPage: 0 }, { kind: 'speed' }]);
  assert.deepEqual(knobPages(5), [{ kind: 'status' }, { kind: 'ping', hostPage: 0 }, { kind: 'ping', hostPage: 1 }, { kind: 'speed' }]);
  assert.equal(knobPages(8).length, 5);
  assert.equal(knobPages(1).length, 3);
});

test('knob turns cycle and wrap', () => {
  assert.equal(turnKnob(0, 1, 4), 1);
  assert.equal(turnKnob(3, 1, 4), 0);
  assert.equal(turnKnob(0, -1, 4), 3);
  assert.equal(turnKnob(2, 7, 4), 3);
  assert.equal(turnKnob(2, 0, 4), 2);
  // Host list shrank: page 4 of a 3-page knob is clamped first.
  assert.equal(turnKnob(4, 1, 3), 0);
});

test('ring packet and Stream Dock ring colours (copied from Audio Control)', () => {
  assert.deepEqual(hexToRgb('#19fa1f'), [0x19, 0xfa, 0x1f]);
  const colors = parseRingColors('[DeviceLightBrightness]\nN4ProE000000000000\\2=#ff0000\n[Other]\nx=1\n');
  assert.deepEqual(colors[2], [255, 0, 0]);
  assert.deepEqual(colors[0], [0, 0, 0]);
  const packet = buildPacket([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
  assert.equal(packet.length, 1025);
  assert.equal(packet.subarray(1, 11).toString(), 'CRT\0\0SETLB');
  assert.deepEqual([...packet.subarray(11, 14)], [1, 2, 3]);
});
