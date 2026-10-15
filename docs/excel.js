/* Stock Count – Excel reports built in the browser (ExcelJS). Same layout as the server edition. */
'use strict';
window.Report = (() => {
const C = {
  navy: 'FF1F2A44', white: 'FFFFFFFF', head2: 'FF34425F', line: 'FFD9DEE7', zebra: 'FFF6F8FB',
  okFill: 'FFE3F4E8', okFont: 'FF1E6B34', badFill: 'FFFDE4E1', badFont: 'FFA4271B',
  warnFill: 'FFFFF2D6', warnFont: 'FF8A5A00', greyFill: 'FFEDEFF3', greyFont: 'FF4A5263',
};
const STATUS_STYLE = {
  OK: [C.okFill, C.okFont], WRONG_ZONE: [C.badFill, C.badFont], WRONG_BIN: [C.warnFill, C.warnFont],
  OTHER_WH: [C.badFill, C.badFont], UNKNOWN: [C.greyFill, C.greyFont], PARTIAL: [C.warnFill, C.warnFont],
  NOT_SCANNED: [C.greyFill, C.greyFont],
  PERFECT: ['FF1E8E3E', C.white], DIFFERENT: ['FFC62828', C.white],
};

// ---------- data source (set by the admin screen from the live snapshot) ----------
const DS = { warehouses: [], users: [], tasks: [], lines: [], sapRows: [] };
function setData(d) { Object.assign(DS, d); }
/** "yyyy-MM-dd HH:mm:ss" (warehouse local time) → Date that Excel shows as the same wall time. */
function xlDate(s) { if (!s) return null; const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? null : d; }
function stamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function whName(code) { const w = DS.warehouses.find((x) => x.code === code); return w ? w.name : code; }
const allWhs = () => DS.warehouses.map((w) => w.code);
const masterOf = (wh) => Master.items.filter((m) => m.w === wh);
const fmtLoc = (l) => (l.bin ? `${l.zone} / ${l.bin}` : l.zone);

/** Lines joined with their task, with location check – same shape as the server edition. */
function fetchLines({ whs, username, taskId, includeOpen }) {
  const tasks = new Map(DS.tasks.map((t) => [t.taskId, t]));
  return DS.lines.filter((l) => l.qty > 0).map((l) => ({ l, t: tasks.get(l.taskId) }))
    .filter(({ t }) => t && t.status !== 'deleted' && (includeOpen || t.status === 'submitted')
      && (!whs || !whs.length || whs.includes(t.wh)) && (!username || t.username === username) && (!taskId || t.taskId === taskId))
    .map(({ l, t }) => {
      const loc = Master.lineLoc(l, t.wh, t.zone);
      return { ...l, wh: t.wh, task_zone: t.zone, task_no: t.taskNo, task_status: t.status, username: t.username, user_display: t.display,
        scan_bin: l.bin, created_at: l.createdAt, updated_by: String(l.updatedBy || '').replace(/^\d+-/, ''), loc,
        scannedLoc: l.bin ? `${t.zone} / ${l.bin}` : t.zone };
    })
    .sort((a, b) => a.wh.localeCompare(b.wh) || a.task_zone.localeCompare(b.task_zone) || a.username.localeCompare(b.username) || a.task_no - b.task_no || a.createdAt.localeCompare(b.createdAt));
}

/** SAP available stock vs scanned qty per material (warehouse = where it was counted). */
function sapCompare({ whs, includeOpen }) {
  const whList = whs && whs.length ? whs : allWhs();
  const map = new Map();
  const get = (wh, material) => {
    const k = `${wh}|${material}`;
    let g = map.get(k);
    if (!g) {
      const m = Master.any(material, wh);
      g = { wh, material, description: m ? m.d : '', sapQty: 0, scanQty: 0, sapLocs: new Set(), scanLocs: new Map(), inSap: false, users: new Set() };
      map.set(k, g);
    }
    return g;
  };
  for (const [wh, material, description, qty, zone, bin] of DS.sapRows) {
    if (!whList.includes(wh)) continue;
    const g = get(wh, material);
    g.sapQty += Number(qty) || 0; g.inSap = true;
    if (!g.description) g.description = description;
    g.sapLocs.add(bin ? `${zone} / ${bin}` : zone);
  }
  const lines = fetchLines({ whs: whList, includeOpen });
  let unknownLines = 0, unknownQty = 0;
  for (const l of lines) {
    if (!l.material) { unknownLines++; unknownQty += l.qty; continue; }
    const g = get(l.wh, l.material);
    g.scanQty += l.qty;
    g.scanLocs.set(l.scannedLoc, (g.scanLocs.get(l.scannedLoc) || 0) + l.qty);
    g.users.add(l.user_display);
  }
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const rows = [...map.values()].map((g) => {
    const sap = r3(g.sapQty), scan = r3(g.scanQty), diff = r3(scan - sap);
    let remark;
    if (diff === 0) remark = 'Matches SAP';
    else if (!g.inSap) remark = `Not in SAP stock – found ${scan}`;
    else if (scan === 0) remark = `Not scanned yet – SAP has ${sap}`;
    else if (diff > 0) remark = `Excess by ${diff}`;
    else remark = `Short by ${-diff}`;
    return { wh: g.wh, material: g.material, description: g.description, sapLoc: [...g.sapLocs].filter(Boolean).join('; '),
      scanLoc: [...g.scanLocs.entries()].map(([p, q]) => `${p}: ${q}`).join('; '), sapQty: sap, scanQty: scan, diff, perfect: diff === 0,
      status: diff === 0 ? 'Qty is perfect' : 'Qty is different',
      kind: diff === 0 ? 'perfect' : !g.inSap ? 'notinsap' : scan === 0 ? 'notscanned' : diff > 0 ? 'excess' : 'short',
      remark, users: [...g.users].sort().join(', ') };
  }).filter((r) => r.sapQty !== 0 || r.scanQty !== 0)
    .sort((a, b) => a.wh.localeCompare(b.wh) || a.material.localeCompare(b.material));
  const sum = (f) => r3(rows.reduce((s, r) => s + f(r), 0));
  const totals = { materials: rows.length, perfect: rows.filter((r) => r.perfect).length, different: rows.filter((r) => !r.perfect).length,
    short: rows.filter((r) => r.kind === 'short').length, excess: rows.filter((r) => r.kind === 'excess').length,
    notScanned: rows.filter((r) => r.kind === 'notscanned').length, notInSap: rows.filter((r) => r.kind === 'notinsap').length,
    sapQty: sum((r) => r.sapQty), scanQty: sum((r) => r.scanQty), netDiff: sum((r) => r.diff), unknownLines, unknownQty };
  return { rows, totals, meta: { whs: whList, includeOpen: !!includeOpen } };
}

// ---------- sheet helpers ----------
function titleBlock(ws, title, sub, width) {
  ws.mergeCells(1, 1, 1, width);
  const t = ws.getCell(1, 1);
  t.value = title; t.font = { bold: true, size: 15, color: { argb: C.white } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.navy } };
  t.alignment = { vertical: 'middle', indent: 1 };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, width);
  const s = ws.getCell(2, 1);
  s.value = sub; s.font = { italic: true, size: 10, color: { argb: C.greyFont } };
  s.alignment = { indent: 1 };
  ws.getRow(2).height = 18;
}

