/**
 * STOCK COUNT – Google Apps Script backend (Google Sheet = database)
 * ---------------------------------------------------------------------------
 * Every write runs inside a script-wide lock, so two users can never overwrite
 * each other. Every scan carries a unique client id, so a retried request is
 * never counted twice. Every change is recorded in the ScanLog tab.
 *
 * First time: run  setup()  once from the editor, then Deploy → New deployment →
 * Web app (Execute as: Me, Who has access: Anyone). See README.md.
 */

// ============================== schema ==============================
var SHEETS = {
  Warehouses: ['Code', 'Name', 'UsersPerZone'],
  Users: ['Username', 'Display', 'Role', 'WH', 'Zone', 'PinHash', 'Salt', 'PinDefault', 'Active', 'TokenVer'],
  Tasks: ['TaskId', 'Username', 'Display', 'WH', 'Zone', 'TaskNo', 'Status', 'StartedAt', 'SubmittedAt', 'UpdatedAt', 'Seq'],
  Lines: ['LineId', 'LineKey', 'TaskId', 'Username', 'Display', 'WH', 'Zone', 'TaskNo', 'Material', 'Description', 'Barcode', 'Bin', 'Qty', 'CreatedAt', 'UpdatedAt', 'UpdatedBy', 'Seq'],
  ScanLog: ['ClientId', 'At', 'Actor', 'TaskId', 'LineId', 'Material', 'QtyChange', 'NewQty', 'Type'],
  Master: ['WH', 'Material', 'Description', 'Zone', 'Bin', 'Barcode'],
  SAP: ['WH', 'Material', 'Description', 'Qty', 'Zone', 'Bin'],
  Audit: ['At', 'Actor', 'Action', 'Details'],
  Meta: ['Key', 'Value'],
};
var META_KEYS = ['rev', 'masterRev', 'sapRev', 'taskId', 'lineId'];
var NUMERIC = { Warehouses: ['UsersPerZone'], Tasks: ['TaskNo', 'Seq'], Lines: ['TaskNo', 'Qty', 'Seq'], ScanLog: ['QtyChange', 'NewQty'], SAP: ['Qty'], Users: ['TokenVer'], Meta: ['Value'] };
// [code, name, users per zone] – setup() adds any that are missing; you can also edit the Warehouses tab
var WAREHOUSES = [['1120', 'Cosmetic', 4]];
var DEFAULT_PIN = '1234';
var DEFAULT_ADMIN_PASSWORD = 'admin123';
var USERS_PER_ZONE = 2; // default when the Warehouses tab has no value
var COMPARE_EVERY_MIN = 10; // Google Sheet comparison tabs refresh interval
var TOKEN_DAYS = 14;
var DEDUPE_TAIL = 6000; // ScanLog rows checked for duplicate client ids

// ============================== setup ==============================
/** Run once from the Apps Script editor (select "setup" → Run). Safe to run again. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('SECRET')) props.setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var head = SHEETS[name];
    if (sh.getMaxColumns() < head.length) sh.insertColumnsAfter(sh.getMaxColumns(), head.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#16213a').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    // text format everywhere (keeps material codes / barcodes / dates exactly as typed), numbers where needed
    formatCols_(sh, name, 2, Math.max(sh.getMaxRows() - 1, 1));
  });
  var meta = ss.getSheetByName('Meta');
  if (meta.getLastRow() < 2) meta.getRange(2, 1, META_KEYS.length, 2).setValues(META_KEYS.map(function (k) { return [k, 1]; }));
  meta.hideSheet();
  // warehouses: add missing ones, fill users-per-zone where empty (never removes anything)
  var wh = ss.getSheetByName('Warehouses');
  var have = wh.getLastRow() >= 2 ? wh.getRange(2, 1, wh.getLastRow() - 1, 3).getValues() : [];
  WAREHOUSES.forEach(function (w) {
    var i = have.map(function (r) { return String(r[0]).trim(); }).indexOf(w[0]);
    if (i < 0) { wh.getRange(wh.getLastRow() + 1, 1, 1, 3).setValues([w]); have.push(w); }
    else if (!have[i][2]) wh.getRange(i + 2, 3).setValue(w[2]);
  });
  var users = ss.getSheetByName('Users');
  if (users.getLastRow() < 2) {
    var salt = Utilities.getUuid();
    users.getRange(2, 1, 1, SHEETS.Users.length).setValues([['admin', 'Administrator', 'admin', '', '', hashPin_(DEFAULT_ADMIN_PASSWORD, salt), salt, 'Y', 'Y', 1]]);
  }
  buildCompareTabs_(ss);
  // refresh the comparison tabs automatically (only when something changed)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'refreshCompareTabs') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('refreshCompareTabs').timeBased().everyMinutes(COMPARE_EVERY_MIN).create();
  PropertiesService.getScriptProperties().deleteProperty('compareRev');
  refreshCompareTabs();
  var def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  Logger.log('Setup complete. Now Deploy → New deployment → Web app.');
}

var COMPARE_HEAD = ['Material', 'Material Description', 'SAP Location', 'Scanned Location(s)', 'SAP Qty', 'Scanned Qty', 'Difference', 'Qty Status', 'Remark'];
function compareName_(w) { return 'Compare ' + w.code + ' ' + w.name; }

/** Comparison tabs (one per warehouse): header + green/red status formatting. Values are written by refreshCompareTabs(). */
function buildCompareTabs_(ss) {
  readWarehouses_(ss).forEach(function (w) {
    var sh = ss.getSheetByName(compareName_(w)) || ss.insertSheet(compareName_(w));
    sh.clear(); // also removes the old live formulas from earlier versions
    sh.getRange(1, 1, 1, COMPARE_HEAD.length).setValues([COMPARE_HEAD]).setFontWeight('bold').setBackground('#14532d').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), 4).setNumberFormat('@');
    var range = sh.getRange('H2:H');
    sh.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Qty is perfect').setBackground('#1e8e3e').setFontColor('#ffffff').setBold(true).setRanges([range]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('Qty is different').setBackground('#c62828').setFontColor('#ffffff').setBold(true).setRanges([range]).build(),
    ]);
    sh.setColumnWidth(2, 320); sh.setColumnWidth(4, 200); sh.setColumnWidth(9, 220);
  });
}

