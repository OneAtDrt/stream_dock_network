'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeShared, owned } = require('./knob-led');

test('rings owned by other live plugins survive our writes; dead plugins are dropped', () => {
  owned.clear();
  owned.set(2, [255, 0, 0]);
  const alive = (pid) => pid === 200;
  const shared = {
    1: { pid: 200, rgb: [0, 255, 0] }, // another plugin, still running
    3: { pid: 300, rgb: [0, 0, 255] }, // a plugin that has exited
    2: { pid: 100, rgb: [9, 9, 9] } // our stale entry, replaced by what we own now
  };
  assert.deepEqual(mergeShared(shared, 100, alive), {
    1: { pid: 200, rgb: [0, 255, 0] },
    2: { pid: 100, rgb: [255, 0, 0] }
  });
  owned.clear();
  // Released ring: our old entry disappears, the other plugin's stays.
  assert.deepEqual(mergeShared({ 1: { pid: 200, rgb: [0, 255, 0] }, 2: { pid: 100, rgb: [255, 0, 0] } }, 100, alive), { 1: { pid: 200, rgb: [0, 255, 0] } });
  assert.deepEqual(mergeShared({ 1: null, 2: { pid: 200 } }, 100, alive), {});
});