/** Writes a formatted table starting at `startRow`. columns: [{header,key,width,fmt,align}] */
function table(ws, startRow, columns, rows, opts = {}) {
  const hr = ws.getRow(startRow);
  columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: C.white }, size: 10.5 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.headFill || C.head2 } };
    cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: C.navy } } };
    if (c.width) ws.getColumn(i + 1).width = c.width;
  });
  hr.height = 34;
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const v = typeof c.value === 'function' ? c.value(r) : r[c.key];
      cell.value = v === undefined ? null : v;
      if (c.fmt) cell.numFmt = c.fmt;
      cell.alignment = { vertical: 'middle', horizontal: c.align || 'left', wrapText: !!c.wrap };
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
      if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.zebra } };
      if (c.status) {
        const code = typeof c.status === 'function' ? c.status(r) : r[c.status];
        const st = STATUS_STYLE[code];
        if (st) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st[0] } };
          cell.font = { bold: true, color: { argb: st[1] } };
        }
      }
      if (c.bold) cell.font = { ...(cell.font || {}), bold: true };
    });
  });
  const last = startRow + Math.max(rows.length, 1);
  if (rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: last, column: columns.length } };
  ws.views = [{ state: 'frozen', ySplit: startRow, xSplit: opts.freezeCols || 0, showGridLines: false }];
  if (!rows.length) {
    const c = ws.getRow(startRow + 1).getCell(1);
    c.value = opts.empty || 'No records.'; c.font = { italic: true, color: { argb: C.greyFont } };
  }
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return last;
}