/** Adds a "Stock Count" menu to the Google Sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Stock Count').addItem('Refresh SAP comparison tabs now', 'refreshCompareTabsNow').addToUi();
}
function refreshCompareTabsNow() { PropertiesService.getScriptProperties().deleteProperty('compareRev'); refreshCompareTabs(); }

/**
 * Writes SAP qty vs scanned qty per material into the "Compare <WH>" tabs.
 * Runs every few minutes (trigger), from the Sheet menu, or from the admin screen. Skips work when nothing changed.
 */
function refreshCompareTabs() {
  _meta = null; _sheets = {}; _ss = null;
  var props = PropertiesService.getScriptProperties();
  var rev = String(prop_('rev'));
  if (props.getProperty('compareRev') === rev) return { skipped: true };
  var ss = ss_(), whs = readWarehouses_(ss);
  var desc = {};
  readCols_('Master', ['WH', 'Material', 'Description']).forEach(function (r) { desc[r[0] + '|' + r[1]] = r[2]; });
  var sapRows = readCols_('SAP', ['WH', 'Material', 'Description', 'Qty', 'Zone', 'Bin']);
  var lineRows = readCols_('Lines', ['WH', 'Material', 'Qty', 'Zone', 'Bin']);
  var stamp = now_();
  whs.forEach(function (w) {
    var g = {}, order = [];
    var get = function (m) { if (!g[m]) { g[m] = { sap: 0, scan: 0, inSap: false, sapLoc: {}, scanLoc: {}, d: desc[w.code + '|' + m] || '' }; order.push(m); } return g[m]; };
    sapRows.forEach(function (r) { if (r[0] !== w.code || !r[1]) return; var x = get(r[1]); x.sap += Number(r[3]) || 0; x.inSap = true; if (!x.d) x.d = r[2]; x.sapLoc[r[5] ? r[4] + ' / ' + r[5] : r[4]] = 1; });
    lineRows.forEach(function (r) { var q = Number(r[2]) || 0; if (r[0] !== w.code || !r[1] || q <= 0) return; var x = get(r[1]); x.scan += q; var k = r[4] ? r[3] + ' / ' + r[4] : r[3]; x.scanLoc[k] = (x.scanLoc[k] || 0) + q; });
    order.sort();
    var out = order.map(function (m) {
      var x = g[m], sap = Math.round(x.sap * 1000) / 1000, scan = Math.round(x.scan * 1000) / 1000, diff = Math.round((scan - sap) * 1000) / 1000;
      var remark = diff === 0 ? 'Matches SAP' : !x.inSap ? 'Not in SAP stock' : scan === 0 ? 'Not scanned yet' : diff > 0 ? 'Excess by ' + diff : 'Short by ' + (-diff);
      return [m, x.d, Object.keys(x.sapLoc).join('; '), Object.keys(x.scanLoc).map(function (k) { return k + ': ' + x.scanLoc[k]; }).join('; '),
        sap, scan, diff, diff === 0 ? 'Qty is perfect' : 'Qty is different', remark];
    });
    var sh = ss.getSheetByName(compareName_(w));
    if (!sh) { buildCompareTabs_(ss); sh = ss.getSheetByName(compareName_(w)); }
    var last = sh.getLastRow();
    if (last > 1) sh.getRange(2, 1, last - 1, COMPARE_HEAD.length).clearContent();
    if (out.length) {
      if (out.length + 1 > sh.getMaxRows()) { var add = out.length + 1 - sh.getMaxRows() + 500; var mr = sh.getMaxRows(); sh.insertRowsAfter(mr, add); sh.getRange(mr + 1, 1, add, 4).setNumberFormat('@'); }
      sh.getRange(2, 1, out.length, COMPARE_HEAD.length).setValues(out);
    }
    var perfect = out.filter(function (r) { return r[7] === 'Qty is perfect'; }).length;
    sh.getRange(1, COMPARE_HEAD.length + 2).setValue('Updated ' + stamp + ' · ' + perfect + ' perfect · ' + (out.length - perfect) + ' different');
  });
  props.setProperty('compareRev', rev);
  return { refreshed: true, at: stamp };
}

// ============================== web entry ==============================
function doGet() {
  return json_({ ok: true, app: 'stock-count', message: 'Stock Count API is running.' });
}

