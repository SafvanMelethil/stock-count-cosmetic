/* Stock Count (Google Sheets edition) – scanner app + shared helpers. No build step required. */
'use strict';

// =====================================================================
// Shared helpers
// =====================================================================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtQty = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const normBc = (b) => String(b == null ? '' : b).trim().replace(/\s+/g, '').replace(/^0+/, '');
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2));
const isTouch = () => matchMedia('(pointer: coarse)').matches;
// Device storage, kept separate per app link (e.g. /stock-count/ and /stock-count-cosmetic/ never mix).
const STORE_NS = '@' + location.pathname.replace(/[^/]*$/, '');
const store = {
  key(k) { return k === 'sc_api_override' ? k : k + STORE_NS; },
  get(k, d) {
    try {
      let v = localStorage.getItem(this.key(k));
      if (v == null && k !== 'sc_api_override') v = localStorage.getItem(k); // data saved by the earlier version
      return v == null ? d : JSON.parse(v);
    } catch (_) { return d; }
  },
  set(k, v) { try { localStorage.setItem(this.key(k), JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(this.key(k)); localStorage.removeItem(k); } catch (_) {} },
};
function utcToDate(s) { return s ? new Date(String(s).replace(' ', 'T') + 'Z') : null; }
function fmtTime(s) {
  const d = utcToDate(s); if (!d) return '—';
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function ago(s) {
  const d = utcToDate(s); if (!d) return 'never';
  const sec = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  if (sec < 3600) return Math.round(sec / 60) + ' min ago';
  if (sec < 86400) return Math.round(sec / 3600) + ' h ago';
  return fmtTime(s);
}

const I = {
  logo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 5v14M7 5v14M10 5v14M14 5v14M16.5 5v14M20 5v14"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M15 8l2 2"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22V4M4 4h13l-2 4 2 4H4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  merge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v6a6 6 0 0 0 6 6h6M15 12l3 3-3 3M6 21v-4"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  reopen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
};

// ---------- API (Google Apps Script web app) ----------
class ApiError extends Error { constructor(code, msg) { super(msg); this.code = code; this.status = code === 0 ? 0 : 400; } }
const API_URL = (() => {
  try { const q = new URLSearchParams(location.search).get('api'); if (q) { store.set('sc_api_override', q); return q; } } catch (_) {}
  return store.get('sc_api_override', null) || window.STOCK_COUNT_API || '';
})();
const apiConfigured = () => /^https:\/\/script\.google(usercontent)?\.com\//.test(API_URL) || /^http:\/\/localhost/.test(API_URL);
/** POST {action,...} as text/plain (a "simple" CORS request – no preflight). */
async function api(action, data = {}, opts = {}) {
  let res, json;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 45000);
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ ...data, action, token: App.token || undefined }), redirect: 'follow', signal: ctl.signal, cache: 'no-store' });
    json = await res.json();
  } catch (e) { throw new ApiError(0, 'No connection to the server. Check the network – your scans are kept on this device.'); }
  finally { clearTimeout(timer); }
  if (!json || json.ok !== true) {
    const code = (json && json.code) || 'error';
    if (code === 'auth' && !opts.noAuthRedirect && App.user) { App.clearSession(); toast((json && json.error) || 'Please log in again.', 'warn'); App.showLogin(); }
    throw new ApiError(code, (json && json.error) || 'Request failed');
  }
  return json;
}

// ---------- master data (cached on the device, refreshed when it changes) ----------
const Master = {
  items: [], byBarcode: new Map(), byMat: new Map(), loaded: false, rev: -1,
  build(rows) {
    const map = new Map();
    for (const [w, m, d, zone, bin, bc] of rows) {
      const k = `${w}|${m}`;
      let it = map.get(k);
      if (!it) { it = { w, m, d, b: [], l: [] }; map.set(k, it); }
      if (bc && !it.b.includes(bc)) it.b.push(bc);
      if (!it.l.some((x) => x.zone === zone && x.bin === bin)) it.l.push({ zone, bin });
    }
    this.items = [...map.values()].map((x) => ({ ...x, _s: (x.m + ' ' + x.d + ' ' + x.b.join(' ')).toLowerCase() }));
    this.byBarcode.clear(); this.byMat.clear();
    for (const it of this.items) {
      this.byMat.set(`${it.w}|${it.m}`, it);
      for (const b of it.b) { const k = normBc(b); const arr = this.byBarcode.get(k) || []; arr.push(it); this.byBarcode.set(k, arr); }
    }
    this.loaded = true;
  },
  loadCached() {
    const c = store.get('sc_master', null);
    if (c && c.rows) { this.build(c.rows); this.rev = c.rev; return true; }
    return false;
  },
  async load(force) {
    const r = await api('master');
    if (force || r.masterRev !== this.rev || !this.loaded) {
      this.build(r.rows); this.rev = r.masterRev;
      store.set('sc_master', { rev: r.masterRev, rows: r.rows });
    }
  },
  async ensureFresh(masterRev) { if (masterRev !== undefined && masterRev !== this.rev) await this.load(true); },
  get(wh, m) { return this.byMat.get(`${wh}|${m}`) || null; },
  any(m, wh) { return this.get(wh, m) || this.items.find((i) => i.m === m) || null; },
  lookup(code, wh) {
    const c = String(code || '').trim();
    if (!c) return null;
    const hits = this.byBarcode.get(normBc(c)) || [];
    const hit = hits.find((h) => h.w === wh) || hits[0];
    if (hit) return hit;
    return this.byMat.get(`${wh}|${c}`) || this.items.find((i) => i.m === c) || null;
  },
  search(q, wh, limit = 60) {
    q = String(q || '').trim().toLowerCase();
    if (!q) return [];
    const toks = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const it of this.items) {
      if (!toks.every((t) => it._s.includes(t))) continue;
      let score = 0;
      if (it.m === q) score += 100; else if (it.m.startsWith(q)) score += 50;
      if (it.b.some((b) => b === q || normBc(b) === normBc(q))) score += 100;
      if (it.d.toLowerCase().startsWith(q)) score += 20;
      if (it.w === wh) score += 10;
      out.push([score, it]);
    }
    out.sort((a, b) => b[0] - a[0] || a[1].d.localeCompare(b[1].d));
    return out.slice(0, limit).map((x) => x[1]);
  },
  locText(it) { return it.l.map((l) => (l.bin ? `${l.zone} / ${l.bin}` : l.zone)).join('; '); },
  /** Location check: where the item was counted (wh/zone/bin) vs master. */
  check(it, wh, zone, bin) {
    if (!it) return { code: 'UNKNOWN', label: 'Not in master data', correct: '' };
    if (it.w !== wh) {
      const own = this.get(wh, it.m);
      if (!own) return { code: 'OTHER_WH', label: `Wrong warehouse – belongs to WH ${it.w}`, correct: `WH ${it.w}: ` + this.locText(it) };
      it = own;
    }
    const inZone = it.l.filter((l) => l.zone === zone);
    if (!inZone.length) return { code: 'WRONG_ZONE', label: 'Wrong location', correct: this.locText(it) };
    const b = String(bin || '').trim().toUpperCase();
    if (b && !inZone.some((l) => l.bin === b)) return { code: 'WRONG_BIN', label: 'Wrong bin', correct: this.locText(it) };
    return { code: 'OK', label: 'Correct location', correct: this.locText(it) };
  },
  /** Location check for a saved line. */
  lineLoc(l, wh, zone) { return l.material ? this.check(this.any(l.material, wh), wh, zone, l.bin) : this.check(null); },
};

