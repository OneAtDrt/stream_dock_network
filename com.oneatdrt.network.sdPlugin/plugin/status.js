'use strict';

// Online if the external IP lookup worked OR any host answered.
// Slow: online, but at least half the hosts failed, or every reply was slower than slowMs. (A single
// dead host among several is normal and shouldn't turn the whole connection amber.)
// 'unknown' until the first results arrive.
function connectionState({ ip, pings, slowMs = 300 }) {
  const list = Array.isArray(pings) ? pings : [];
  if (!ip && list.length === 0) return 'unknown';
  const ipOk = Boolean(ip && ip.ok);
  const replies = list.filter((p) => p.ok);
  if (!ipOk && replies.length === 0) return 'offline';
  if (list.length === 0) return 'online';
  if ((list.length - replies.length) * 2 >= list.length) return 'slow';
  if (replies.every((p) => p.ms > slowMs)) return 'slow';
  return 'online';
}

module.exports = { connectionState };