function doPost(e) {
  _meta = null; _sheets = {}; _ss = null;
  var req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json_({ ok: false, error: 'Bad request' }); }
  try {
    var fn = ACTIONS[req.action];
    if (!fn) throw appErr_('Unknown action: ' + req.action, 'bad_action');
    var ctx = { req: req };
    if (!PUBLIC[req.action]) {
      ctx.user = auth_(req.token);
      if (ADMIN_ONLY[req.action] && ctx.user.Role !== 'admin') throw appErr_('Admin only.', 'forbidden');
      if (SCANNER_ONLY[req.action] && ctx.user.Role !== 'user') throw appErr_('Scanner users only.', 'forbidden');
    }
    var out = fn(ctx, req) || {};
    out.ok = true;
    return json_(out);
  } catch (err) {
    var code = err.code || 'error';
    if (code === 'error') console.error(err && err.stack || err);
    return json_({ ok: false, error: err.message || String(err), code: code });
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function appErr_(msg, code) { var e = new Error(msg); e.code = code || 'invalid'; return e; }

// ============================== storage helpers ==============================
var _ss = null, _sheets = {};
function ss_() {
  if (_ss) return _ss;
  _ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!_ss) _ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  return _ss;
}
function sh_(name) {
  if (!_sheets[name]) {
    _sheets[name] = ss_().getSheetByName(name);
    if (!_sheets[name]) throw appErr_('Sheet "' + name + '" is missing. Run setup() in Apps Script.', 'setup');
  }
  return _sheets[name];
}
function col_(name, field) { return SHEETS[name].indexOf(field); }
/** Returns { rows: [object with _row = sheet row number], values } */
function read_(name) {
  var sh = sh_(name), last = sh.getLastRow(), head = SHEETS[name];
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 };
    for (var j = 0; j < head.length; j++) {
      var v = vals[i][j];
      o[head[j]] = (v instanceof Date) ? fmtDate_(v) : v;
    }
    out.push(o);
  }
  return out;
}
function toRow_(name, o) { return SHEETS[name].map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; }); }
function ensureRows_(name, need) {
  var sh = sh_(name), max = sh.getMaxRows();
  if (need <= max) return;
  var add = need - max + 1000;
  sh.insertRowsAfter(max, add);
  formatCols_(sh, name, max + 1, add);
}
function formatCols_(sh, name, startRow, n) {
  // text format keeps material codes / barcodes / dates exactly as written; number columns stay automatic
  SHEETS[name].forEach(function (h, i) {
    if ((NUMERIC[name] || []).indexOf(h) < 0) sh.getRange(startRow, i + 1, n, 1).setNumberFormat('@');
  });
}
function append_(name, objs) {
  if (!objs.length) return;
  var sh = sh_(name), last = sh.getLastRow();
  ensureRows_(name, last + objs.length);
  sh.getRange(last + 1, 1, objs.length, SHEETS[name].length).setValues(objs.map(function (o) { return toRow_(name, o); }));
}
function write_(name, o) { sh_(name).getRange(o._row, 1, 1, SHEETS[name].length).setValues([toRow_(name, o)]); }
function replaceWhere_(name, keepFn, newObjs) {
  var sh = sh_(name), head = SHEETS[name];
  var keep = read_(name).filter(keepFn);
  var all = keep.concat(newObjs).map(function (o) { return toRow_(name, o); });
  var last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, head.length).clearContent();
  if (all.length) {
    ensureRows_(name, all.length + 1);
    sh.getRange(2, 1, all.length, head.length).setValues(all);
  }
}
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) throw appErr_('The server is busy – your data is safe and will be retried automatically.', 'busy');
  _meta = null; // always re-read counters once we hold the lock
  try {
    var r = fn();
    metaFlush_();
    SpreadsheetApp.flush();
    return r;
  } finally { _meta = null; lock.releaseLock(); }
}
// counters live in the hidden Meta tab (no daily quota), read once and written once per request
var _meta = null;
function meta_() {
  if (_meta) return _meta;
  _meta = { vals: {}, rows: {}, dirty: false };
  var sh = sh_('Meta'), last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r, i) { _meta.vals[s_(r[0])] = Number(r[1]) || 0; _meta.rows[s_(r[0])] = i + 2; });
  return _meta;
}
function prop_(k) { return meta_().vals[k] || 0; }
function next_(k) { var m = meta_(); m.vals[k] = (m.vals[k] || 1) + 1; m.dirty = true; return m.vals[k]; }
function metaFlush_() {
  if (!_meta || !_meta.dirty) return;
  var sh = sh_('Meta');
  META_KEYS.forEach(function (k) {
    if (_meta.rows[k]) sh.getRange(_meta.rows[k], 2).setValue(_meta.vals[k]);
    else { append_('Meta', [{ Key: k, Value: _meta.vals[k] || 1 }]); _meta.rows[k] = sh.getLastRow(); }
  });
  _meta.dirty = false;
}
function secret_() {
  var c = CacheService.getScriptCache(), v = c.get('secret');
  if (!v) { v = PropertiesService.getScriptProperties().getProperty('SECRET'); if (!v) throw appErr_('Run setup() in Apps Script first.', 'setup'); c.put('secret', v, 21600); }
  return v;
}
function now_() { return fmtDate_(new Date()); }
function fmtDate_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function audit_(actor, action, details) { append_('Audit', [{ At: now_(), Actor: actor, Action: action, Details: details ? JSON.stringify(details) : '' }]); }
function s_(v) { return v === null || v === undefined ? '' : String(v).trim(); }
function normBc_(b) { return s_(b).replace(/\s+/g, '').replace(/^0+/, ''); }
function readWarehouses_(ss) {
  var sh = (ss || ss_()).getSheetByName('Warehouses');
  if (!sh || sh.getLastRow() < 2) return WAREHOUSES.map(function (w) { return { code: w[0], name: w[1], usersPerZone: w[2] }; });
  return sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues()
    .map(function (r) { return { code: s_(r[0]), name: s_(r[1]), usersPerZone: Number(r[2]) || USERS_PER_ZONE }; }).filter(function (w) { return w.code; });
}

// ============================== auth ==============================
function bytesHex_(b) { return b.map(function (x) { var v = (x + 256) % 256; return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
function hashPin_(pin, salt) {
  var h = salt + ':' + pin;
  for (var i = 0; i < 300; i++) h = bytesHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h + salt, Utilities.Charset.UTF_8));
  return h;
}
function sign_(payload) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())); }
function makeToken_(u) {
  var payload = [u.Username, u.TokenVer || 1, Date.now() + TOKEN_DAYS * 86400000].join('|');
  return Utilities.base64EncodeWebSafe(payload) + '.' + sign_(payload);
}
function findUser_(username) {
  var un = s_(username).toLowerCase();
  return read_('Users').filter(function (u) { return s_(u.Username).toLowerCase() === un; })[0] || null;
}
function auth_(token) {
  var parts = s_(token).split('.');
  if (parts.length !== 2) throw appErr_('Please log in.', 'auth');
  var payload;
  try { payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); } catch (e) { throw appErr_('Please log in.', 'auth'); }
  if (sign_(payload) !== parts[1]) throw appErr_('Please log in.', 'auth');
  var p = payload.split('|');
  if (Number(p[2]) < Date.now()) throw appErr_('Your session expired. Please log in again.', 'auth');
  var u = findUser_(p[0]);
  if (!u || u.Active !== 'Y' || String(u.TokenVer || 1) !== String(p[1])) throw appErr_('Please log in again.', 'auth');
  return u;
}
function publicUser_(u) {
  var w = readWarehouses_().filter(function (x) { return x.code === s_(u.WH); })[0];
  return { username: s_(u.Username), display: s_(u.Display), role: s_(u.Role), wh: s_(u.WH), zone: s_(u.Zone), whName: w ? w.name : '',
    mustChangePin: s_(u.Role) === 'admin' && s_(u.PinDefault) === 'Y' };
}

