'use strict';

// One Property Inspector for all four actions; shows the section for the current action.
// Defaults and validation come from ../plugin/settings.js (window.NetworkSettings).
(() => {
  const NS = window.NetworkSettings;
  const $ = (id) => document.getElementById(id);
  let websocket = null;
  let context = null;
  let action = null;
  let kind = null;
  let settings = null;
  let saveTimer = null;
  const FIELDS = ['interval', 'speedInterval', 'ipService', 'ipinfoToken', 'slowMs', 'pingMethod', 'unit', 'mode'];

  window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
    const ai = JSON.parse(actionInfo);
    context = uuid;
    action = ai.action;
    kind = NS.kindOf(action);
    if (!kind) return;
    settings = NS.normalize(kind, ai.payload && ai.payload.settings);
    setup();
    fill();

    websocket = new WebSocket(`ws://127.0.0.1:${port}`);
    websocket.onopen = () => {
      websocket.send(JSON.stringify({ event: registerEvent, uuid }));
      sendToPlugin({ type: 'hello' });
    };
    websocket.onmessage = (evt) => {
      const msg = JSON.parse(evt.data);
      const payload = msg.payload || {};
      if (msg.event === 'didReceiveSettings') apply(payload.settings);
      if (msg.event === 'sendToPropertyInspector' && payload.type === 'settings') apply(payload.settings);
    };
  };

  function apply(raw) {
    settings = NS.normalize(kind, raw);
    fill();
  }

  function sendToPlugin(payload) {
    if (websocket && websocket.readyState === 1) websocket.send(JSON.stringify({ event: 'sendToPlugin', action, context, payload }));
  }

  function save() {
    settings = NS.normalize(kind, collect());
    if (!websocket || websocket.readyState !== 1) return;
    websocket.send(JSON.stringify({ event: 'setSettings', context, payload: settings }));
    sendToPlugin({ type: 'settings', settings });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  function setup() {
    for (const section of document.querySelectorAll('section[data-kind]')) {
      section.hidden = !section.dataset.kind.split(' ').includes(kind);
    }
    for (const el of document.querySelectorAll('[data-only]')) el.hidden = el.dataset.only !== kind;
    const [, min, max] = NS.INTERVALS[kind];
    Object.assign($('interval'), { min, max });
    Object.assign($('speedInterval'), { min: NS.INTERVALS.speed[1], max: NS.INTERVALS.speed[2] });
    Object.assign($('slowMs'), { min: NS.SLOW_MS[1], max: NS.SLOW_MS[2] });
    for (const id of FIELDS) $(id).addEventListener('change', save);
    $('ipService').addEventListener('change', showToken);
    $('addHost').addEventListener('click', () => {
      const rows = collectRows();
      if (rows.length >= NS.MAX_HOSTS) return;
      rows.push({ label: '', host: '' });
      renderHosts(rows);
      const inputs = $('hosts').querySelectorAll('input.host');
      inputs[inputs.length - 1].focus();
    });
    $('pi').hidden = false;
  }

  // Settings → form. Fields the user is typing in are left alone.
  function fill() {
    const active = document.activeElement;
    for (const id of FIELDS) {
      if (settings[id] !== undefined && $(id) !== active) $(id).value = settings[id];
    }
    if (settings.hosts && !$('hosts').contains(active)) renderHosts(settings.hosts);
    showToken();
  }

  // The token only matters for services that call ipinfo.io.
  function showToken() {
    $('tokenRow').hidden = !['auto', 'ipinfo'].includes($('ipService').value);
  }

  function collect() {
    const out = { ...settings };
    for (const id of Object.keys(settings)) {
      if (id !== 'hosts' && $(id)) out[id] = $(id).value;
    }
    if (settings.hosts) out.hosts = collectRows().filter((row) => NS.isValidHost(row.host));
    return out;
  }

  function collectRows() {
    return [...$('hosts').querySelectorAll('.host-row')].map((row) => ({
      label: row.querySelector('input.label').value.trim(),
      host: row.querySelector('input.host').value.trim(),
    }));
  }

  function renderHosts(rows) {
    const list = $('hosts');
    list.textContent = '';
    rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'host-row';
      const label = input('label', row.label, 'Label', NS.MAX_LABEL);
      const host = input('host', row.host, 'host.example.com', 253);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'remove';
      remove.title = 'Remove';
      remove.textContent = '×';
      remove.disabled = rows.length <= NS.MIN_HOSTS;
      remove.addEventListener('click', () => {
        const next = collectRows();
        next.splice(i, 1);
        renderHosts(next);
        save();
      });
      el.append(label, host, remove);
      list.append(el);
    });
    $('addHost').disabled = rows.length >= NS.MAX_HOSTS;
    markInvalid();
  }

  function input(className, value, placeholder, maxLength) {
    const el = document.createElement('input');
    Object.assign(el, { type: 'text', className, value, placeholder, maxLength, spellcheck: false });
    el.addEventListener('input', () => {
      markInvalid();
      saveSoon();
    });
    el.addEventListener('change', save);
    return el;
  }

  function markInvalid() {
    for (const el of $('hosts').querySelectorAll('input.host')) {
      el.classList.toggle('invalid', el.value.trim() !== '' && !NS.isValidHost(el.value.trim()));
    }
  }
})();
