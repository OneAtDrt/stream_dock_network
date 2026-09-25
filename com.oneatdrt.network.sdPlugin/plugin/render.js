'use strict';

// Key images for the Network plugin (approved design: design/mockups.js). 176×112 knob panel,
// letterboxed onto a 144×144 key with { square: true }. Returns data:image/svg+xml URIs.

const FONT = 'font-family="-apple-system, Helvetica, Arial, sans-serif"';
const C = { bg: '#0b1120', on: '#f8fafc', dim: '#64748b', sub: '#94a3b8', green: '#22c55e', amber: '#f59e0b', red: '#ef4444', blue: '#3b82f6', track: '#1e293b' };

const escapeXml = (v) => String(v ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function text(x, y, s, size, fill, weight = 700, anchor = 'start') {
  return `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(s)}</text>`;
}

function fit(s, max) {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function frame(body, square) {
  const size = square ? 'width="144" height="144" viewBox="0 -32 176 176"' : 'width="176" height="112" viewBox="0 0 176 112"';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${size}><rect x="0" y="${square ? -32 : 0}" width="176" height="${square ? 176 : 112}" fill="${C.bg}"/>${body}</svg>`;
  return `data:image/svg+xml;charset=utf8,${encodeURIComponent(svg)}`;
}

// Page dots for the combined Network knob; nothing when the view isn't part of a cycle.
function pageDots(page, count) {
  if (!count || count < 2) return '';
  const x0 = 118 - (count - 1) * 5;
  return Array.from({ length: count }, (_, i) => `<circle cx="${x0 + i * 10}" cy="18" r="3" fill="${i === page ? C.on : C.dim}"/>`).join('');
}

function arrow(x, y, up, color, k = 1) {
  const g = up
    ? `<polygon points="0,10 7,0 14,10" fill="${color}"/><rect x="5" y="9" width="4" height="8" fill="${color}"/>`
    : `<polygon points="0,7 7,17 14,7" fill="${color}"/><rect x="5" y="0" width="4" height="8" fill="${color}"/>`;
  return `<g transform="translate(${x} ${y}) scale(${k})">${g}</g>`;
}

const rate = (r) => (r && r.value != null ? `${r.value} ${r.unit}` : '–');

const STATUS = { online: [C.green, 'ONLINE'], slow: [C.amber, 'SLOW'], offline: [C.red, 'OFFLINE'], unknown: [C.dim, 'CHECKING'] };

function renderStatus(m, { square = false } = {}) {
  const [color, label] = STATUS[m.state] || STATUS.unknown;
  const offline = m.state === 'offline';
  const ipText = m.ip || (m.state === 'unknown' ? '…' : '—');
  let line2;
  if (m.copied) line2 = [text(10, 76, 'IP copied ✓', 12, C.green, 700)];
  else if (m.stale) line2 = [text(10, 76, 'last known IP', 12, C.sub, 600)];
  else if (offline) line2 = [text(10, 76, 'no connection', 12, C.sub, 600)];
  else line2 = [text(10, 76, fit(m.isp || (m.ip ? 'looking up ISP…' : ''), 24), 12, C.sub, 600)];
  const speed = offline ? '' : `${arrow(10, 90, false, C.green, 0.7)}${text(24, 101, rate(m.down), 12, C.on, 700)}${arrow(92, 90, true, C.blue, 0.7)}${text(106, 101, rate(m.up), 12, C.on, 700)}`;
  return frame(`
<circle cx="16" cy="18" r="6" fill="${color}"/>
${text(28, 23, label, 13, color, 800)}
${pageDots(m.page, m.pages)}
${m.country ? `<rect x="136" y="9" width="30" height="19" rx="5" fill="${C.track}"/>${text(151, 23, fit(m.country, 3), 12, C.on, 800, 'middle')}` : ''}
${text(10, 56, ipText, ipText.length > 15 ? 15 : 20, m.stale || !m.ip ? C.dim : C.on, 800)}
${line2.join('')}
${speed}`, square);
}

const latencyColor = (ms) => (ms == null ? C.red : ms < 100 ? C.green : ms < 200 ? C.amber : C.red);

function pingRow(h, i) {
  const y = 34 + i * 26;
  const color = h.pending ? C.dim : latencyColor(h.ms);
  const w = h.pending ? 0 : h.ms == null ? 50 : Math.max(4, Math.min(50, (h.ms / 300) * 50));
  const value = h.pending ? '…' : h.ms == null ? 'timeout' : `${Math.round(h.ms)} ms`;
  return `<rect x="10" y="${y}" width="30" height="20" rx="5" fill="${C.track}"/>${text(25, y + 15, fit(h.label, 3), 11, C.on, 800, 'middle')}
<rect x="46" y="${y + 7}" width="50" height="6" rx="3" fill="${C.track}"/>${w ? `<rect x="46" y="${y + 7}" width="${w}" height="6" rx="3" fill="${color}"/>` : ''}
${h.via === 'tcp' && h.ms != null ? text(100, y + 14, 'tcp', 9, C.dim, 700) : ''}
${text(166, y + 16, value, h.ms == null && !h.pending ? 12 : 15, color, 800, 'end')}`;
}

function renderPing(m, { square = false } = {}) {
  const hosts = m.hosts || [];
  const pages = Math.max(1, Math.ceil(hosts.length / 3));
  const page = Math.min(m.page || 0, pages - 1);
  const rows = hosts.slice(page * 3, page * 3 + 3).map(pingRow).join('\n');
  return frame(`
${text(10, 22, 'PING', 12, C.sub, 800)}
${pageDots(m.knobPage, m.pages)}
${text(166, 22, pages > 1 ? `${page + 1}/${pages} · ${m.method}` : m.method, 11, C.dim, 700, 'end')}
${rows}`, square);
}

function sparkline(values, color, fill, max) {
  if (!values || values.length < 2) return '';
  const pts = values.map((v, i) => `${(10 + (i * 156) / (values.length - 1)).toFixed(1)},${(106 - ((v || 0) / max) * 20).toFixed(1)}`);
  return (fill ? `<polygon points="10,106 ${pts.join(' ')} 166,106" fill="${color}" opacity="0.18"/>` : '')
    + `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
}

function renderSpeed(m, { square = false } = {}) {
  const col = (x, up, r, color) => `${arrow(x, 32, up, color)}${text(x + 20, 50, r?.value ?? '–', 22, C.on, 800)}${text(x + 20, 64, r?.unit ?? '', 11, C.sub, 700)}`;
  // One scale for both lines, so upload and download are comparable.
  const max = Math.max(...(m.histDown || [0]), ...(m.histUp || [0]), 1);
  const noNet = !m.iface;
  return frame(`
${text(10, 22, 'SPEED', 12, C.sub, 800)}
${pageDots(m.knobPage, m.pages)}
${text(166, 22, noNet ? 'no network' : m.mode === 'bits' ? 'bits' : 'bytes', 11, C.dim, 700, 'end')}
${col(10, false, m.down, C.green)}
${col(94, true, m.up, C.blue)}
<line x1="10" y1="106.5" x2="166" y2="106.5" stroke="${C.track}"/>
${sparkline(m.histDown, C.green, true, max)}
${sparkline(m.histUp, C.blue, false, max)}`, square);
}

module.exports = { renderStatus, renderPing, renderSpeed, latencyColor, pageDots };