// ============================== shared domain helpers ==============================
// ---- fast lookups (no full-sheet reads on the scanning path) ----
/** Sheet row numbers whose <field> cell equals value exactly. */
function findRows_(name, field, value) {
  var sh = sh_(name), last = sh.getLastRow(), v = s_(value);
  if (last < 2 || !v) return [];
  var c = col_(name, field) + 1;
  return sh.getRange(2, c, last - 1, 1).createTextFinder(v).matchEntireCell(true).matchCase(true).findAll()
    .map(function (r) { return r.getRow(); });
}
function readRowAt_(name, row) {
  var head = SHEETS[name], vals = sh_(name).getRange(row, 1, 1, head.length).getValues()[0], o = { _row: row };
  head.forEach(function (h, j) { var v = vals[j]; o[h] = (v instanceof Date) ? fmtDate_(v) : v; });
  return o;
}
/** Reads only some columns of a sheet → array of arrays (strings, numbers kept for NUMERIC columns). */
function readCols_(name, fields) {
  var sh = sh_(name), last = sh.getLastRow();
  if (last < 2) return [];
  var head = SHEETS[name], vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var ix = fields.map(function (f) { return head.indexOf(f); }), num = fields.map(function (f) { return (NUMERIC[name] || []).indexOf(f) >= 0; });
  return vals.map(function (r) { return ix.map(function (i, k) { var v = r[i]; return num[k] ? (Number(v) || 0) : (v instanceof Date ? fmtDate_(v) : s_(v)); }); });
}
function matFromRow_(o) { return { wh: s_(o.WH), material: s_(o.Material), description: s_(o.Description), barcodes: s_(o.Barcode) ? [s_(o.Barcode)] : [] }; }
/** Master lookup by material (own warehouse first), cached per master version. */
function getMat_(wh, material) {
  material = s_(material);
  if (!material) return null;
  var cache = CacheService.getScriptCache(), key = 'mx' + prop_('masterRev') + ':' + wh + '|' + material;
  var hit = cache.get(key);
  if (hit) return hit === '-' ? null : JSON.parse(hit);
  var rows = findRows_('Master', 'Material', material).map(function (r) { return readRowAt_('Master', r); });
  var own = rows.filter(function (o) { return s_(o.WH) === wh; });
  var pick = own.length ? own : rows.filter(function (o) { return s_(o.WH) === s_(rows[0] && rows[0].WH); });
  var m = null;
  if (pick.length) {
    m = matFromRow_(pick[0]);
    pick.slice(1).forEach(function (o) { var b = s_(o.Barcode); if (b && m.barcodes.indexOf(b) < 0) m.barcodes.push(b); });
  }
  try { cache.put(key, m ? JSON.stringify(m) : '-', 21600); } catch (e) {}
  return m;
}
/** Barcode (or material code) → master item. */
function resolveCode_(code, wh) {
  var c = s_(code), n = normBc_(c);
  var variants = [c, n, '0' + n, '00' + n].filter(function (v, i, a) { return v && a.indexOf(v) === i; });
  var hits = [];
  variants.forEach(function (v) { findRows_('Master', 'Barcode', v).forEach(function (r) { if (hits.indexOf(r) < 0) hits.push(r); }); });
  var rows = hits.map(function (r) { return readRowAt_('Master', r); });
  var o = rows.filter(function (x) { return s_(x.WH) === wh; })[0] || rows[0];
  if (o) return getMat_(s_(o.WH), s_(o.Material));
  return getMat_(wh, c);
}

function cleanQty_(q) {
  var n = Number(q);
  if (!isFinite(n) || n <= 0) throw appErr_('Quantity must be greater than 0.');
  if (n > 99999) throw appErr_('Quantity is too large (max 99,999).');
  return Math.round(n * 1000) / 1000;
}
function cleanBin_(b) { return s_(b).toUpperCase().slice(0, 20); }
function lineOut_(l) {
  return { lineId: s_(l.LineId), key: s_(l.LineKey), taskId: s_(l.TaskId), username: s_(l.Username), display: s_(l.Display), wh: s_(l.WH), zone: s_(l.Zone),
    taskNo: Number(l.TaskNo), material: s_(l.Material), description: s_(l.Description), barcode: s_(l.Barcode), bin: s_(l.Bin), qty: Number(l.Qty) || 0,
    createdAt: s_(l.CreatedAt), updatedAt: s_(l.UpdatedAt), updatedBy: s_(l.UpdatedBy), seq: Number(l.Seq) || 0 };
}
function taskOut_(t) {
  return { taskId: s_(t.TaskId), username: s_(t.Username), display: s_(t.Display), wh: s_(t.WH), zone: s_(t.Zone), taskNo: Number(t.TaskNo),
    status: s_(t.Status), startedAt: s_(t.StartedAt), submittedAt: s_(t.SubmittedAt), updatedAt: s_(t.UpdatedAt) };
}
function bumpRev_() { return next_('rev'); }

/**
 * Core write: add qty for a list of scans. Runs inside the lock.
 * Returns per-scan results: ok | dup | closed | notfound | invalid.
 */