const SCAN_COLS = [
  { header: 'WH', key: 'wh', width: 7, align: 'center' },
  { header: 'Zone (counted)', key: 'task_zone', width: 10, align: 'center' },
  { header: 'User', key: 'user_display', width: 11 },
  { header: 'Task #', key: 'task_no', width: 7, align: 'center' },
  { header: 'Task Status', value: (r) => (r.task_status === 'submitted' ? 'Submitted' : 'In progress'), width: 11 },
  { header: 'Material', value: (r) => r.material || '—', width: 11 },
  { header: 'Material Description', key: 'description', width: 42 },
  { header: 'Barcode', value: (r) => r.barcode || '', width: 16 },
  { header: 'Qty', key: 'qty', width: 9, fmt: '#,##0.##', align: 'right', bold: true },
  { header: 'Scanned Location', key: 'scannedLoc', width: 16 },
  { header: 'Master Location (Zone / Bin)', value: (r) => r.loc.correct, width: 28, wrap: true },
  { header: 'Location Check', value: (r) => r.loc.label, width: 30, status: (r) => r.loc.code },
  { header: 'Scanned At', value: (r) => xlDate(r.created_at), width: 17, fmt: 'dd-mmm-yy hh:mm' },
  { header: 'Last Edited By', value: (r) => r.updated_by || '', width: 13 },
];

// ---------- per user / per task ----------
async function userWorkbook({ username, taskId }) {
  const u = DS.users.find((x) => x.username === username);
  if (!u) throw new Error('User not found');
  const lines = fetchLines({ username, taskId, includeOpen: true });
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stock Count'; wb.created = new Date();
  const ws = wb.addWorksheet('Scans', { properties: { tabColor: { argb: 'FF2F6FED' } } });
  const tasks = DS.tasks.filter((t) => t.username === username && t.status !== 'deleted' && (!taskId || t.taskId === taskId)).sort((a, b) => a.taskNo - b.taskNo);
  const qty = lines.reduce((s, l) => s + l.qty, 0);
  titleBlock(ws, `Stock Count – ${u.display}  (WH ${u.wh} ${whName(u.wh)}, Zone ${u.zone})`,
    `${taskId ? 'Task #' + (tasks[0] ? tasks[0].taskNo : '') : tasks.length + ' task(s)'}  ·  ${lines.length} line(s)  ·  Total qty ${qty.toLocaleString()}  ·  Generated ${new Date().toLocaleString()}`,
    SCAN_COLS.length);
  table(ws, 4, SCAN_COLS, lines, { empty: 'No items scanned.' });
  const name = `StockCount_${u.wh}_${u.display}${taskId && tasks[0] ? '_Task' + tasks[0].taskNo : ''}_${stamp()}.xlsx`;
  return { wb, name };
}