function toast(msg, type = '', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = (type === 'ok' ? I.check : type === 'bad' || type === 'warn' ? I.alert : '') + `<div>${esc(msg)}</div>`;
  const box = $('#toasts'); box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}
function beep(ok = true) {
  try {
    const ctx = beep.ctx || (beep.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = ok ? 1250 : 260; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
  } catch (_) {}
  if (!ok && navigator.vibrate) navigator.vibrate([80, 60, 80]);
}

// ---------- modal ----------
const Modal = {
  stack: [],
  open(html, { onClose, wide, dismissable = true } = {}) {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    $('#modal-root').appendChild(ov);
    const m = {
      el: ov.querySelector('.sheet'), ov, closed: false,
      close: (v) => {
        if (m.closed) return; m.closed = true; ov.remove();
        Modal.stack = Modal.stack.filter((x) => x !== m);
        if (onClose) onClose(v);
      },
    };
    if (dismissable) ov.addEventListener('mousedown', (e) => { if (e.target === ov) m.close(); });
    Modal.stack.push(m);
    return m;
  },
  top() { return Modal.stack[Modal.stack.length - 1]; },
  isOpen() { return Modal.stack.length > 0; },
  closeAll() { [...Modal.stack].forEach((m) => m.close()); },
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && Modal.isOpen()) { const t = Modal.top(); if (!t.noEsc) t.close(); } });

function confirmDialog({ title, text, yes = 'Yes', no = 'No', danger = false, icon = 'alert' }) {
  return new Promise((resolve) => {
    const m = Modal.open(`
      <div class="confirm-icon ${icon === 'check' ? 'ok' : ''}">${I[icon] || I.alert}</div>
      <h2 class="center">${esc(title)}</h2>
      ${text ? `<p class="sub center">${text}</p>` : ''}
      <div class="actions"><button class="btn lg" data-no>${esc(no)}</button><button class="btn lg ${danger ? 'danger' : 'primary'}" data-yes>${esc(yes)}</button></div>`,
    { onClose: (v) => resolve(!!v) });
    $('[data-no]', m.el).onclick = () => m.close(false);
    $('[data-yes]', m.el).onclick = () => m.close(true);
    setTimeout(() => $('[data-yes]', m.el).focus(), 30);
  });
}

function downloadUrl(url) {
  const a = document.createElement('a');
  a.href = url; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
}

function hl(text, q) {
  const t = esc(text); const toks = String(q || '').trim().split(/\s+/).filter((x) => x.length > 0);
  if (!toks.length) return t;
  const re = new RegExp('(' + toks.map((x) => esc(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
  return t.replace(re, '<mark>$1</mark>');
}
function locBadge(loc, compact) {
  if (!loc) return '';
  const cls = { OK: 'ok', WRONG_ZONE: 'bad', OTHER_WH: 'bad', WRONG_BIN: 'warn', UNKNOWN: 'grey' }[loc.code] || 'grey';
  const icon = loc.code === 'OK' ? I.check : I.alert;
  let txt = loc.code === 'OK' ? (compact ? 'In place' : 'Correct location') : loc.label;
  return `<span class="badge ${cls}">${icon}${esc(txt)}</span>`;
}
const locClass = (loc) => ({ OK: '', WRONG_ZONE: 'bad', OTHER_WH: 'bad', WRONG_BIN: 'warn', UNKNOWN: 'grey' }[loc && loc.code] || 'grey');

/** Search sheet (used by scanner users and admin). Resolves with a master item or null. */
function searchDialog({ wh, title = 'Find material', initial = '' }) {
  return new Promise((resolve) => {
    const m = Modal.open(`
      <div class="sheet-head"><div><h2>${esc(title)}</h2><p class="sub">Search by material code, barcode or description.</p></div>
      <button class="btn icon ghost" data-x aria-label="Close">${I.x}</button></div>
      <input class="input lg" data-q placeholder="e.g. 300261 or Lactonic 400" autocomplete="off" enterkeyhint="search" value="${esc(initial)}">
      <div class="results" data-res></div>`, { onClose: (v) => resolve(v || null) });
    const q = $('[data-q]', m.el), res = $('[data-res]', m.el);
    let found = [];
    const run = () => {
      const v = q.value;
      found = Master.search(v, wh);
      if (!v.trim()) { res.innerHTML = '<div class="empty small">Start typing to search…</div>'; return; }
      if (!found.length) { res.innerHTML = '<div class="empty small">No material matches your search.</div>'; return; }
      res.innerHTML = found.map((it, i) => `<button class="result" data-i="${i}">
        <div class="desc">${hl(it.d, v)}</div>
        <div class="meta"><span class="mono">${hl(it.m, v)}</span><span class="mono">${hl(it.b[0] || '', v)}</span><span>WH ${esc(it.w)} · ${esc(Master.locText(it))}</span></div></button>`).join('');
    };
    q.addEventListener('input', run);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && found.length === 1) m.close(found[0]); });
    res.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) m.close(found[Number(b.dataset.i)]); });
    $('[data-x]', m.el).onclick = () => m.close(null);
    run();
    setTimeout(() => q.focus(), 50);
  });
}