function applyScans_(actorUser, scans, opts) {
  opts = opts || {};
  var tasks = read_('Tasks'), taskById = {};
  tasks.forEach(function (t) { taskById[s_(t.TaskId)] = t; });
  var myRevBefore = tasks.reduce(function (m, t) { return s_(t.Username) === s_(actorUser.Username) ? Math.max(m, Number(t.Seq) || 0) : m; }, 0);
  // lines are looked up one key at a time (fast even with tens of thousands of rows)
  var lineByKey = {};
  var lineFor = function (key) {
    if (lineByKey.hasOwnProperty(key)) return lineByKey[key];
    var rows = findRows_('Lines', 'LineKey', key);
    lineByKey[key] = rows.length ? readRowAt_('Lines', rows[0]) : null;
    return lineByKey[key];
  };
  var touched = [];
  // ---- duplicate detection: script cache + tail of ScanLog ----
  var cache = CacheService.getScriptCache();
  var ids = scans.map(function (s) { return 'cid:' + s_(s.clientId); }).filter(function (x) { return x !== 'cid:'; });
  var cached = ids.length ? cache.getAll(ids) : {};
  var seen = {};
  var logSh = sh_('ScanLog'), logLast = logSh.getLastRow();
  if (logLast >= 2) {
    var start = Math.max(2, logLast - DEDUPE_TAIL + 1);
    logSh.getRange(start, 1, logLast - start + 1, 1).getValues().forEach(function (r) { if (r[0]) seen[s_(r[0])] = true; });
  }
  var results = [], newLines = [], changed = {}, logs = [], putCache = {};
  var seq = bumpRev_();
  var at = now_();
  scans.forEach(function (sc) {
    var cid = s_(sc.clientId);
    if (cid && (cached['cid:' + cid] || seen[cid])) { results.push({ clientId: cid, status: 'dup' }); return; }
    var task = taskById[s_(sc.taskId)];
    var allowed = task && s_(task.Status) !== 'deleted' && (opts.admin || (s_(task.Username) === s_(actorUser.Username) && s_(task.Status) === 'open'));
    if (!allowed) { results.push({ clientId: cid, status: 'closed', error: 'Task is not open.' }); return; }
    var q;
    try { q = cleanQty_(sc.qty); } catch (e) { results.push({ clientId: cid, status: 'invalid', error: e.message }); return; }
    var wh = s_(task.WH);
    var mat = sc.material ? getMat_(wh, s_(sc.material)) : null;
    if (!mat && sc.code) mat = resolveCode_(sc.code, wh);
    var material = '', description, barcode = '';
    if (mat) {
      material = mat.material; description = mat.description;
      var code = s_(sc.code);
      barcode = code && mat.barcodes.some(function (b) { return normBc_(b) === normBc_(code); }) ? code : (mat.barcodes[0] || '');
    } else if (sc.unknownDesc && s_(sc.code)) {
      barcode = s_(sc.code).slice(0, 40);
      description = 'UNKNOWN ITEM' + (sc.unknownDesc !== true && s_(sc.unknownDesc) ? ' – ' + s_(sc.unknownDesc).slice(0, 80) : '');
    } else { results.push({ clientId: cid, status: 'notfound', error: 'Item not found in master data.' }); return; }
    var bin = cleanBin_(sc.bin);
    var key = s_(task.TaskId) + '|' + (material || ('U:' + barcode)) + '|' + bin;
    var l = lineFor(key);
    if (l) {
      l.Qty = Math.round(((Number(l.Qty) || 0) + q) * 1000) / 1000;
      l.UpdatedAt = at; l.UpdatedBy = s_(actorUser.Username); l.Seq = seq;
      if (l._row) changed[l._row] = l;
    } else {
      l = { LineId: 'L' + next_('lineId'), LineKey: key, TaskId: s_(task.TaskId), Username: s_(task.Username), Display: s_(task.Display), WH: wh, Zone: s_(task.Zone),
        TaskNo: Number(task.TaskNo), Material: material, Description: description, Barcode: barcode, Bin: bin, Qty: q, CreatedAt: at, UpdatedAt: at,
        UpdatedBy: s_(actorUser.Username), Seq: seq };
      lineByKey[key] = l; newLines.push(l);
    }
    if (touched.indexOf(l) < 0) touched.push(l);
    task.UpdatedAt = at; task.Seq = seq; task._dirty = true;
    logs.push({ ClientId: cid || ('srv-' + Utilities.getUuid()), At: at, Actor: s_(actorUser.Username), TaskId: s_(task.TaskId), LineId: l.LineId, Material: material || barcode,
      QtyChange: q, NewQty: l.Qty, Type: opts.admin ? 'admin-add' : 'scan' });
    if (cid) { putCache['cid:' + cid] = '1'; seen[cid] = true; }
    results.push({ clientId: cid, status: 'ok', lineId: l.LineId, qty: l.Qty, taskId: s_(task.TaskId) });
  });
  Object.keys(changed).forEach(function (r) { write_('Lines', changed[r]); });
  append_('Lines', newLines);
  append_('ScanLog', logs);
  tasks.forEach(function (t) { if (t._dirty) write_('Tasks', t); });
  if (Object.keys(putCache).length) cache.putAll(putCache, 21600);
  return { results: results, changed: touched, seq: seq, myRevBefore: myRevBefore };
}

/** Optimistic edit: refuses if the line changed since the client last saw it. Runs inside the lock. */
function editLine_(actorUser, req, isAdmin) {
  var lrow = findRows_('Lines', 'LineId', req.lineId)[0];
  var l = lrow ? readRowAt_('Lines', lrow) : null;
  if (!l || !(Number(l.Qty) > 0)) throw appErr_('This item was already deleted on another device. The list has been refreshed.', 'conflict');
  var allTasks = read_('Tasks');
  var task = allTasks.filter(function (t) { return s_(t.TaskId) === s_(l.TaskId); })[0];
  if (!task || s_(task.Status) === 'deleted') throw appErr_('This task no longer exists.', 'conflict');
  var myRevBefore = allTasks.reduce(function (m, t) { return s_(t.Username) === s_(actorUser.Username) ? Math.max(m, Number(t.Seq) || 0) : m; }, 0);
  var changed = [l];
  if (!isAdmin && (s_(task.Username) !== s_(actorUser.Username) || s_(task.Status) !== 'open')) throw appErr_('This task is already submitted. Only the admin can change it now.', 'closed');
  if (req.expectedQty !== undefined && Number(req.expectedQty) !== Number(l.Qty)) {
    throw appErr_('This item was changed on another device (now ' + Number(l.Qty) + '). The list has been refreshed – please check and try again.', 'conflict');
  }
  var seq = bumpRev_(), at = now_();
  var oldQty = Number(l.Qty);
  var newQty = req.delete ? 0 : cleanQty_(req.qty);
  var newBin = req.bin === undefined ? s_(l.Bin) : cleanBin_(req.bin);
  var logs = [];
  if (!req.delete && newBin !== s_(l.Bin)) {
    var newKey = s_(l.TaskId) + '|' + (s_(l.Material) || ('U:' + s_(l.Barcode))) + '|' + newBin;
    var trow = findRows_('Lines', 'LineKey', newKey)[0];
    var target = trow ? readRowAt_('Lines', trow) : null;
    if (target) {
      changed.push(target);
      target.Qty = Math.round(((Number(target.Qty) || 0) + newQty) * 1000) / 1000;
      target.UpdatedAt = at; target.UpdatedBy = s_(actorUser.Username); target.Seq = seq;
      write_('Lines', target);
      logs.push({ LineId: target.LineId, Material: target.Material, QtyChange: newQty, NewQty: target.Qty, Type: 'move-in' });
      l.Qty = 0;
      logs.push({ LineId: l.LineId, Material: l.Material, QtyChange: -oldQty, NewQty: 0, Type: 'move-out' });
    } else {
      l.LineKey = newKey; l.Bin = newBin; l.Qty = newQty;
      logs.push({ LineId: l.LineId, Material: l.Material, QtyChange: newQty - oldQty, NewQty: newQty, Type: 'edit' });
    }
  } else {
    l.Qty = newQty;
    logs.push({ LineId: l.LineId, Material: l.Material, QtyChange: newQty - oldQty, NewQty: newQty, Type: req.delete ? 'delete' : 'edit' });
  }
  l.UpdatedAt = at; l.UpdatedBy = s_(actorUser.Username); l.Seq = seq;
  write_('Lines', l);
  task.UpdatedAt = at; task.Seq = seq; write_('Tasks', task);
  append_('ScanLog', logs.map(function (x) { x.ClientId = 'srv-' + Utilities.getUuid(); x.At = at; x.Actor = s_(actorUser.Username); x.TaskId = s_(l.TaskId); return x; }));
  return { task: task, changed: changed, seq: seq, myRevBefore: myRevBefore };
}

