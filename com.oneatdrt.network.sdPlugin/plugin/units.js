'use strict';

// Decimal (SI) steps, like Activity Monitor and speed tests: 1 KB = 1000 B, 1 Mbit = 1000 kbit.
const STEP = 1000;
const BYTE_UNITS = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
const BIT_UNITS = ['bit/s', 'Kbit/s', 'Mbit/s', 'Gbit/s'];
const FIXED = { KB: 1, MB: 2, GB: 3 };

// Under 10 → one decimal, otherwise whole numbers. Whole bytes/bits never get decimals.
function formatNumber(value, level) {
  if (level === 0 || value === 0) return String(Math.round(value));
  return value < 9.95 ? value.toFixed(1) : String(Math.round(value));
}

// bytesPerSec → { value: '12.4', unit: 'MB/s' }. unit: 'auto' | 'KB' | 'MB' | 'GB'; mode: 'bytes' | 'bits'.
function formatRate(bytesPerSec, { unit = 'auto', mode = 'bytes' } = {}) {
  const units = mode === 'bits' ? BIT_UNITS : BYTE_UNITS;
  const fixed = FIXED[unit];
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return { value: '—', unit: units[fixed ?? 0] };
  const base = mode === 'bits' ? bytesPerSec * 8 : bytesPerSec;

  if (fixed !== undefined) return { value: formatNumber(base / STEP ** fixed, fixed), unit: units[fixed] };

  let level = 0;
  while (level < units.length - 1 && base >= STEP ** (level + 1)) level += 1;
  // 999.7 KB/s would print as "1000 KB/s"; promote it to "1.0 MB/s" instead.
  let text = formatNumber(base / STEP ** level, level);
  if (Number(text) >= STEP && level < units.length - 1) {
    level += 1;
    text = formatNumber(base / STEP ** level, level);
  }
  return { value: text, unit: units[level] };
}

// Round-trip time in ms → '67', '4.2', or '—' for no reply.
function formatLatency(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  return ms < 9.95 ? ms.toFixed(1) : String(Math.round(ms));
}

module.exports = { formatRate, formatLatency };