/** Quantity sheet. Resolves {qty, bin} or null. */
function qtyDialog({ item, code, wh, zone, bin, existingQty, title = 'Enter quantity', unknown, showBin = true, okText = 'Add' }) {
  return new Promise((resolve) => {
    const loc = unknown ? { code: 'UNKNOWN', label: 'Not in master data' } : Master.check(item, wh, zone, bin);
    const m = Modal.open(`
      <div class="sheet-head"><h2>${esc(title)}</h2><button class="btn icon ghost" data-x aria-label="Close">${I.x}</button></div>
      <div class="item-preview">
        <div class="desc">${esc(unknown ? 'Unknown item' : item.d)}</div>
        <div class="meta">${unknown ? `<span class="mono">Barcode ${esc(code)}</span>` : `<span class="mono">Mat. ${esc(item.m)}</span><span class="mono">${esc(code || item.b[0] || '')}</span>`}</div>
        <div class="loc-line">${locBadge(loc)}${!unknown ? `<span class="badge grey">Master: ${esc(Master.locText(item))}${item.w !== wh ? ' (WH ' + esc(item.w) + ')' : ''}</span>` : ''}
        ${existingQty ? `<span class="badge blue">Already counted: ${fmtQty(existingQty)}</span>` : ''}</div>
      </div>
      ${unknown ? `<div class="field"><label class="lbl">Description (optional)</label><input class="input" data-desc placeholder="What is it? e.g. Brand, size" maxlength="80"></div>` : ''}
      <label class="lbl">Quantity</label>
      <div class="qty-stepper">
        <button class="btn" data-minus aria-label="Minus">−</button>
        <input class="input num" data-qty inputmode="decimal" enterkeyhint="done" autocomplete="off" value="1">
        <button class="btn" data-plus aria-label="Plus">+</button>
      </div>
      ${showBin ? `<div class="field" style="margin-top:14px"><label class="lbl">Bin (optional)</label><input class="input" data-bin placeholder="e.g. R01-001" value="${esc(bin || '')}" autocomplete="off" style="text-transform:uppercase"></div>` : ''}
      <div class="err" data-err></div>
      <div class="actions"><button class="btn lg" data-cancel>Cancel</button><button class="btn lg primary" data-ok>${esc(okText)}</button></div>`,
    { onClose: (v) => resolve(v || null) });
    const qi = $('[data-qty]', m.el), err = $('[data-err]', m.el);
    const val = () => Number(String(qi.value).replace(',', '.'));
    const step = (d) => { const v = Math.max(1, (val() || 0) + d); qi.value = String(v); qi.focus(); };
    $('[data-minus]', m.el).onclick = () => step(-1);
    $('[data-plus]', m.el).onclick = () => step(1);
    $('[data-x]', m.el).onclick = () => m.close(null);
    $('[data-cancel]', m.el).onclick = () => m.close(null);
    const submit = () => {
      const raw = String(qi.value).trim();
      if (/^\d{7,}$/.test(raw)) { err.textContent = 'That looks like a barcode, not a quantity. Type the quantity and press Add.'; qi.value = '1'; qi.select(); beep(false); return; }
      const q = val();
      if (!Number.isFinite(q) || q <= 0) { err.textContent = 'Enter a quantity greater than 0.'; qi.select(); return; }
      if (q > 99999) { err.textContent = 'Quantity is too large (max 99,999).'; qi.select(); return; }
      const binEl = $('[data-bin]', m.el), descEl = $('[data-desc]', m.el);
      m.close({ qty: Math.round(q * 1000) / 1000, bin: binEl ? binEl.value.trim().toUpperCase() : bin, desc: descEl ? descEl.value.trim() : '' });
    };
    $('[data-ok]', m.el).onclick = submit;
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); submit(); } });
    setTimeout(() => { qi.focus(); qi.select(); }, 60);
  });
}