function taskLines_(taskId) {
  return read_('Lines').filter(function (l) { return s_(l.TaskId) === taskId && Number(l.Qty) > 0; }).map(lineOut_);
}
function ensureZoneUsers_(wh) {
  var zones = {};
  readCols_('Master', ['WH', 'Zone']).forEach(function (r) { if (r[0] === wh && r[1]) zones[r[1]] = true; });
  var w = readWarehouses_().filter(function (x) { return x.code === wh; })[0];
  var perZone = (w && w.usersPerZone) || USERS_PER_ZONE;
  var users = read_('Users'), have = {};
  users.forEach(function (u) { have[s_(u.Username).toLowerCase()] = true; });
  var add = [];
  Object.keys(zones).sort().forEach(function (z) {
    for (var i = 1; i <= perZone; i++) {
      var disp = z + '-' + ('00' + i).slice(-3), un = wh + '-' + disp;
      if (!have[un.toLowerCase()]) {
        var salt = Utilities.getUuid();
        add.push({ Username: un, Display: disp, Role: 'user', WH: wh, Zone: z, PinHash: hashPin_(DEFAULT_PIN, salt), Salt: salt, PinDefault: 'Y', Active: 'Y', TokenVer: 1 });
      }
    }
  });
  append_('Users', add);
  return add.length;
}

// ============================== actions ==============================
/**
 * Admin data. Read WITHOUT the lock (so it never slows scanners down). Safe because the revision is read first:
 * every write with seq <= rev-1 is complete, and the client asks again from rev-1, so a half-written batch is always re-sent.
 */
function snapshot_(req) {
  var since = Number(req.sinceSeq || 0);
  var revAtStart = prop_('rev');
  var lines = read_('Lines');
  var maxSeq = lines.reduce(function (m, l) { return Math.max(m, Number(l.Seq) || 0); }, 0);
  return {
    rev: prop_('rev'), masterRev: prop_('masterRev'), sapRev: prop_('sapRev'),
    warehouses: readWarehouses_(),
    users: read_('Users').filter(function (u) { return s_(u.Role) === 'user'; }).map(function (u) {
      return { username: s_(u.Username), display: s_(u.Display), wh: s_(u.WH), zone: s_(u.Zone), active: s_(u.Active) === 'Y', pinDefault: s_(u.PinDefault) === 'Y' };
    }),
    tasks: read_('Tasks').map(taskOut_),
    lines: lines.filter(function (l) { return (Number(l.Seq) || 0) > since; }).map(lineOut_),
    full: since === 0, maxSeq: maxSeq, nextSince: Math.max(0, revAtStart - 1), serverTime: now_(), sheetUrl: ss_().getUrl(),
  };
}


var PUBLIC = { ping: 1, loginOptions: 1, login: 1 };
var ADMIN_ONLY = { refreshCompare: 1, snapshot: 1, sap: 1, adminAdd: 1, adminEdit: 1, reopenTask: 1, closeTask: 1, deleteTask: 1, uploadMaster: 1, uploadSap: 1, users: 1, setPin: 1, setActive: 1, addUser: 1, audit: 1 };
var SCANNER_ONLY = { myState: 1, startTask: 1, scanBatch: 1, editLine: 1, submitTask: 1 };

