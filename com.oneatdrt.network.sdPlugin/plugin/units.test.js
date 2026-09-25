'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatRate, formatLatency } = require('./units');

test('auto units step at 1000', () => {
  assert.deepEqual(formatRate(0), { value: '0', unit: 'B/s' });
  assert.deepEqual(formatRate(512), { value: '512', unit: 'B/s' });
  assert.deepEqual(formatRate(999), { value: '999', unit: 'B/s' });
  assert.deepEqual(formatRate(1000), { value: '1.0', unit: 'KB/s' });
  assert.deepEqual(formatRate(12400000), { value: '12', unit: 'MB/s' });
  assert.deepEqual(formatRate(2_500_000_000), { value: '2.5', unit: 'GB/s' });
  assert.deepEqual(formatRate(4_000_000_000_000), { value: '4000', unit: 'GB/s' });
});

test('one decimal under 10, none above', () => {
  assert.deepEqual(formatRate(9_940), { value: '9.9', unit: 'KB/s' });
  assert.deepEqual(formatRate(9_960), { value: '10', unit: 'KB/s' });
  assert.deepEqual(formatRate(10_400), { value: '10', unit: 'KB/s' });
  assert.deepEqual(formatRate(123_456), { value: '123', unit: 'KB/s' });
});

test('values that round to 1000 move up a unit', () => {
  assert.deepEqual(formatRate(999_700), { value: '1.0', unit: 'MB/s' });
});

test('bits mode multiplies by 8', () => {
  assert.deepEqual(formatRate(125_000, { mode: 'bits' }), { value: '1.0', unit: 'Mbit/s' });
  assert.deepEqual(formatRate(12_500_000, { mode: 'bits' }), { value: '100', unit: 'Mbit/s' });
  assert.deepEqual(formatRate(10, { mode: 'bits' }), { value: '80', unit: 'bit/s' });
});

test('fixed units', () => {
  assert.deepEqual(formatRate(12_400_000, { unit: 'KB' }), { value: '12400', unit: 'KB/s' });
  assert.deepEqual(formatRate(1_240_000, { unit: 'MB' }), { value: '1.2', unit: 'MB/s' });
  assert.deepEqual(formatRate(500, { unit: 'MB' }), { value: '0.0', unit: 'MB/s' });
  assert.deepEqual(formatRate(0, { unit: 'GB' }), { value: '0', unit: 'GB/s' });
  assert.deepEqual(formatRate(125_000_000, { unit: 'MB', mode: 'bits' }), { value: '1000', unit: 'Mbit/s' });
});

test('missing values show a dash', () => {
  assert.deepEqual(formatRate(NaN), { value: '—', unit: 'B/s' });
  assert.deepEqual(formatRate(null, { unit: 'MB', mode: 'bits' }), { value: '—', unit: 'Mbit/s' });
  assert.deepEqual(formatRate(-5), { value: '—', unit: 'B/s' });
});

test('latency formatting', () => {
  assert.equal(formatLatency(67.045), '67');
  assert.equal(formatLatency(4.21), '4.2');
  assert.equal(formatLatency(NaN), '—');
});