/** Camera barcode scanner. Resolves with the decoded text or null. */
function cameraDialog() {
  return new Promise((resolve) => {
    if (!window.isSecureContext) {
      const m = Modal.open(`<div class="confirm-icon">${I.camera}</div><h2 class="center">Camera needs a secure link</h2>
        <p class="sub center">Phone browsers only allow the camera on an <b>https://</b> link. Open the app from its GitHub Pages link (https). A handheld scanner works on any link.</p>
        <div class="actions"><button class="btn lg" data-c>Close</button></div>`, { onClose: () => resolve(null) });
      $('[data-c]', m.el).onclick = () => m.close();
      return;
    }
    if (!window.Html5Qrcode) { toast('Camera library not loaded. Refresh the page.', 'bad'); resolve(null); return; }
    let scanner = null, done = false;
    const m = Modal.open(`<div class="sheet-head"><div><h2>Scan with camera</h2><p class="sub">Point the camera at the barcode.</p></div>
      <button class="btn icon ghost" data-x aria-label="Close">${I.x}</button></div>
      <div id="reader"></div><div class="err" data-err></div>
      <div class="actions"><button class="btn lg" data-c>Cancel</button></div>`,
    { onClose: (v) => { done = true; if (scanner) { scanner.stop().catch(() => {}).finally(() => { try { scanner.clear(); } catch (_) {} }); } resolve(v || null); } });
    $('[data-x]', m.el).onclick = () => m.close(null);
    $('[data-c]', m.el).onclick = () => m.close(null);
    const F = window.Html5QrcodeSupportedFormats;
    scanner = new Html5Qrcode('reader', {
      verbose: false,
      formatsToSupport: [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE, F.DATA_MATRIX],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    scanner.start({ facingMode: 'environment' }, { fps: 12, qrbox: (w, h) => ({ width: Math.min(w * 0.9, 340), height: Math.min(h * 0.5, 170) }), aspectRatio: 1.333 },
      (text) => { if (done) return; done = true; m.close(text); }, () => {})
      .catch((e) => { $('[data-err]', m.el).textContent = 'Could not open the camera: ' + (e && e.message ? e.message : e) + '. Allow camera access in the browser settings.'; });
  });
}
// =====================================================================
// App shell & login
// =====================================================================
const App = {
  user: null, token: null,
  setSession(token, user) { this.token = token; this.user = user; store.set('sc_session', { token, user }); },
  clearSession() { this.token = null; this.user = null; store.del('sc_session'); },
  async boot() {
    if (window.STOCK_COUNT_NAME) document.title = 'Stock Count · ' + window.STOCK_COUNT_NAME;
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
    if (!apiConfigured()) return this.showSetupNeeded();
    const s = store.get('sc_session', null);
    if (s && s.token && s.user) {
      this.token = s.token; this.user = s.user;
      this.route();
      api('me', {}, { noAuthRedirect: true }).then((r) => { this.user = r.user; store.set('sc_session', { token: this.token, user: r.user }); })
        .catch((e) => { if (e.code === 'auth') { this.clearSession(); Scanner.stop(); if (window.Admin) window.Admin.stop(); Modal.closeAll(); toast('Please log in again.', 'warn'); this.showLogin(); } });
      return;
    }
    this.showLogin();
  },
  showSetupNeeded() {
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="brand"><div class="brand-mark">${I.logo}</div><div><h1>Stock Count</h1><p>Setup needed</p></div></div>
      <p>The app is not connected to its Google Sheet yet. Open <b>config.js</b> and paste the Apps Script <b>Web App URL</b> (ending in <span class="mono">/exec</span>), then reload. See README step 2.</p></div></div>`;
  },
  route() {
    if (!this.user) return this.showLogin();
    if (this.user.role === 'admin') {
      if (this.user.mustChangePin) return changePinDialog(true).then((ok) => { if (ok) { this.user.mustChangePin = false; this.route(); } });
      return window.Admin.start();
    }
    return Scanner.start();
  },
  async logout() {
    Scanner.stop(); if (window.Admin) window.Admin.stop();
    this.clearSession(); Modal.closeAll();
    this.showLogin();
  },
  async showLogin() {
    Scanner.stop(); if (window.Admin) window.Admin.stop();
    $('#app').innerHTML = `<div class="login-wrap"><div class="login-card"><div class="boot" style="min-height:200px"><div class="spinner"></div></div></div></div>`;
    let opts = null;
    try { opts = (await api('loginOptions', {}, { noAuthRedirect: true })).warehouses; }
    catch (e) {
      $('#app').innerHTML = `<div class="login-wrap"><div class="login-card center"><div class="confirm-icon">${I.alert}</div><h2>Cannot reach the server</h2>
        <p class="muted">${esc(e.message)}</p><button class="btn primary lg block" data-retry>Try again</button></div></div>`;
      $('[data-retry]').onclick = () => this.showLogin();
      return;
    }
    const last = store.get('sc_last_user', null);
    let mode = last === 'admin' ? 'admin' : 'user';
    let wh = (last && last !== 'admin' && last.split('-')[0]) || (opts[0] && opts[0].code);
    let picked = last && last !== 'admin' ? last : null;
    const render = () => {
      const w = opts.find((o) => o.code === wh) || opts[0];
      const hasUsers = opts.some((o) => o.zones.length);
      $('#app').innerHTML = `
      <div class="login-wrap"><form class="login-card" autocomplete="off">
        <div class="brand"><div class="brand-mark">${I.logo}</div><div><h1>Stock Count${window.STOCK_COUNT_NAME ? ' · ' + esc(window.STOCK_COUNT_NAME) : ''}</h1><p>Warehouse scanning &amp; reconciliation</p></div></div>
        <div class="seg"><button type="button" data-mode="user" class="${mode === 'user' ? 'on' : ''}">Scanner user</button><button type="button" data-mode="admin" class="${mode === 'admin' ? 'on' : ''}">Admin</button></div>
        ${mode === 'user' ? `
          <label class="lbl">Warehouse</label>
          <div class="wh-pick">${opts.map((o) => `<button type="button" data-wh="${esc(o.code)}" class="${o.code === wh ? 'on' : ''}"><b>${esc(o.name)}</b><span>WH ${esc(o.code)}</span></button>`).join('')}</div>
          <label class="lbl">Your device / user</label>
          <div class="user-grid">${w && w.zones.length ? w.zones.map((z) => `<div class="zone-h">Zone ${esc(z.zone)}</div>` + z.users.map((u) => `<button type="button" data-u="${esc(u.username)}" class="${picked === u.username ? 'on' : ''}">${esc(u.display)}</button>`).join('')).join('')
            : `<p class="muted" style="grid-column:1/-1">${hasUsers ? 'No users for this warehouse.' : 'No users yet – the admin must upload the master data first.'}</p>`}</div>
          <div class="field"><label class="lbl">PIN</label><input class="input lg pin-input" name="pin" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="••••"></div>`
        : `<div class="field"><label class="lbl">Username</label><input class="input lg" name="username" value="admin" autocomplete="username"></div>
           <div class="field"><label class="lbl">Password</label><input class="input lg" name="pin" type="password" autocomplete="current-password"></div>`}
        <div class="err" data-err></div>
        <button class="btn primary lg block" type="submit" style="margin-top:6px">Log in</button>
      </form></div>`;
      const f = $('form');
      $$('[data-mode]', f).forEach((b) => (b.onclick = () => { mode = b.dataset.mode; render(); }));
      $$('[data-wh]', f).forEach((b) => (b.onclick = () => { wh = b.dataset.wh; picked = null; render(); }));
      $$('[data-u]', f).forEach((b) => (b.onclick = () => { picked = b.dataset.u; $$('[data-u]', f).forEach((x) => x.classList.toggle('on', x === b)); f.pin.focus(); }));
      f.onsubmit = async (e) => {
        e.preventDefault();
        const err = $('[data-err]', f);
        const username = mode === 'admin' ? f.username.value.trim() : picked;
        if (!username) { err.textContent = 'Select your user first.'; return; }
        if (!f.pin.value) { err.textContent = 'Enter your ' + (mode === 'admin' ? 'password' : 'PIN') + '.'; f.pin.focus(); return; }
        const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Logging in…'; err.textContent = '';
        try {
          const r = await api('login', { username, pin: f.pin.value }, { noAuthRedirect: true });
          store.set('sc_last_user', mode === 'admin' ? 'admin' : r.user.username);
          this.setSession(r.token, r.user); this.route();
        } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Log in'; f.pin.select(); }
      };
      setTimeout(() => { if (mode === 'admin') f.pin.focus(); else if (picked && !isTouch()) f.pin.focus(); }, 30);
    };
    render();
  },
};

function changePinDialog(forced) {
  const isAdmin = App.user && App.user.role === 'admin';
  const word = isAdmin ? 'password' : 'PIN';
  return new Promise((resolve) => {
    const m = Modal.open(`
      <h2>${forced ? 'Set a new admin password' : 'Change ' + word}</h2>
      <p class="sub">${forced ? 'You are using the default password. Please choose a new one (at least 6 characters) to protect the admin area.' : isAdmin ? 'At least 6 characters.' : '4 to 8 digits.'}</p>
      <div class="field"><label class="lbl">Current ${word}</label><input class="input" type="password" data-cur ${isAdmin ? '' : 'inputmode="numeric"'}></div>
      <div class="field"><label class="lbl">New ${word}</label><input class="input" type="password" data-new ${isAdmin ? '' : 'inputmode="numeric"'}></div>
      <div class="field"><label class="lbl">Repeat new ${word}</label><input class="input" type="password" data-rep ${isAdmin ? '' : 'inputmode="numeric"'}></div>
      <div class="err" data-err></div>
      <div class="actions">${forced ? `<button class="btn lg" data-out>Log out</button>` : `<button class="btn lg" data-c>Cancel</button>`}<button class="btn lg primary" data-ok>Save</button></div>`,
    { onClose: (v) => resolve(v), dismissable: !forced });
    if (forced) m.noEsc = true;
    const err = $('[data-err]', m.el);
    if ($('[data-c]', m.el)) $('[data-c]', m.el).onclick = () => m.close(false);
    if ($('[data-out]', m.el)) $('[data-out]', m.el).onclick = () => { m.close(false); App.logout(); };
    $('[data-ok]', m.el).onclick = async () => {
      const cur = $('[data-cur]', m.el).value, nw = $('[data-new]', m.el).value, rep = $('[data-rep]', m.el).value;
      if (nw !== rep) { err.textContent = 'The new ' + word + 's do not match.'; return; }
      try { const r = await api('changePin', { current: cur, next: nw }); App.setSession(r.token, r.user); toast(word[0].toUpperCase() + word.slice(1) + ' changed.', 'ok'); m.close(true); }
      catch (e) { err.textContent = e.message; }
    };
    setTimeout(() => $('[data-cur]', m.el).focus(), 40);
  });
}


// =====================================================================
// Scanner (users)  – offline-safe queue, never loses a scan
// =====================================================================
const Scanner = {
  task: null, lines: [], history: [], outbox: [], rev: -1, myRev: -1, flushing: false, online: true, timers: [], filter: '', flashId: null, active: false, failed: [],
  key(k) { return `sc_${k}_${App.user.username}`; },
  saveState() { store.set(this.key('state'), { task: this.task, lines: this.lines, history: this.history, rev: this.rev, myRev: this.myRev }); },
  saveOutbox() { store.set(this.key('outbox'), this.outbox); },
  async start() {
    this.active = true;
    this.outbox = store.get(this.key('outbox'), []);
    this.failed = store.get(this.key('failed'), []);
    const cached = store.get(this.key('state'), null);
    if (cached) Object.assign(this, { task: cached.task, lines: cached.lines || [], history: cached.history || [], rev: cached.rev, myRev: cached.myRev });
    Master.loadCached();
    if (cached && Master.loaded) this.render(); else $('#app').innerHTML = `<div class="boot"><div class="spinner"></div></div>`;
    try { await Master.load(); } catch (e) { if (!Master.loaded) toast('Could not load master data: ' + e.message, 'bad', 5000); }
    await this.refresh(true);
    this.flush();
    this.timers.forEach(clearInterval);
    this.timers = [
      setInterval(() => { if (this.outbox.length) this.flush(); }, 4000),
      setInterval(() => this.checkRev(), 15000),
    ];
    if (!this._wired) {
      this._wired = true;
      window.addEventListener('online', () => { if (this.active) this.flush(); });
      document.addEventListener('visibilitychange', () => { if (this.active && document.visibilityState === 'visible') { this.flush(); this.checkRev(); } });
      document.addEventListener('keydown', (e) => this.globalKey(e), true);
      window.addEventListener('beforeunload', (e) => { if (this.active && this.outbox.length) { e.preventDefault(); e.returnValue = ''; } });
    }
  },
  stop() { this.active = false; this.timers.forEach(clearInterval); this.timers = []; },
  async checkRev() {
    if (!this.active || this.flushing || Modal.isOpen() || document.visibilityState !== 'visible') return;
    try {
      const r = await api('rev');
      this.online = true;
      if (r.masterRev !== Master.rev) Master.load(true).catch(() => {});
      if (r.myRev !== this.myRev) await this.refresh();
    } catch (e) { if (e.code === 0) { this.online = false; this.renderSync(); } }
  },
  async refresh(first) {
    try {
      const r = await api('myState');
      this.online = true;
      const prevTask = this.task;
      Object.assign(this, { task: r.openTask, lines: r.lines, history: r.history, rev: r.rev, myRev: r.myRev });
      this.saveState();
      if (prevTask && !this.task && !first) toast('Your task was closed by the admin.', 'warn', 4000);
      await this.reconcileOutbox();
      if (!Modal.isOpen() || first) this.render(); else this.renderListOnly();
    } catch (e) {
      if (e.code === 0) { this.online = false; if (first) this.render(); else this.renderSync(); }
    }
  },
  /** Scans waiting for a task that is no longer open are moved to the user's open task – never dropped. */
  async reconcileOutbox() {
    const stale = this.outbox.filter((o) => !this.task || o.taskId !== this.task.taskId);
    if (!stale.length) return;
    if (!this.task) {
      try { const r = await api('startTask'); this.task = r.task; this.lines = r.lines; this.saveState(); } catch (e) { return; }
      toast(`Task #${this.task.taskNo} was started to keep ${stale.length} unsynced scan(s).`, 'warn', 6000);
    }
    stale.forEach((o) => { o.taskId = this.task.taskId; });
    this.saveOutbox();
  },
  // ---------- rendering ----------
  render() {
    if (!this.active) return;
    const u = App.user;
    const head = `<div class="topbar">
      <div class="grow"><div class="t1">${esc(u.display)} · ${esc(u.whName || '')} ${esc(u.wh)}</div><div class="t2">Zone ${esc(u.zone)}${this.task ? ` · Task #${this.task.taskNo}` : ''}</div></div>
      <span class="sync" data-sync><span class="dot"></span><span data-sync-t>Online</span></span>
      <button class="btn icon ghost" data-menu aria-label="Menu">${I.user}</button></div>`;
    if (!this.task) {
      $('#app').innerHTML = head + `<div class="container">
        ${this.outbox.length ? `<div class="banner">${I.alert}<div>${this.outbox.length} scan(s) are waiting to be saved. They will be saved automatically.</div></div>` : ''}
        <div class="card center" style="padding:28px 18px">
          <div class="confirm-icon ok">${I.logo}</div>
          <h2 style="font-size:20px">Ready to count</h2>
          <p class="muted" style="margin:4px 0 18px">Start a new scan for Zone ${esc(u.zone)}. Every item you scan is added to your list – even items that belong to another zone.</p>
          <button class="btn primary lg block" data-start>${I.plus} Start New Scan</button>
        </div>
        <div class="list-head"><h3>Submitted tasks</h3></div>
        <div class="items">${this.history.length ? this.history.map((t) => `<div class="item grey" data-hist="${esc(t.taskId)}" style="border-left-color:var(--accent)">
            <div class="grow"><div class="desc">Task #${t.taskNo}</div><div class="meta"><span>Submitted ${esc(t.submittedAt)}</span><span>${t.lineCount} item(s)</span></div></div>
            <div class="qty"><b>${fmtQty(t.totalQty)}</b><span>Qty</span></div></div>`).join('')
          : `<div class="card empty">No submitted tasks yet.</div>`}</div>
      </div>`;
      $('[data-start]').onclick = () => this.startTask();
      $$('[data-hist]').forEach((el) => (el.onclick = () => toast('Submitted tasks are read-only. Ask the admin for changes or the Excel.', '', 3500)));
    } else {
      const bin = store.get(this.key('bin'), '');
      $('#app').innerHTML = head + `<div class="container">
        <div class="taskbar">
          <div class="stat"><div class="k">Items</div><div class="v" data-s-lines>0</div></div>
          <div class="stat"><div class="k">Total qty</div><div class="v" data-s-qty>0</div></div>
          <div class="stat"><div class="k">Wrong loc.</div><div class="v" data-s-exc>0</div></div>
        </div>
        <form class="scanbox" data-scanform autocomplete="off">
          <div class="row">
            <input class="input scan-input grow" data-scan placeholder="Scan or type barcode / material" enterkeyhint="go" autocomplete="off" autocapitalize="off" spellcheck="false" ${store.get('sc_kbd_off', false) ? 'inputmode="none"' : ''}>
            <button type="button" class="btn icon lg dark" data-cam aria-label="Scan with camera" title="Camera">${I.camera}</button>
            <button type="button" class="btn icon lg" data-find aria-label="Search material" title="Search">${I.search}</button>
          </div>
          <div class="scan-hint">
            <label class="bin-chip ${bin ? 'set' : ''}">Bin <input data-bin value="${esc(bin)}" placeholder="optional" maxlength="20"></label>
            <button type="button" class="btn sm ghost" data-kbd title="Show / hide on-screen keyboard for the scan box">${I.keyboard}<span>${store.get('sc_kbd_off', false) ? 'Keyboard off' : 'Keyboard on'}</span></button>
          </div>
        </form>
        <div class="list-head"><h3>Scanned items</h3><input class="input" data-filter placeholder="Filter list…" style="max-width:180px;min-height:36px" value="${esc(this.filter)}"></div>
        <div class="items" data-list></div>
      </div>
      <div class="bottombar"><div class="inner"><button class="btn danger lg block" data-end>${I.flag} End Scan</button></div></div>`;
      const form = $('[data-scanform]'), inp = $('[data-scan]');
      form.onsubmit = (e) => { e.preventDefault(); const v = inp.value; inp.value = ''; this.handleCode(v); };
      inp.addEventListener('keydown', (e) => {
        if ((e.key === 'Enter' || (e.key === 'Tab' && inp.value.trim())) && !e.isComposing) { e.preventDefault(); const v = inp.value; inp.value = ''; this.handleCode(v); }
      });
      inp.addEventListener('focus', () => form.classList.add('focus'));
      inp.addEventListener('blur', () => form.classList.remove('focus'));
      $('[data-cam]').onclick = async () => { const code = await cameraDialog(); if (code) this.handleCode(code); };
      $('[data-find]').onclick = () => this.manualSearch(inp.value);
      const binIn = $('[data-bin]');
      binIn.addEventListener('input', () => { const v = binIn.value.toUpperCase(); store.set(this.key('bin'), v.trim()); binIn.closest('.bin-chip').classList.toggle('set', !!v.trim()); });
      binIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); binIn.blur(); this.focusScan(); } });
      $('[data-kbd]').onclick = () => { store.set('sc_kbd_off', !store.get('sc_kbd_off', false)); this.render(); this.focusScan(true); };
      $('[data-filter]').addEventListener('input', (e) => { this.filter = e.target.value; this.renderListOnly(); });
      $('[data-end]').onclick = () => this.endScan();
      this.renderListOnly();
      this.focusScan();
    }
    $('[data-menu]').onclick = () => this.menu();
    this.renderSync();
  },
  decorated() { const u = App.user; return this.lines.filter((l) => l.qty > 0).map((l) => ({ ...l, loc: Master.lineLoc(l, u.wh, u.zone) })); },
  renderListOnly() {
    const list = $('[data-list]');
    if (!list || !this.task) return;
    const pend = this.outbox.filter((o) => o.taskId === this.task.taskId);
    const lines = this.decorated().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '') || String(b.key || b.lineId).localeCompare(String(a.key || a.lineId)));
    const f = this.filter.trim().toLowerCase();
    const match = (l) => !f || [l.description, l.material, l.barcode].some((x) => String(x || '').toLowerCase().includes(f));
    const pendHtml = pend.filter((o) => match({ description: o.desc, material: o.material, barcode: o.code })).slice().reverse().map((o) => `<div class="item pending">
        <div class="grow"><div class="desc">${esc(o.desc)}</div><div class="meta"><span class="mono">${esc(o.material || o.code)}</span><span class="badge grey">Saving…</span></div></div>
        <div class="qty"><b>+${fmtQty(o.qty)}</b><span>Qty</span></div></div>`).join('');
    const rows = lines.filter(match).map((l) => `<div class="item ${locClass(l.loc)} ${this.flashId === (l.key || l.lineId) ? 'flash' : ''}" data-line="${esc(l.key || l.lineId)}">
        <div class="grow"><div class="desc">${esc(l.description)}</div>
          <div class="meta"><span class="mono">${esc(l.material || '—')}</span><span class="mono">${esc(l.barcode || '')}</span>${l.bin ? `<span>Bin ${esc(l.bin)}</span>` : ''}</div>
          <div class="meta">${locBadge(l.loc, true)}${l.loc.code !== 'OK' && l.loc.correct ? `<span>Should be: <b>${esc(l.loc.correct)}</b></span>` : ''}</div></div>
        <div class="qty"><b>${fmtQty(l.qty)}</b><span>Qty</span></div></div>`).join('');
    list.innerHTML = pendHtml + rows || `<div class="card empty">${I.box}<div>${f ? 'No items match the filter.' : 'No items yet. Scan your first barcode.'}</div></div>`;
    $$('[data-line]', list).forEach((el) => (el.onclick = () => this.editLine(el.dataset.line)));
    this.flashId = null;
    const qty = lines.reduce((s, l) => s + l.qty, 0) + pend.reduce((s, o) => s + o.qty, 0);
    $('[data-s-lines]').textContent = fmtQty(lines.length);
    $('[data-s-qty]').textContent = fmtQty(qty);
    const ex = lines.filter((l) => l.loc.code !== 'OK').length;
    const exEl = $('[data-s-exc]'); exEl.textContent = ex; exEl.style.color = ex ? 'var(--bad)' : '';
    this.renderSync();
  },
  renderSync() {
    const el = $('[data-sync]'); if (!el) return;
    const n = this.outbox.length;
    el.className = 'sync' + (!this.online ? ' offline' : n ? ' pending' : '');
    $('[data-sync-t]', el).textContent = !this.online ? (n ? `Offline · ${n} waiting` : 'Offline') : n ? `Saving ${n}…` : 'Saved';
  },
  focusScan(force) {
    const inp = $('[data-scan]');
    if (!inp || Modal.isOpen()) return;
    if (force || !isTouch() || store.get('sc_kbd_off', false)) inp.focus({ preventScroll: true });
  },
  globalKey(e) {
    if (!this.active || !this.task || Modal.isOpen()) return;
    const inp = $('[data-scan]'); if (!inp) return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter') { if (inp.value.trim()) { e.preventDefault(); const v = inp.value; inp.value = ''; this.handleCode(v); } return; }
    if (e.key.length === 1) { e.preventDefault(); inp.value += e.key; }
  },
  menu() {
    const m = Modal.open(`<h2>${esc(App.user.display)}</h2><p class="sub">WH ${esc(App.user.wh)} ${esc(App.user.whName || '')} · Zone ${esc(App.user.zone)}</p>
      <div style="display:grid;gap:8px">
        <button class="btn lg block" data-pin>${I.key} Change PIN</button>
        <button class="btn lg block" data-reload>${I.refresh} Refresh data</button>
        <button class="btn lg block" data-backup>${I.download} Backup unsaved scans (${this.outbox.length})</button>
        <button class="btn lg block danger-ghost" data-out>${I.logout} Log out</button>
      </div><div class="actions"><button class="btn lg" data-c>Close</button></div>`);
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-pin]', m.el).onclick = () => { m.close(); changePinDialog(false); };
    $('[data-backup]', m.el).onclick = () => { m.close(); this.downloadBackup(); };
    $('[data-reload]', m.el).onclick = async () => { m.close(); try { await Master.load(true); await this.refresh(); toast('Data refreshed.', 'ok'); } catch (e) { toast(e.message, 'bad'); } };
    $('[data-out]', m.el).onclick = async () => {
      m.close();
      if (this.outbox.length && !(await confirmDialog({ title: 'Scans not saved yet', text: `${this.outbox.length} scan(s) have not reached the server. They stay on this device and are saved when you log in again on this device.`, yes: 'Log out anyway', no: 'Stay', danger: true }))) return;
      App.logout();
    };
  },
  // ---------- actions ----------
  async startTask() {
    try { const r = await api('startTask'); this.task = r.task; this.lines = r.lines; this.filter = ''; this.saveState(); this.render(); toast(`Task #${r.task.taskNo} started. Start scanning.`, 'ok'); }
    catch (e) { toast(e.message, 'bad'); }
  },
  existingQty(material, bin) {
    const b = String(bin || '').toUpperCase();
    return this.lines.filter((l) => l.material === material && (l.bin || '') === b).reduce((s, l) => s + l.qty, 0)
      + this.outbox.filter((o) => o.material === material && (o.bin || '') === b).reduce((s, o) => s + o.qty, 0);
  },
  async handleCode(raw) {
    const code = String(raw || '').trim();
    if (!code || !this.task) return;
    if (this._busy) return; this._busy = true;
    try {
      const item = Master.lookup(code, App.user.wh);
      if (!item) { beep(false); await this.notFound(code); return; }
      beep(true);
      await this.askQtyAndAdd(item, code);
    } finally { this._busy = false; this.focusScan(); }
  },
  async askQtyAndAdd(item, code) {
    const bin = store.get(this.key('bin'), '');
    const r = await qtyDialog({ item, code, wh: App.user.wh, zone: App.user.zone, bin, existingQty: this.existingQty(item.m, bin) });
    if (!r) return;
    if (r.bin !== bin) { store.set(this.key('bin'), r.bin); const bi = $('[data-bin]'); if (bi) { bi.value = r.bin; bi.closest('.bin-chip').classList.toggle('set', !!r.bin); } }
    this.enqueue({ material: item.m, code, qty: r.qty, bin: r.bin, desc: item.d });
    const loc = Master.check(item, App.user.wh, App.user.zone, r.bin);
    toast(`${loc.code === 'OK' ? 'Added' : 'Added (' + loc.label.toLowerCase() + ')'}: ${fmtQty(r.qty)} × ${item.d}`, loc.code === 'OK' ? 'ok' : 'warn', 2200);
  },
  async notFound(code) {
    const choice = await new Promise((resolve) => {
      const m = Modal.open(`<div class="confirm-icon">${I.alert}</div><h2 class="center">Item not found</h2>
        <p class="sub center">Barcode / code <b class="mono">${esc(code)}</b> is not in the master data.</p>
        <div style="display:grid;gap:8px">
          <button class="btn primary lg block" data-s>${I.search} Search material manually</button>
          <button class="btn lg block" data-u>${I.plus} Add as unknown item</button>
          <button class="btn lg block ghost" data-c>Cancel</button></div>`, { onClose: (v) => resolve(v || null) });
      $('[data-s]', m.el).onclick = () => m.close('search');
      $('[data-u]', m.el).onclick = () => m.close('unknown');
      $('[data-c]', m.el).onclick = () => m.close(null);
    });
    if (choice === 'search') return this.manualSearch(/^\d{6,}$/.test(code) ? '' : code);
    if (choice === 'unknown') {
      const bin = store.get(this.key('bin'), '');
      const r = await qtyDialog({ unknown: true, code, wh: App.user.wh, zone: App.user.zone, bin, title: 'Add unknown item' });
      if (!r) return;
      this.enqueue({ material: null, code, qty: r.qty, bin: r.bin, unknownDesc: r.desc || true, desc: 'UNKNOWN ITEM' + (r.desc ? ' – ' + r.desc : '') });
      toast('Unknown item added – the admin will review it.', 'warn');
    }
  },
  async manualSearch(initial) {
    const inp = $('[data-scan]'); if (inp) inp.value = '';
    const it = await searchDialog({ wh: App.user.wh, initial: initial || '' });
    if (it) await this.askQtyAndAdd(it, it.b[0] || '');
    this.focusScan();
  },
  enqueue(o) {
    this.outbox.push({ clientId: uid(), taskId: this.task.taskId, at: Date.now(), ...o });
    this.saveOutbox();               // saved on the device BEFORE sending → survives reloads / crashes
    this.renderListOnly();
    this.flush();
  },
  async flush() {
    if (this.flushing || !this.outbox.length || !App.token || !this.active) return;
    this.flushing = true;
    try {
      while (this.outbox.length && this.active) {
        const batch = this.outbox.slice(0, 25);
        let r;
        try {
          r = await api('scanBatch', { scans: batch.map((o) => ({ clientId: o.clientId, taskId: o.taskId, material: o.material, code: o.code, qty: o.qty, bin: o.bin, unknownDesc: o.unknownDesc,
            description: o.material ? o.desc : undefined, barcode: o.material ? o.code : undefined })) }, { timeout: 60000 });
        } catch (e) {
          if (e.code === 0) this.online = false;
          break; // keep everything queued; retried automatically
        }
        this.online = true;
        const byId = new Map(r.results.map((x) => [x.clientId, x]));
        let closed = 0, needRefresh = false;
        for (const o of batch) {
          const res = byId.get(o.clientId);
          if (!res) continue;
          if (res.status === 'ok') { this.remove(o); this.applyLocal(res); this.flashId = res.key; }
          else if (res.status === 'dup') { this.remove(o); needRefresh = true; } // already saved earlier – reload the list to be exact
          else if (res.status === 'closed') closed++;
          else { // notfound / invalid → keep a record, tell the user
            this.remove(o); this.failed.push({ ...o, error: res.error, failedAt: Date.now() }); store.set(this.key('failed'), this.failed.slice(-200));
            toast(`Not saved: ${o.desc} – ${res.error}`, 'bad', 6000); beep(false);
          }
        }
        this.saveOutbox();
        if (this.mergeLines(r)) needRefresh = true;
        if (closed) { await this.refresh(); if (!this.task || this.outbox.every((o) => o.taskId !== this.task.taskId)) break; }
        else if (needRefresh) await this.refresh();
        this.renderListOnly();
      }
    } finally { this.flushing = false; this.renderListOnly(); this.renderSync(); }
  },
  /** Saves every scan still waiting on this phone (plus any rejected ones) as a CSV file – nothing can be lost. */
  downloadBackup() {
    const rows = [['Status', 'User', 'TaskId', 'Material', 'Description', 'Barcode', 'Bin', 'Qty', 'ScannedAt', 'ClientId', 'Error']];
    const add = (st, o) => rows.push([st, App.user.username, o.taskId, o.material || '', o.desc || '', o.code || '', o.bin || '', o.qty, new Date(o.at || Date.now()).toLocaleString(), o.clientId, o.error || '']);
    this.outbox.forEach((o) => add('WAITING TO SAVE', o));
    this.failed.forEach((o) => add('REJECTED', o));
    const csv = rows.map((r) => r.map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    a.download = `unsaved-scans_${App.user.username}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    toast(`${this.outbox.length} waiting + ${this.failed.length} rejected scan(s) saved to a file.`, 'ok', 4000);
  },
  remove(o) { const i = this.outbox.findIndex((x) => x.clientId === o.clientId); if (i >= 0) this.outbox.splice(i, 1); },
  /** A saved scan / correction → add it to the list on this phone straight away. */
  applyLocal(ev) {
    if (!this.task || ev.taskId !== this.task.taskId) return;
    let l = this.lines.find((x) => (x.key || x.lineId) === ev.key);
    if (!l) { l = { key: ev.key, lineId: ev.key, taskId: ev.taskId, material: ev.material, description: ev.description, barcode: ev.barcode, bin: ev.bin, qty: 0, createdAt: ev.at }; this.lines.push(l); }
    l.qty = Math.round((Number(l.qty) + Number(ev.qty)) * 1000) / 1000;
    l.updatedAt = ev.at;
  },
  /** A gap in this user's revision means something else (admin / other phone) changed the task → full refresh. */
  mergeLines(r) {
    this.lines = this.lines.filter((l) => l.qty > 0);
    const gap = r.myRevBefore != null && this.myRev !== -1 && r.myRevBefore !== this.myRev;
    if (r.myRev != null) this.myRev = r.myRev;
    this.saveState();
    return gap;
  },
  async editLine(id) {
    const l = this.decorated().find((x) => (x.key || x.lineId) === id);
    if (!l) return;
    const m = Modal.open(`
      <div class="sheet-head"><h2>Edit item</h2><button class="btn icon ghost" data-x aria-label="Close">${I.x}</button></div>
      <div class="item-preview"><div class="desc">${esc(l.description)}</div>
        <div class="meta"><span class="mono">${esc(l.material || '—')}</span><span class="mono">${esc(l.barcode || '')}</span></div>
        <div class="loc-line">${locBadge(l.loc)}${l.loc.correct ? `<span class="badge grey">Master: ${esc(l.loc.correct)}</span>` : ''}</div></div>
      <label class="lbl">Quantity</label>
      <div class="qty-stepper"><button class="btn" data-minus>−</button><input class="input num" data-qty inputmode="decimal" value="${l.qty}"><button class="btn" data-plus>+</button></div>
      <div class="field" style="margin-top:14px"><label class="lbl">Bin (optional)</label><input class="input" data-bin value="${esc(l.bin)}" style="text-transform:uppercase"></div>
      <div class="err" data-err></div>
      <div class="actions"><button class="btn lg danger-ghost" data-del>${I.trash} Delete</button><button class="btn lg primary" data-save>Save</button></div>`);
    const qi = $('[data-qty]', m.el), err = $('[data-err]', m.el);
    const step = (d) => { qi.value = String(Math.max(1, (Number(qi.value) || 0) + d)); };
    $('[data-minus]', m.el).onclick = () => step(-1);
    $('[data-plus]', m.el).onclick = () => step(1);
    $('[data-x]', m.el).onclick = () => m.close();
    const handle = async (e) => {
      err.textContent = e.message;
      if (e.code === 'conflict' || e.code === 'closed') { m.close(); toast(e.message, 'warn', 6000); await this.refresh(); }
    };
    const save = async (btn) => {
      const q = Number(String(qi.value).replace(',', '.'));
      if (!(q > 0)) { err.textContent = 'Quantity must be greater than 0. Use Delete to remove the item.'; return; }
      if (/^\d{7,}$/.test(String(qi.value).trim())) { err.textContent = 'That looks like a barcode, not a quantity.'; return; }
      btn.disabled = true;
      try {
        const r = await api('editLine', { taskId: l.taskId, key: l.key, lineId: l.key ? undefined : l.lineId, expectedQty: l.qty, qty: q, bin: $('[data-bin]', m.el).value, material: l.material, description: l.description, barcode: l.barcode });
        (r.results || []).forEach((x) => { if (x.status === 'ok') this.applyLocal(x); });
        if (this.mergeLines(r) || !l.key) this.refresh(); m.close(); this.flashId = id; this.renderListOnly(); toast('Saved.', 'ok');
      }
      catch (e) { btn.disabled = false; handle(e); }
    };
    $('[data-save]', m.el).onclick = (e) => save(e.currentTarget);
    m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); save($('[data-save]', m.el)); } });
    $('[data-del]', m.el).onclick = async () => {
      if (!(await confirmDialog({ title: 'Delete this item?', text: esc(l.description) + ' – qty ' + fmtQty(l.qty), yes: 'Delete', no: 'Keep', danger: true }))) return;
      try {
        const r = await api('editLine', { taskId: l.taskId, key: l.key, lineId: l.key ? undefined : l.lineId, expectedQty: l.qty, delete: true, material: l.material, description: l.description, barcode: l.barcode });
        (r.results || []).forEach((x) => { if (x.status === 'ok') this.applyLocal(x); });
        if (this.mergeLines(r) || !l.key) this.refresh(); m.close(); this.renderListOnly(); toast('Item deleted.', 'ok');
      }
      catch (e) { handle(e); }
    };
  },
  async endScan() {
    if (!this.task) return;
    if (this.outbox.length) {
      await this.flush();
      if (this.outbox.length) { toast(`${this.outbox.length} scan(s) are still being saved. Check the connection and try again in a moment.`, 'warn', 5000); return; }
    }
    // make sure we show the server's final numbers before asking
    try { await this.refresh(); } catch (_) {}
    if (!this.task) return;
    const t = this.task, lines = this.decorated();
    const ex = lines.filter((l) => l.loc.code !== 'OK').length;
    const total = lines.reduce((s, l) => s + l.qty, 0);
    const ok = await confirmDialog({
      title: 'Are you sure to end the task?',
      text: `Task #${t.taskNo}: <b>${lines.length}</b> item(s), total qty <b>${fmtQty(total)}</b>${ex ? `, <b style="color:var(--bad)">${ex}</b> in wrong location` : ''}.<br>After you finish, only the admin can make changes.`,
      yes: 'Yes, finish', no: 'No', icon: 'flag',
    });
    if (!ok) return this.focusScan();
    try {
      const r = await api('submitTask', { taskId: t.taskId });
      this.task = null; this.lines = []; this.saveState();
      await this.refresh();
      const m = Modal.open(`<div class="confirm-icon ok">${I.check}</div><h2 class="center">Task #${r.task.taskNo} submitted</h2>
        <p class="sub center">${r.lineCount} item(s) · total qty ${fmtQty(r.totalQty)}<br>The data is now with the admin.</p>
        <div class="actions"><button class="btn lg" data-c>Close</button><button class="btn lg primary" data-n>${I.plus} Start new scan</button></div>`);
      $('[data-c]', m.el).onclick = () => m.close();
      $('[data-n]', m.el).onclick = () => { m.close(); this.startTask(); };
    } catch (e) { toast(e.message, 'bad', 5000); }
  },
};

document.addEventListener('DOMContentLoaded', () => App.boot());