// ---------- SAP comparison sheet ----------
function addSapSheet(wb, cmp, label, genText) {
  const ws = wb.addWorksheet('SAP Comparison', { properties: { tabColor: { argb: 'FF1E8E3E' } } });
  const t = cmp.totals;
  const cols = [
    { header: 'WH', key: 'wh', width: 7, align: 'center' },
    { header: 'Material', key: 'material', width: 11 },
    { header: 'Material Description', key: 'description', width: 42 },
    { header: 'SAP Location', key: 'sapLoc', width: 18, wrap: true },
    { header: 'Scanned Location(s) : Qty', key: 'scanLoc', width: 26, wrap: true },
    { header: 'SAP Qty', key: 'sapQty', width: 11, fmt: '#,##0.##', align: 'right' },
    { header: 'Scanned Qty', key: 'scanQty', width: 12, fmt: '#,##0.##', align: 'right', bold: true },
    { header: 'Difference (Scanned − SAP)', key: 'diff', width: 14, fmt: '+#,##0.##;-#,##0.##;0', align: 'right', bold: true },
    { header: 'Qty Status', key: 'status', width: 18, align: 'center', status: (r) => (r.perfect ? 'PERFECT' : 'DIFFERENT') },
    { header: 'Remark', key: 'remark', width: 30 },
    { header: 'Counted By', key: 'users', width: 20, wrap: true },
  ];
  titleBlock(ws, `SAP Comparison – scanned qty vs SAP available stock  (${label})`,
    `${t.perfect} perfect · ${t.different} different (${t.short} short, ${t.excess} excess, ${t.notScanned} not scanned, ${t.notInSap} not in SAP)  ·  ${genText}`, cols.length);
  const last = table(ws, 4, cols, cmp.rows, { freezeCols: 3, headFill: 'FF14532D', empty: 'No SAP stock loaded and nothing scanned yet.' });
  // difference colouring
  cmp.rows.forEach((r, i) => {
    const c = ws.getRow(5 + i).getCell(8);
    if (r.diff !== 0) c.font = { bold: true, color: { argb: r.diff < 0 ? C.badFont : C.warnFont } };
  });
  const tr = ws.getRow(last + 1);
  tr.getCell(5).value = 'TOTAL'; tr.getCell(5).font = { bold: true };
  [[6, t.sapQty], [7, t.scanQty], [8, t.netDiff]].forEach(([i, v]) => {
    const c = tr.getCell(i); c.value = v; c.numFmt = i === 8 ? '+#,##0.##;-#,##0.##;0' : '#,##0.##'; c.font = { bold: true };
    c.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  });
  if (t.unknownLines) {
    const n = ws.getRow(last + 3).getCell(1);
    n.value = `Note: ${t.unknownLines} unknown-barcode line(s) (qty ${t.unknownQty}) are not in this comparison because they have no material code.`;
    n.font = { italic: true, color: { argb: C.greyFont } };
  }
  return ws;
}

async function sapWorkbook({ whs, includeOpen }) {
  const cmp = sapCompare({ whs, includeOpen });
  const label = cmp.meta.whs.map((w) => `${w} ${whName(w)}`).join(' + ');
  const wb = new ExcelJS.Workbook(); wb.creator = 'Stock Count'; wb.created = new Date();
  addSapSheet(wb, cmp, label, `Generated ${new Date().toLocaleString()}  ·  ${includeOpen ? 'Includes in-progress tasks' : 'Submitted tasks only'}`);
  return { wb, name: `SAP_Comparison_${cmp.meta.whs.join('-')}_${stamp()}.xlsx` };
}