var ACTIONS = {
  ping: function () { return { time: now_(), rev: prop_('rev') }; },

  loginOptions: function () {
    var users = read_('Users').filter(function (u) { return s_(u.Role) === 'user' && s_(u.Active) === 'Y'; });
    return { warehouses: readWarehouses_().map(function (w) {
      var zones = {};
      users.filter(function (u) { return s_(u.WH) === w.code; }).forEach(function (u) { (zones[s_(u.Zone)] = zones[s_(u.Zone)] || []).push({ username: s_(u.Username), display: s_(u.Display) }); });
      return { code: w.code, name: w.name, zones: Object.keys(zones).sort().map(function (z) { return { zone: z, users: zones[z].sort(function (a, b) { return a.display < b.display ? -1 : 1; }) }; }) };
    }) };
  },

  login: function (ctx, req) {
    var un = s_(req.username), cache = CacheService.getScriptCache(), fk = 'fail:' + un.toLowerCase();
    var fails = Number(cache.get(fk) || 0);
    if (fails >= 8) throw appErr_('Too many wrong attempts. Try again in 5 minutes.', 'locked');
    var u = findUser_(un);
    if (!u || hashPin_(s_(req.pin), s_(u.Salt)) !== s_(u.PinHash)) {
      cache.put(fk, String(fails + 1), 300);
      throw appErr_('Wrong username or PIN / password.', 'auth_failed');
    }
    if (s_(u.Active) !== 'Y') throw appErr_('This user is disabled. Contact the admin.', 'forbidden');
    cache.remove(fk);
    return { token: makeToken_(u), user: publicUser_(u) };
  },

  me: function (ctx) { return { user: publicUser_(ctx.user) }; },

  changePin: function (ctx, req) {
    return withLock_(function () {
      var u = findUser_(ctx.user.Username);
      if (hashPin_(s_(req.current), s_(u.Salt)) !== s_(u.PinHash)) throw appErr_('Current PIN / password is wrong.');
      var n = s_(req.next);
      if (s_(u.Role) === 'admin' ? n.length < 6 : !/^\d{4,8}$/.test(n)) throw appErr_(s_(u.Role) === 'admin' ? 'Password must be at least 6 characters.' : 'PIN must be 4–8 digits.');
      u.Salt = Utilities.getUuid(); u.PinHash = hashPin_(n, u.Salt); u.PinDefault = 'N'; u.TokenVer = (Number(u.TokenVer) || 1) + 1;
      write_('Users', u); audit_(s_(u.Username), 'change_pin'); bumpRev_();
      return { token: makeToken_(u), user: publicUser_(u) };
    });
  },

  rev: function (ctx) {
    var out = { rev: prop_('rev'), masterRev: prop_('masterRev'), sapRev: prop_('sapRev') };
    if (s_(ctx.user.Role) === 'user') {
      var un = s_(ctx.user.Username);
      out.myRev = read_('Tasks').reduce(function (m, t) { return s_(t.Username) === un ? Math.max(m, Number(t.Seq) || 0) : m; }, 0);
    }
    return out;
  },

  master: function () {
    return { masterRev: prop_('masterRev'), rows: read_('Master').map(function (r) { return [s_(r.WH), s_(r.Material), s_(r.Description), s_(r.Zone), s_(r.Bin), s_(r.Barcode)]; }) };
  },

  // ---------- scanner ----------
  myState: function (ctx) {
    var un = s_(ctx.user.Username);
    var tasks = read_('Tasks').filter(function (t) { return s_(t.Username) === un && s_(t.Status) !== 'deleted'; });
    var lines = read_('Lines').filter(function (l) { return s_(l.Username) === un && Number(l.Qty) > 0; });
    var open = tasks.filter(function (t) { return s_(t.Status) === 'open'; })[0] || null;
    var history = tasks.filter(function (t) { return s_(t.Status) === 'submitted'; }).map(function (t) {
      var ls = lines.filter(function (l) { return s_(l.TaskId) === s_(t.TaskId); });
      var o = taskOut_(t); o.lineCount = ls.length; o.totalQty = ls.reduce(function (s, l) { return s + Number(l.Qty); }, 0); return o;
    }).sort(function (a, b) { return b.taskNo - a.taskNo; }).slice(0, 30);
    var myRev = tasks.reduce(function (m, t) { return Math.max(m, Number(t.Seq) || 0); }, 0);
    return { user: publicUser_(ctx.user), rev: prop_('rev'), myRev: myRev, openTask: open ? taskOut_(open) : null,
      lines: open ? lines.filter(function (l) { return s_(l.TaskId) === s_(open.TaskId); }).map(lineOut_) : [], history: history };
  },

  startTask: function (ctx) {
    return withLock_(function () {
      var u = ctx.user, un = s_(u.Username);
      var tasks = read_('Tasks').filter(function (t) { return s_(t.Username) === un; });
      var open = tasks.filter(function (t) { return s_(t.Status) === 'open'; })[0];
      if (open) return { task: taskOut_(open), lines: taskLines_(s_(open.TaskId)) };
      var no = tasks.reduce(function (m, t) { return Math.max(m, Number(t.TaskNo) || 0); }, 0) + 1;
      var seq = bumpRev_(), at = now_();
      var t = { TaskId: 'T' + next_('taskId'), Username: un, Display: s_(u.Display), WH: s_(u.WH), Zone: s_(u.Zone), TaskNo: no, Status: 'open', StartedAt: at, SubmittedAt: '', UpdatedAt: at, Seq: seq };
      append_('Tasks', [t]);
      audit_(un, 'task_start', { task: t.TaskId, no: no });
      return { task: taskOut_(t), lines: [] };
    });
  },

  scanBatch: function (ctx, req) {
    var scans = (req.scans || []).slice(0, 100);
    if (!scans.length) return { results: [] };
    return withLock_(function () {
      var r = applyScans_(ctx.user, scans, {});
      var open = read_('Tasks').filter(function (t) { return s_(t.Username) === s_(ctx.user.Username) && s_(t.Status) === 'open'; })[0];
      // only the lines that changed are returned; the device merges them into its list
      return { results: r.results, openTaskId: open ? s_(open.TaskId) : null, lines: r.changed.map(lineOut_), myRev: r.seq, myRevBefore: r.myRevBefore };
    });
  },

  editLine: function (ctx, req) {
    return withLock_(function () { var r = editLine_(ctx.user, req, false); return { lines: r.changed.map(lineOut_), myRev: r.seq, myRevBefore: r.myRevBefore }; });
  },

  submitTask: function (ctx, req) {
    return withLock_(function () {
      var t = read_('Tasks').filter(function (x) { return s_(x.TaskId) === s_(req.taskId); })[0];
      if (!t || s_(t.Username) !== s_(ctx.user.Username)) throw appErr_('Task not found.', 'conflict');
      if (s_(t.Status) === 'open') {
        var at = now_(); t.Status = 'submitted'; t.SubmittedAt = at; t.UpdatedAt = at; t.Seq = bumpRev_(); write_('Tasks', t);
        audit_(s_(ctx.user.Username), 'task_submit', { task: t.TaskId, no: t.TaskNo });
      }
      var ls = taskLines_(s_(t.TaskId));
      return { task: taskOut_(t), lineCount: ls.length, totalQty: ls.reduce(function (s, l) { return s + l.qty; }, 0) };
    });
  },

  // ---------- admin ----------
  snapshot: function (ctx, req) { return snapshot_(req); },
  sap: function () {
    return { sapRev: prop_('sapRev'), rows: read_('SAP').map(function (r) { return [s_(r.WH), s_(r.Material), s_(r.Description), Number(r.Qty) || 0, s_(r.Zone), s_(r.Bin)]; }) };
  },

  adminAdd: function (ctx, req) {
    return withLock_(function () {
      var r = applyScans_(ctx.user, [{ clientId: req.clientId, taskId: req.taskId, material: req.material, code: req.code, qty: req.qty, bin: req.bin }], { admin: true });
      var res = r.results[0];
      if (res.status !== 'ok' && res.status !== 'dup') throw appErr_(res.error || 'Could not add item.');
      audit_('admin', 'line_add', { task: req.taskId, material: req.material, qty: req.qty });
      return { result: res };
    });
  },

  adminEdit: function (ctx, req) {
    return withLock_(function () { editLine_(ctx.user, req, true); audit_('admin', req.delete ? 'line_delete' : 'line_edit', { line: req.lineId, qty: req.qty }); return {}; });
  },

  reopenTask: function (ctx, req) {
    return withLock_(function () {
      var tasks = read_('Tasks'), t = tasks.filter(function (x) { return s_(x.TaskId) === s_(req.taskId); })[0];
      if (!t || s_(t.Status) === 'deleted') throw appErr_('Task not found.', 'conflict');
      if (s_(t.Status) === 'open') return {};
      var other = tasks.filter(function (x) { return s_(x.Username) === s_(t.Username) && s_(x.Status) === 'open'; })[0];
      if (other) throw appErr_('This user already has Task #' + other.TaskNo + ' in progress. Close it first.', 'conflict');
      t.Status = 'open'; t.SubmittedAt = ''; t.UpdatedAt = now_(); t.Seq = bumpRev_(); write_('Tasks', t);
      audit_('admin', 'task_reopen', { task: t.TaskId });
      return {};
    });
  },

  closeTask: function (ctx, req) {
    return withLock_(function () {
      var t = read_('Tasks').filter(function (x) { return s_(x.TaskId) === s_(req.taskId); })[0];
      if (!t || s_(t.Status) === 'deleted') throw appErr_('Task not found.', 'conflict');
      if (s_(t.Status) === 'open') { var at = now_(); t.Status = 'submitted'; t.SubmittedAt = at; t.UpdatedAt = at; t.Seq = bumpRev_(); write_('Tasks', t); audit_('admin', 'task_close', { task: t.TaskId }); }
      return {};
    });
  },

  deleteTask: function (ctx, req) {
    return withLock_(function () {
      var t = read_('Tasks').filter(function (x) { return s_(x.TaskId) === s_(req.taskId); })[0];
      if (!t || s_(t.Status) === 'deleted') return {};
      var seq = bumpRev_(), at = now_(), logs = [];
      read_('Lines').forEach(function (l) {
        if (s_(l.TaskId) === s_(t.TaskId) && Number(l.Qty) > 0) {
          logs.push({ ClientId: 'srv-' + Utilities.getUuid(), At: at, Actor: 'admin', TaskId: s_(t.TaskId), LineId: l.LineId, Material: l.Material, QtyChange: -Number(l.Qty), NewQty: 0, Type: 'task-delete' });
          l.Qty = 0; l.UpdatedAt = at; l.UpdatedBy = 'admin'; l.Seq = seq; write_('Lines', l);
        }
      });
      append_('ScanLog', logs);
      t.Status = 'deleted'; t.UpdatedAt = at; t.Seq = seq; write_('Tasks', t);
      audit_('admin', 'task_delete', { task: t.TaskId, lines: logs.length });
      return {};
    });
  },

  uploadMaster: function (ctx, req) {
    var wh = s_(req.wh);
    if (!readWarehouses_().some(function (w) { return w.code === wh; })) throw appErr_('Unknown warehouse.');
    var rows = (req.rows || []).map(function (r) { return { WH: wh, Material: s_(r.material), Description: s_(r.description), Zone: s_(r.zone).toUpperCase(), Bin: s_(r.bin).toUpperCase(), Barcode: s_(r.barcode) }; })
      .filter(function (r) { return r.Material && r.Zone; });
    if (!rows.length) throw appErr_('No valid rows (need Material and Zone).');
    return withLock_(function () {
      replaceWhere_('Master', function (r) { return s_(r.WH) !== wh; }, rows);
      var added = ensureZoneUsers_(wh);
      next_('masterRev'); bumpRev_();
      audit_('admin', 'master_import', { wh: wh, rows: rows.length, newUsers: added });
      return { rows: rows.length, newUsers: added };
    });
  },

  uploadSap: function (ctx, req) {
    var wh = s_(req.wh);
    if (!readWarehouses_().some(function (w) { return w.code === wh; })) throw appErr_('Unknown warehouse.');
    var rows = (req.rows || []).map(function (r) {
      var q = Number(r.qty);
      if (!isFinite(q)) throw appErr_('Material ' + r.material + ': Available stock is not a number.');
      return { WH: wh, Material: s_(r.material), Description: s_(r.description), Qty: q, Zone: s_(r.zone).toUpperCase(), Bin: s_(r.bin).toUpperCase() };
    }).filter(function (r) { return r.Material; });
    if (!rows.length) throw appErr_('No valid SAP rows.');
    return withLock_(function () {
      replaceWhere_('SAP', function (r) { return s_(r.WH) !== wh; }, rows);
      next_('sapRev'); bumpRev_();
      audit_('admin', 'sap_import', { wh: wh, rows: rows.length });
      return { rows: rows.length };
    });
  },

  users: function () {
    return { users: read_('Users').filter(function (u) { return s_(u.Role) === 'user'; }).map(function (u) {
      return { username: s_(u.Username), display: s_(u.Display), wh: s_(u.WH), zone: s_(u.Zone), active: s_(u.Active) === 'Y', pinDefault: s_(u.PinDefault) === 'Y' };
    }) };
  },

  setPin: function (ctx, req) {
    var pin = s_(req.pin);
    if (!/^\d{4,8}$/.test(pin)) throw appErr_('PIN must be 4–8 digits.');
    return withLock_(function () {
      var u = findUser_(req.username);
      if (!u || s_(u.Role) !== 'user') throw appErr_('User not found.');
      u.Salt = Utilities.getUuid(); u.PinHash = hashPin_(pin, u.Salt); u.PinDefault = pin === DEFAULT_PIN ? 'Y' : 'N'; u.TokenVer = (Number(u.TokenVer) || 1) + 1;
      write_('Users', u); audit_('admin', 'user_pin_reset', { user: u.Username }); bumpRev_();
      return {};
    });
  },

  setActive: function (ctx, req) {
    return withLock_(function () {
      var u = findUser_(req.username);
      if (!u || s_(u.Role) !== 'user') throw appErr_('User not found.');
      u.Active = req.active ? 'Y' : 'N'; if (!req.active) u.TokenVer = (Number(u.TokenVer) || 1) + 1;
      write_('Users', u); audit_('admin', req.active ? 'user_enable' : 'user_disable', { user: u.Username }); bumpRev_();
      return {};
    });
  },

  addUser: function (ctx, req) {
    var wh = s_(req.wh), zone = s_(req.zone).toUpperCase();
    if (!readWarehouses_().some(function (w) { return w.code === wh; })) throw appErr_('Unknown warehouse.');
    if (!/^[A-Z0-9]{1,6}$/.test(zone)) throw appErr_('Zone must be letters/digits, e.g. A01');
    return withLock_(function () {
      var users = read_('Users'), have = {};
      users.forEach(function (u) { have[s_(u.Username).toLowerCase()] = true; });
      var i = 1, disp, un;
      do { disp = zone + '-' + ('00' + i).slice(-3); un = wh + '-' + disp; i++; } while (have[un.toLowerCase()]);
      var salt = Utilities.getUuid();
      append_('Users', [{ Username: un, Display: disp, Role: 'user', WH: wh, Zone: zone, PinHash: hashPin_(DEFAULT_PIN, salt), Salt: salt, PinDefault: 'Y', Active: 'Y', TokenVer: 1 }]);
      audit_('admin', 'user_add', { user: un }); bumpRev_();
      return { username: un };
    });
  },

  refreshCompare: function () { PropertiesService.getScriptProperties().deleteProperty('compareRev'); return refreshCompareTabs(); },

  audit: function () {
    var rows = read_('Audit');
    return { rows: rows.slice(-300).reverse().map(function (a) { return { at: s_(a.At), actor: s_(a.Actor), action: s_(a.Action), details: s_(a.Details) }; }) };
  },
};
