'use strict';

const { pageCount } = require('./ping');

// Pages of the combined Network knob: Status, one Ping page per 3 hosts, Speed.
// 5 hosts → [status, ping 0, ping 1, speed].
function knobPages(hostCount) {
  const ping = Array.from({ length: pageCount(hostCount) }, (_, i) => ({ kind: 'ping', hostPage: i }));
  return [{ kind: 'status' }, ...ping, { kind: 'speed' }];
}

// One page per turn direction, wrapping around; out-of-range pages (host list shrank) are clamped first.
function turnKnob(page, ticks, total) {
  const current = Math.min(Math.max(0, page), total - 1);
  const step = Math.sign(Number(ticks) || 0);
  return (((current + step) % total) + total) % total;
}

module.exports = { knobPages, turnKnob };