// ---------- merged reconciliation ----------
function consolidate(lines) {
  const map = new Map();
  for (const l of lines) {
    const key = l.material ? `${l.wh}|M|${l.material}` : `${l.wh}|B|${l.barcode || l.description}`;
    let g = map.get(key);
    if (!g) {
      g = { wh: l.wh, material: l.material, description: l.description, barcode: l.barcode || '', total: 0, okQty: 0, badQty: 0,
        correct: l.loc.correct, codes: new Set(), places: new Map(), users: new Set(), lines: 0 };
      map.set(key, g);
    }
    g.total += l.qty; g.lines++;
    if (l.loc.code === 'OK') g.okQty += l.qty; else g.badQty += l.qty;
    g.codes.add(l.loc.code);
    g.users.add(l.user_display);
    g.places.set(l.scannedLoc, (g.places.get(l.scannedLoc) || 0) + l.qty);
  }
  const out = [];
  for (const g of map.values()) {
    const codes = [...g.codes];
    let code, status;
    if (codes.length === 1 && codes[0] === 'OK') { code = 'OK'; status = 'Correct location'; }
    else if (codes.includes('UNKNOWN')) { code = 'UNKNOWN'; status = 'Not in master data'; }
    else if (codes.includes('OTHER_WH')) { code = 'OTHER_WH'; status = 'Wrong warehouse'; }
    else if (codes.includes('OK')) { code = 'PARTIAL'; status = 'Partly in wrong location'; }
    else if (codes.every((c) => c === 'WRONG_BIN')) { code = 'WRONG_BIN'; status = 'Wrong bin'; }
    else { code = 'WRONG_ZONE'; status = 'Wrong location'; }
    const places = [...g.places.entries()].map(([p, q]) => `${p}: ${q}`).join('; ');
    const wrongPlaces = [...g.places.keys()];
    let remark = '';
    if (code !== 'OK' && code !== 'UNKNOWN') remark = `Found at ${wrongPlaces.join(', ')} → should be ${g.correct}`;
    if (code === 'UNKNOWN') remark = 'Barcode / material not found in master file – please verify';
    out.push({ ...g, code, status, placesText: places, usersText: [...g.users].sort().join(', '), remark });
  }
  out.sort((a, b) => a.wh.localeCompare(b.wh) || String(a.material || 'zzz').localeCompare(String(b.material || 'zzz')));
  return out;
}

async function mergeWorkbook({ whs, includeOpen }) {
  const whList = whs && whs.length ? whs : allWhs();
  const lines = fetchLines({ whs: whList, includeOpen });
  const cons = consolidate(lines);
  const label = whList.map((w) => `${w} ${whName(w)}`).join(' + ');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Stock Count'; wb.created = new Date();
  const genText = `Generated ${new Date().toLocaleString()}  ·  ${includeOpen ? 'Includes in-progress tasks' : 'Submitted tasks only'}`;

  // ----- 1. Summary -----
  const ws = wb.addWorksheet('Summary', { properties: { tabColor: { argb: C.navy } } });
  titleBlock(ws, `Stock Count – Merged Report  (${label})`, genText, 8);
  const openTasks = DS.tasks.filter((t) => t.status === 'open' && whList.includes(t.wh)).length;
  const subTasks = DS.tasks.filter((t) => t.status === 'submitted' && whList.includes(t.wh)).length;
  const cnt = (code) => lines.filter((l) => l.loc.code === code).length;
  const masterMats = whList.reduce((s, w) => s + masterOf(w).length, 0);
  const scannedMats = new Set(lines.filter((l) => l.material && l.loc.code !== 'OTHER_WH').map((l) => `${l.wh}|${l.material}`)).size;
  const kpis = [
    ['Submitted tasks included', includeOpen ? subTasks + openTasks : subTasks],
    ['Tasks still in progress' + (includeOpen ? ' (included)' : ' (NOT included)'), openTasks],
    ['Users who counted', new Set(lines.map((l) => l.username)).size],
    ['Scan lines', lines.length],
    ['Total quantity counted', lines.reduce((s, l) => s + l.qty, 0)],
    ['Distinct materials counted', cons.length],
    ['Materials in master file', masterMats],
    ['Master coverage', masterMats ? scannedMats / masterMats : 0],
    ['Lines in correct location', cnt('OK')],
    ['Lines in WRONG location (zone)', cnt('WRONG_ZONE')],
    ['Lines in wrong bin', cnt('WRONG_BIN')],
    ['Lines from another warehouse', cnt('OTHER_WH')],
    ['Lines not in master data', cnt('UNKNOWN')],
  ];
  {
    const st = sapCompare({ whs: whList, includeOpen }).totals;
    kpis.push(['SAP: materials with Qty perfect', st.perfect], ['SAP: materials with Qty different', st.different],
      ['SAP: total available stock', st.sapQty], ['SAP: net difference (scanned − SAP)', st.netDiff]);
  }
  ws.getColumn(1).width = 40; ws.getColumn(2).width = 16;
  kpis.forEach(([k, v], i) => {
    const r = ws.getRow(4 + i);
    r.getCell(1).value = k; r.getCell(1).font = { color: { argb: C.greyFont } };
    r.getCell(2).value = v; r.getCell(2).font = { bold: true, size: 12 };
    r.getCell(2).numFmt = k === 'Master coverage' ? '0.0%' : '#,##0.##';
    r.getCell(2).alignment = { horizontal: 'right' };
    [1, 2].forEach((c) => (r.getCell(c).border = { bottom: { style: 'hair', color: { argb: C.line } } }));
    if ((/WRONG|wrong|another|not in|different/.test(k) && v > 0) || (/net difference/.test(k) && v !== 0)) r.getCell(2).font = { bold: true, size: 12, color: { argb: C.badFont } };
  });
  // zone table
  const zoneRows = [];
  for (const w of whList) {
    const zones = [...new Set(masterOf(w).flatMap((m) => m.l.map((l) => l.zone)))].sort();
    for (const z of zones) {
      const zl = lines.filter((l) => l.wh === w && l.task_zone === z);
      const users = DS.users.filter((u) => u.wh === w && u.zone === z).map((u) => u.display).sort();
      const master = masterOf(w).filter((m) => m.l.some((l) => l.zone === z)).length;
      const matsHere = new Set(zl.filter((l) => l.loc.code === 'OK').map((l) => l.material)).size;
      zoneRows.push({ wh: w, zone: z, users: users.join(', '), lines: zl.length, qty: zl.reduce((s, l) => s + l.qty, 0),
        master, matsHere, cov: master ? matsHere / master : 0, wrong: zl.filter((l) => l.loc.code !== 'OK').length });
    }
  }
  const zStart = 4 + kpis.length + 2;
  ws.getCell(zStart - 1, 1).value = 'By zone'; ws.getCell(zStart - 1, 1).font = { bold: true, size: 12 };
  const zt = [
    { header: 'WH', key: 'wh', width: 40 }, { header: 'Zone', key: 'zone', width: 16, align: 'center' },
    { header: 'Users', key: 'users', width: 22 }, { header: 'Lines', key: 'lines', width: 10, fmt: '#,##0', align: 'right' },
    { header: 'Qty', key: 'qty', width: 12, fmt: '#,##0.##', align: 'right' },
    { header: 'Master SKUs', key: 'master', width: 12, fmt: '#,##0', align: 'right' },
    { header: 'Found in place', key: 'matsHere', width: 14, fmt: '#,##0', align: 'right' },
    { header: 'Coverage', key: 'cov', width: 11, fmt: '0%', align: 'right' },
    { header: 'Exceptions', key: 'wrong', width: 12, fmt: '#,##0', align: 'right', status: (r) => (r.wrong ? 'WRONG_ZONE' : 'OK') },
  ];
  table(ws, zStart, zt, zoneRows);
  ws.autoFilter = undefined;
  ws.views = [{ showGridLines: false }];

  // ----- 2. Final Output (consolidated) -----
  const wf = wb.addWorksheet('Final Output', { properties: { tabColor: { argb: 'FF1E6B34' } } });
  const fcols = [
    { header: 'WH', key: 'wh', width: 7, align: 'center' },
    { header: 'Material', value: (r) => r.material || '—', width: 11 },
    { header: 'Material Description', key: 'description', width: 42 },
    { header: 'Barcode', key: 'barcode', width: 16 },
    { header: 'Total Qty', key: 'total', width: 11, fmt: '#,##0.##', align: 'right', bold: true },
    { header: 'Qty in Correct Loc.', key: 'okQty', width: 12, fmt: '#,##0.##', align: 'right' },
    { header: 'Qty in Wrong Loc.', key: 'badQty', width: 12, fmt: '#,##0.##', align: 'right' },
    { header: 'Correct Location (Master)', key: 'correct', width: 26, wrap: true },
    { header: 'Scanned Location(s) : Qty', key: 'placesText', width: 30, wrap: true },
    { header: 'Status', key: 'status', width: 22, status: 'code' },
    { header: 'Remarks', key: 'remark', width: 46, wrap: true },
    { header: 'Counted By', key: 'usersText', width: 22, wrap: true },
  ];
  titleBlock(wf, `Final Output – consolidated quantity per material  (${label})`,
    `Same material scanned by several users / tasks is added together.  ${genText}`, fcols.length);
  table(wf, 4, fcols, cons, { freezeCols: 3, headFill: C.navy, empty: 'No submitted scans yet.' });
  const tr = wf.getRow(5 + cons.length);
  tr.getCell(4).value = 'TOTAL'; tr.getCell(4).font = { bold: true };
  ['total', 'okQty', 'badQty'].forEach((k, i) => {
    const c = tr.getCell(5 + i);
    c.value = cons.reduce((s, g) => s + g[k], 0); c.numFmt = '#,##0.##'; c.font = { bold: true };
    c.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
  });

  // ----- 2b. SAP Comparison -----
  const sapCmp = sapCompare({ whs: whList, includeOpen });
  addSapSheet(wb, sapCmp, label, genText);

  // ----- 3. Location Exceptions -----
  const we = wb.addWorksheet('Location Exceptions', { properties: { tabColor: { argb: 'FFA4271B' } } });
  const exc = lines.filter((l) => l.loc.code !== 'OK');
  const ecols = [
    { header: 'WH', key: 'wh', width: 7, align: 'center' },
    { header: 'User', key: 'user_display', width: 11 },
    { header: 'Task #', key: 'task_no', width: 7, align: 'center' },
    { header: 'Material', value: (r) => r.material || '—', width: 11 },
    { header: 'Material Description', key: 'description', width: 42 },
    { header: 'Barcode', value: (r) => r.barcode || '', width: 16 },
    { header: 'Qty', key: 'qty', width: 9, fmt: '#,##0.##', align: 'right', bold: true },
    { header: 'WRONG Location (where found)', key: 'scannedLoc', width: 20, status: (r) => r.loc.code },
    { header: 'EXACT Location (master)', value: (r) => r.loc.correct || '—', width: 28, wrap: true, status: () => 'OK' },
    { header: 'Issue', value: (r) => r.loc.label, width: 32 },
  ];
  titleBlock(we, `Location Exceptions – items found in the wrong place  (${label})`, `${exc.length} line(s)  ·  ${genText}`, ecols.length);
  table(we, 4, ecols, exc, { headFill: 'FF7A1E14', empty: 'No exceptions – every scanned item was in its master location.' });

  // ----- 4. All Scans (merged raw) -----
  const wa = wb.addWorksheet('All Scans');
  titleBlock(wa, `All Scans – merged from every user  (${label})`, `${lines.length} line(s)  ·  ${genText}`, SCAN_COLS.length);
  table(wa, 4, SCAN_COLS, lines, { empty: 'No scans.' });

  // ----- 5. Not Scanned -----
  const wn = wb.addWorksheet('Not Scanned');
  const counted = new Set(lines.filter((l) => l.material).map((l) => `${l.wh}|${l.material}`));
  const notScanned = [];
  for (const m of Master.items) {
    if (!whList.includes(m.w) || counted.has(`${m.w}|${m.m}`)) continue;
    notScanned.push({ wh: m.w, material: m.m, description: m.d, barcode: m.b.join(', '),
      zone: [...new Set(m.l.map((l) => l.zone))].join(', '), bin: m.l.map(fmtLoc).join('; ') });
  }
  notScanned.sort((a, b) => a.wh.localeCompare(b.wh) || a.zone.localeCompare(b.zone) || a.bin.localeCompare(b.bin));
  titleBlock(wn, `Master materials NOT scanned by anyone  (${label})`, `${notScanned.length} material(s)  ·  ${genText}`, 6);
  table(wn, 4, [
    { header: 'WH', key: 'wh', width: 7, align: 'center' },
    { header: 'Material', key: 'material', width: 11 },
    { header: 'Material Description', key: 'description', width: 44 },
    { header: 'Barcode', key: 'barcode', width: 18 },
    { header: 'Zone', key: 'zone', width: 9, align: 'center' },
    { header: 'Zone / Bin', key: 'bin', width: 26 },
  ], notScanned, { empty: 'Every master material was scanned.' });

  const name = `StockCount_MERGED_${whList.join('-')}_${stamp()}.xlsx`;
  return { wb, name };
}

async function download({ wb, name }) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return name;
}

// ---------- reading uploaded Excel files (master / SAP) ----------
const cellText = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text).join('').trim();
    if (v.result != null) return String(v.result).trim();
    if (v.text != null) return String(v.text).trim();
  }
  return String(v).trim();
};
async function readSheet(arrayBuffer, spec) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('The Excel file has no sheets.');
  let headerRow = null, cols = null;
  for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
    const map = {};
    ws.getRow(r).eachCell((c, i) => { const k = cellText(c.value).toLowerCase().replace(/[^a-z]/g, ''); if (k) map[k] = i; });
    const found = {};
    for (const [field, names] of Object.entries(spec.fields)) found[field] = names.map((n) => map[n]).find(Boolean);
    if (spec.required.every((f) => found[f])) { headerRow = r; cols = found; break; }
  }
  if (!headerRow) throw new Error(spec.missing);
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), o = {};
    for (const [field, ci] of Object.entries(cols)) o[field] = ci ? cellText(row.getCell(ci).value) : '';
    rows.push(o);
  }
  return rows;
}
async function parseMaster(buf) {
  const rows = await readSheet(buf, {
    fields: { material: ['material', 'materialcode', 'materialno', 'item', 'itemcode', 'sku'], description: ['description', 'materialdescription', 'desc', 'itemdescription'],
      zone: ['zone', 'storagetype'], bin: ['bin', 'binlocation', 'storagebin', 'location'], barcode: ['barcode', 'ean', 'eancode', 'upc'] },
    required: ['material', 'description', 'zone', 'bin', 'barcode'], missing: 'Could not find the header row. Required columns: Material, Description, Zone, Bin, Barcode.' });
  const seen = new Set();
  return rows.filter((r) => r.material && r.zone).map((r) => ({ ...r, zone: r.zone.toUpperCase(), bin: r.bin.toUpperCase() }))
    .filter((r) => { const k = [r.material, r.zone, r.bin, r.barcode].join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
}
async function parseSap(buf) {
  const rows = await readSheet(buf, {
    fields: { material: ['material', 'materialcode', 'materialno', 'sku'], description: ['materialdescription', 'description', 'desc'],
      qty: ['availablestock', 'unrestricted', 'unrestrictedstock', 'stock', 'qty', 'quantity', 'totalstock'], zone: ['storagetype', 'zone', 'sty'], bin: ['storagebin', 'bin'] },
    required: ['material', 'qty'], missing: 'Could not find the header row. Required columns: Material and Available stock (plus Material Description, Storage Type, Storage Bin).' });
  return rows.filter((r) => r.material).map((r, i) => {
    const q = Number(String(r.qty).replace(/,/g, ''));
    if (!Number.isFinite(q)) throw new Error(`Row ${i + 2}: "Available stock" is not a number for material ${r.material}.`);
    return { material: r.material, description: r.description, qty: q, zone: r.zone.toUpperCase(), bin: r.bin.toUpperCase() };
  });
}
/** Refuses a SAP file that clearly belongs to the other warehouse. */
function checkSapWarehouse(wh, rows) {
  const mats = [...new Set(rows.map((r) => r.material))];
  const inWh = mats.filter((m) => Master.get(wh, m)).length;
  if (mats.length >= 5 && inWh / mats.length < 0.5) {
    const other = allWhs().filter((w) => w !== wh).find((w) => mats.filter((m) => Master.get(w, m)).length / mats.length >= 0.5);
    throw new Error(`Only ${inWh} of ${mats.length} materials in this file belong to WH ${wh}.` + (other ? ` It looks like the SAP file for WH ${other}.` : ''));
  }
}

return { setData, fetchLines, sapCompare, consolidate, userWorkbook, mergeWorkbook, sapWorkbook, download, parseMaster, parseSap, checkSapWarehouse };
})();
