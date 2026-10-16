/* Stock Count – admin console (Google Sheets edition). All figures are computed live from the Sheet data. */
'use strict';

window.Admin = (() => {
  const S = { tab: 'dash', wh: null, active: false, timer: null, masterWh: null, sapWh: null, sapFilter: 'all', sapQ: '', sapOpen: true, detail: null, syncing: false, lastSync: null };
  // ---------------- live data ----------------
  const D = { warehouses: [], users: [], tasks: [], lines: new Map(), seenEv: new Set(), scansRow: 0, rev: -1, sapRev: -1, sapRows: [], sheetUrl: '', loaded: false };
  const linesArr = () => [...D.lines.values()];

  async function sync(full) {
    const r = await api('snapshot', { sinceRow: full || !D.loaded ? 0 : D.scansRow }, { timeout: 90000 });
    if (r.full) { D.lines = new Map(); D.seenEv = new Set(); for (const l of r.lines) D.lines.set(l.key, { ...l, lineId: l.key }); }
    // newer scans are added on this screen (each scan exactly once)
    for (const e of r.events) {
      if (D.seenEv.has(e.clientId)) continue;
      D.seenEv.add(e.clientId);
      let l = D.lines.get(e.key);
      if (!l) { l = { key: e.key, lineId: e.key, taskId: e.taskId, username: e.username, display: e.display, wh: e.wh, zone: e.zone, taskNo: e.taskNo, material: e.material, description: e.description, barcode: e.barcode, bin: e.bin, qty: 0, createdAt: e.at, updatedAt: e.at, updatedBy: e.by }; D.lines.set(e.key, l); }
      l.qty = Math.round((Number(l.qty) + Number(e.qty)) * 1000) / 1000; l.updatedAt = e.at; l.updatedBy = e.by;
    }
    D.scansRow = r.scansRow;
    Object.assign(D, { warehouses: r.warehouses, users: r.users, tasks: r.tasks, rev: r.rev, sheetUrl: r.sheetUrl, loaded: true });
    if (r.masterRev !== Master.rev) await Master.load(true);
    if (r.sapRev !== D.sapRev) { const s = await api('sap'); D.sapRows = s.rows; D.sapRev = s.sapRev; }
    Report.setData({ warehouses: D.warehouses, users: D.users, tasks: D.tasks, lines: linesArr(), sapRows: D.sapRows });
    S.lastSync = new Date();
    setLive(true);
  }
  async function poll() {
    if (!S.active || S.syncing || document.visibilityState !== 'visible') return;
    S.syncing = true;
    try {
      const r = await api('rev');
      if (r.rev !== D.rev || r.scansRow !== D.scansRow || r.masterRev !== Master.rev || r.sapRev !== D.sapRev) { await sync(); rerender(); }
      else setLive(true);
    } catch (e) { setLive(false); } finally { S.syncing = false; }
  }
  function setLive(on) {
    const c = $('[data-clock]'); if (!c) return;
    c.innerHTML = on ? `<span class="dot live" style="margin-right:6px"></span>Live · ${new Date().toLocaleTimeString()}` : 'Offline – retrying…';
  }
  /** Re-draw the current page with fresh data, without disturbing what the admin is typing. */
  function rerender() {
    if (S.detail && S.detail.isOpen()) { if (!S.detail.isDirty()) S.detail.redraw(); return; }
    if (Modal.isOpen()) return;
    if (S.tab === 'dash') renderDash();
    else if (S.tab === 'sap') { renderSapKpis(); renderSapTable(); }
  }

  // ---------------- shell ----------------
  function shell() {
    $('#app').innerHTML = `<div class="admin">
      <div class="topbar">
        <div class="brand-mark" style="width:34px;height:34px;border-radius:9px;background:rgba(255,255,255,.12)">${I.logo}</div>
        <div class="grow"><div class="t1">Stock Count${window.STOCK_COUNT_NAME ? ' ' + esc(window.STOCK_COUNT_NAME) : ''} · Admin</div><div class="t2" data-clock>Connecting…</div></div>
        <a class="btn ghost sm" data-sheet target="_blank" rel="noopener" title="Open the Google Sheet (database)">${I.box}<span class="desktop-only">Google Sheet</span></a>
        <button class="btn ghost sm" data-pw title="Change password">${I.key}<span class="desktop-only">Password</span></button>
        <button class="btn ghost sm" data-out title="Log out">${I.logout}<span class="desktop-only">Log out</span></button>
      </div>
      <div class="tabs">
        ${[['dash', 'Dashboard'], ['sap', 'SAP Comparison'], ['users', 'Users'], ['master', 'Master data'], ['activity', 'Activity log']].map(([k, v]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${v}</button>`).join('')}
      </div>
      <div class="wrap-admin" data-page></div></div>`;
    $('[data-out]').onclick = () => App.logout();
    $('[data-pw]').onclick = () => changePinDialog(false);
    $$('[data-tab]').forEach((b) => (b.onclick = () => { S.tab = b.dataset.tab; $$('[data-tab]').forEach((x) => x.classList.toggle('on', x === b)); page(); }));
  }
  async function start() {
    S.active = true;
    Master.loadCached();
    shell();
    P().innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
    try { await sync(true); } catch (e) { P().innerHTML = `<div class="card">Could not load data: ${esc(e.message)} <button class="btn sm" onclick="Admin.start()">Retry</button></div>`; setLive(false); return; }
    const sl = $('[data-sheet]'); if (sl && D.sheetUrl) sl.href = D.sheetUrl;
    page();
    clearInterval(S.timer);
    S.timer = setInterval(poll, 5000);
    if (!S._wired) { S._wired = true; document.addEventListener('visibilitychange', () => { if (S.active && document.visibilityState === 'visible') poll(); }); }
  }
  function stop() { S.active = false; clearInterval(S.timer); }
  function page() {
    if (S.tab === 'dash') return renderDash();
    if (S.tab === 'sap') return renderSap();
    if (S.tab === 'users') return usersPage();
    if (S.tab === 'master') return masterPage();
    if (S.tab === 'activity') return activityPage();
  }
  const P = () => $('[data-page]');
  const taskMap = () => new Map(D.tasks.map((t) => [t.taskId, t]));

  // ================= Dashboard =================
  function overview() {
    const tm = taskMap();
    const byTask = new Map();
    for (const l of linesArr()) { if (l.qty > 0) { const a = byTask.get(l.taskId) || []; a.push(l); byTask.set(l.taskId, a); } }
    return D.warehouses.map((w) => {
      const us = D.users.filter((u) => u.wh === w.code).map((u) => {
        const tasks = D.tasks.filter((t) => t.username === u.username && t.status !== 'deleted');
        const open = tasks.find((t) => t.status === 'open');
        let lineCount = 0, totalQty = 0, exceptions = 0, openLines = 0;
        for (const t of tasks) for (const l of byTask.get(t.taskId) || []) {
          lineCount++; totalQty += l.qty; if (t.status === 'open') openLines++;
          if (Master.lineLoc(l, t.wh, t.zone).code !== 'OK') exceptions++;
        }
        const lastActivity = tasks.reduce((m, t) => (t.updatedAt > m ? t.updatedAt : m), '');
        return { ...u, open, submittedTasks: tasks.filter((t) => t.status === 'submitted').length, lineCount, totalQty, exceptions, openLines, lastActivity };
      });
      const zones = {};
      us.forEach((u) => (zones[u.zone] = zones[u.zone] || []).push(u));
      return { ...w, masterItems: Master.items.filter((m) => m.w === w.code).length,
        zones: Object.entries(zones).sort().map(([zone, list]) => ({ zone, users: list })),
        stats: { users: us.length, scanning: us.filter((u) => u.open).length, submittedTasks: us.reduce((s, u) => s + u.submittedTasks, 0),
          lines: us.reduce((s, u) => s + u.lineCount, 0), qty: us.reduce((s, u) => s + u.totalQty, 0), exceptions: us.reduce((s, u) => s + u.exceptions, 0) } };
    });
  }
  function agoText(s) {
    if (!s) return 'No activity yet';
    const d = new Date(s.replace(' ', 'T')); const sec = (Date.now() - d.getTime()) / 1000;
    if (!isFinite(sec)) return s;
    return 'Last scan ' + (sec < 45 ? 'just now' : sec < 3600 ? Math.round(sec / 60) + ' min ago' : sec < 86400 ? Math.round(sec / 3600) + ' h ago' : s);
  }
  function renderDash() {
    const ov = overview();
    if (!S.wh || (S.wh !== 'ALL' && !ov.some((w) => w.code === S.wh))) S.wh = ov[0] ? ov[0].code : 'ALL';
    const whs = S.wh === 'ALL' ? ov : ov.filter((w) => w.code === S.wh);
    const sum = (k) => whs.reduce((s, w) => s + w.stats[k], 0);
    const label = S.wh === 'ALL' ? 'All warehouses' : `${whs[0].name} · WH ${whs[0].code}`;
    const defaultPins = D.users.filter((u) => u.pinDefault && u.active).length;
    const noMaster = !Master.items.length;
    P().innerHTML = `
      ${noMaster ? `<div class="banner" style="background:var(--accent-soft);color:var(--accent)">${I.upload}<div><b>First step:</b> upload the master location files in the <a href="#" data-gomaster>Master data</a> tab. Users (2 per zone) are created automatically.</div></div>` : ''}
      ${defaultPins ? `<div class="banner">${I.alert}<div>${defaultPins} user(s) still use the default PIN 1234 – anyone with the link could log in as them. Set personal PINs in the <a href="#" data-gousers>Users</a> tab.</div></div>` : ''}
      <div class="page-head">
        <div><h1>${esc(label)}</h1><p>Live view of every scanner user. Click a user to see, edit or download their scans.</p></div>
        <div class="row wrap">
          <div class="seg" style="margin:0">${ov.map((w) => `<button data-wh="${w.code}" class="${S.wh === w.code ? 'on' : ''}">${esc(w.name)} ${w.code}</button>`).join('')}<button data-wh="ALL" class="${S.wh === 'ALL' ? 'on' : ''}">All</button></div>
          <button class="btn dark" data-merge>${I.merge} Merge All Together</button>
        </div>
      </div>
      <div class="kpis">
        <div class="kpi"><div class="k">Scanning now</div><div class="v">${sum('scanning')} <span class="muted" style="font-size:15px">/ ${sum('users')}</span></div></div>
        <div class="kpi"><div class="k">Submitted tasks</div><div class="v">${fmtQty(sum('submittedTasks'))}</div></div>
        <div class="kpi"><div class="k">Scan lines</div><div class="v">${fmtQty(sum('lines'))}</div></div>
        <div class="kpi"><div class="k">Total qty</div><div class="v">${fmtQty(sum('qty'))}</div></div>
        <div class="kpi ${sum('exceptions') ? 'bad' : 'ok'}"><div class="k">Location exceptions</div><div class="v">${fmtQty(sum('exceptions'))}</div></div>
        <div class="kpi"><div class="k">Master materials</div><div class="v">${fmtQty(whs.reduce((s, w) => s + w.masterItems, 0))}</div></div>
      </div>
      ${whs.map((w) => `
        ${S.wh === 'ALL' ? `<h2 style="margin:22px 2px 10px;font-size:18px">${esc(w.name)} · WH ${w.code}</h2>` : ''}
        <div class="zones-grid">${w.zones.map((z) => `<div class="zone">
          <div class="zone-title"><h3>Zone ${esc(z.zone)}</h3><span class="badge grey">${z.users.length} users</span>
            <span class="muted small">${fmtQty(z.users.reduce((s, u) => s + u.totalQty, 0))} qty · ${z.users.reduce((s, u) => s + u.lineCount, 0)} lines</span></div>
          <div class="ucards">${z.users.map(userCard).join('')}</div></div>`).join('') || '<div class="card empty">No users yet.</div>'}</div>`).join('')}`;
    $$('[data-wh]', P()).forEach((b) => (b.onclick = () => { S.wh = b.dataset.wh; renderDash(); }));
    $('[data-merge]').onclick = mergeDialog;
    const gu = $('[data-gousers]'); if (gu) gu.onclick = (e) => { e.preventDefault(); $('[data-tab="users"]').click(); };
    const gm = $('[data-gomaster]'); if (gm) gm.onclick = (e) => { e.preventDefault(); $('[data-tab="master"]').click(); };
    $$('[data-view]').forEach((b) => (b.onclick = () => userDetail(b.dataset.view)));
    $$('[data-xls]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); exportUser(b.dataset.xls); }));
  }
  function userCard(u) {
    const status = !u.active ? ['grey', 'Disabled', ''] : u.open ? ['ok', 'Scanning', 'scanning'] : u.submittedTasks ? ['blue', 'Submitted', 'done'] : ['grey', 'Not started', ''];
    return `<div class="ucard ${status[2]}">
      <div class="uh"><div><div class="uname">${esc(u.display)}</div><div class="muted small">${esc(agoText(u.lastActivity))}</div></div>
        <span class="badge ${status[0]}">${u.open ? '<span class="dot live"></span>' : ''}${status[1]}</span></div>
      <div class="nums"><div><b>${fmtQty(u.lineCount)}</b><span>Lines</span></div><div><b>${fmtQty(u.totalQty)}</b><span>Qty</span></div>
        <div class="${u.exceptions ? 'bad' : ''}"><b>${u.exceptions}</b><span>Wrong</span></div></div>
      <div class="muted small">${u.submittedTasks} submitted task(s)${u.open ? ` · ${u.openLines} line(s) in progress` : ''}</div>
      <div class="acts"><button class="btn sm primary" data-view="${esc(u.username)}">View &amp; edit</button><button class="btn sm" data-xls="${esc(u.username)}" ${u.lineCount ? '' : 'disabled'}>${I.download} Excel</button></div>
    </div>`;
  }

  // ---------------- exports ----------------
  async function withFresh(fn, label) {
    toast(label || 'Preparing Excel…', '', 1800);
    try { await sync(); return await fn(); } catch (e) { toast('Export failed: ' + e.message, 'bad', 6000); }
  }
  const exportUser = (username, taskId) => withFresh(async () => { const n = await Report.download(await Report.userWorkbook({ username, taskId })); toast('Downloaded ' + n, 'ok'); });
  function mergeDialog() {
    const ov = overview();
    const openCount = ov.reduce((s, w) => s + w.stats.scanning, 0);
    const m = Modal.open(`
      <div class="sheet-head"><div><h2>Merge all together</h2><p class="sub">One Excel with every user's scans, checked against the master file, with a <b>Final Output</b> sheet (same materials added together) and a <b>SAP Comparison</b> sheet.</p></div>
      <button class="btn icon ghost" data-x>${I.x}</button></div>
      <label class="lbl">Warehouse</label>
      <div class="radio-cards">
        ${ov.map((w) => `<label><input type="radio" name="mw" value="${w.code}" ${S.wh === w.code ? 'checked' : ''}> ${esc(w.name)} · WH ${w.code} <span class="muted small" style="margin-left:auto">${w.stats.submittedTasks} task(s)</span></label>`).join('')}
        <label><input type="radio" name="mw" value="${ov.map((w) => w.code).join(',')}" ${S.wh === 'ALL' ? 'checked' : ''}> All warehouses in one file</label>
      </div>
      <label class="check"><input type="checkbox" data-open><div><b>Include tasks still in progress</b><div class="muted small">${openCount ? `${openCount} user(s) are still scanning. ` : ''}Normally only submitted (finished) tasks are merged.</div></div></label>
      <div class="muted small" style="margin:10px 2px 0">Sheets: Summary · Final Output · SAP Comparison · Location Exceptions · All Scans · Not Scanned</div>
      <div class="actions"><button class="btn lg" data-c>Cancel</button><button class="btn lg dark" data-go>${I.download} Download merged Excel</button></div>`);
    $('[data-x]', m.el).onclick = () => m.close();
    $('[data-c]', m.el).onclick = () => m.close();
    $('[data-go]', m.el).onclick = () => {
      const whs = (($('input[name=mw]:checked', m.el) || {}).value || '').split(',').filter(Boolean);
      const includeOpen = $('[data-open]', m.el).checked;
      m.close();
      withFresh(async () => { const n = await Report.download(await Report.mergeWorkbook({ whs, includeOpen })); toast('Downloaded ' + n, 'ok', 4000); }, 'Building the merged Excel…');
    };
  }

  // ================= User detail =================
  function userDetail(username, selectTaskId) {
    const u = D.users.find((x) => x.username === username);
    if (!u) return;
    let sel = selectTaskId || null;
    const m = Modal.open(`<div data-body></div>`, { wide: true, onClose: () => { S.detail = null; if (S.tab === 'dash') renderDash(); } });
    const body = $('[data-body]', m.el);
    let dirty = false;
    S.detail = { isOpen: () => !m.closed, isDirty: () => dirty || !!body.querySelector('input:focus'), redraw: () => draw() };
    const tasksOf = () => D.tasks.filter((t) => t.username === username && t.status !== 'deleted').sort((a, b) => b.taskNo - a.taskNo);
    const act = async (fn, okMsg) => {
      try { await fn(); if (okMsg) toast(okMsg, 'ok'); }
      catch (e) { toast(e.message, e.code === 'conflict' ? 'warn' : 'bad', 6000); }
      try { await sync(); } catch (_) {}
      dirty = false; draw();
    };
    function draw() {
      const tasks = tasksOf();
      if (!sel || !tasks.some((t) => t.taskId === sel)) sel = tasks[0] && tasks[0].taskId;
      const t = tasks.find((x) => x.taskId === sel);
      const lines = t ? linesArr().filter((l) => l.taskId === t.taskId && l.qty > 0).map((l) => ({ ...l, loc: Master.lineLoc(l, t.wh, t.zone) }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
      const totalQ = (tid) => linesArr().filter((l) => l.taskId === tid && l.qty > 0).reduce((s, l) => s + l.qty, 0);
      const filterVal = ($('[data-filter]', body) || {}).value || '';
      body.innerHTML = `
        <div class="sheet-head"><div><h2>${esc(u.display)} <span class="muted" style="font-weight:500;font-size:15px">· WH ${esc(u.wh)} · Zone ${esc(u.zone)}</span></h2>
          <p class="sub">${tasks.length} task(s) · ${fmtQty(tasks.reduce((s, x) => s + totalQ(x.taskId), 0))} total qty · <span class="dot live"></span> live</p></div>
          <div class="row"><button class="btn sm" data-uxls ${tasks.length ? '' : 'disabled'}>${I.download} All tasks Excel</button><button class="btn icon ghost" data-x>${I.x}</button></div></div>
        ${tasks.length ? `<div class="task-tabs">${tasks.map((x) => `<button data-t="${esc(x.taskId)}" class="${x.taskId === sel ? 'on' : ''}">${x.status === 'open' ? '<span class="dot live"></span>' : I.lock.replace('<svg', '<svg width="14" height="14"')} Task #${x.taskNo} · ${fmtQty(totalQ(x.taskId))}</button>`).join('')}</div>` : '<div class="card empty">This user has not started any task yet.</div>'}
        ${t ? `
        <div class="toolbar">
          <span class="badge ${t.status === 'open' ? 'ok' : 'blue'}">${t.status === 'open' ? '<span class="dot live"></span> In progress' : 'Submitted ' + esc(t.submittedAt)}</span>
          <span class="muted small">Started ${esc(t.startedAt)} · ${lines.length} line(s) · qty ${fmtQty(lines.reduce((s, l) => s + l.qty, 0))} · <b style="color:${lines.some((l) => l.loc.code !== 'OK') ? 'var(--bad)' : 'inherit'}">${lines.filter((l) => l.loc.code !== 'OK').length} exception(s)</b></span>
          <span class="grow"></span>
          <button class="btn sm" data-add>${I.plus} Add item</button>
          <button class="btn sm" data-txls>${I.download} Excel</button>
          ${t.status === 'submitted' ? `<button class="btn sm" data-reopen>${I.reopen} Reopen for user</button>` : `<button class="btn sm" data-force>${I.lock} Close task</button>`}
          <button class="btn sm danger-ghost" data-tdel>${I.trash} Delete task</button>
        </div>
        <input class="input" data-filter placeholder="Filter by material, description, barcode…" value="${esc(filterVal)}" style="margin-bottom:10px;min-height:40px">
        <div class="tbl-wrap" style="max-height:58vh"><table class="tbl"><thead><tr>
          <th>Material</th><th>Description</th><th class="desktop-only">Barcode</th><th class="r">Qty</th><th>Bin</th><th>Location check</th><th class="desktop-only">Edited</th><th></th></tr></thead>
          <tbody>${lines.map((l) => `<tr data-row="${esc(l.lineId)}" data-s="${esc((l.material + ' ' + l.description + ' ' + l.barcode).toLowerCase())}">
            <td class="mono">${esc(l.material || '—')}</td><td style="min-width:220px">${esc(l.description)}</td><td class="mono desktop-only">${esc(l.barcode)}</td>
            <td class="r"><input class="input qty-in num" data-q value="${l.qty}" inputmode="decimal"></td>
            <td><input class="input bin-in" data-b value="${esc(l.bin)}" placeholder="—"></td>
            <td>${locBadge(l.loc)}${l.loc.code !== 'OK' && l.loc.correct ? `<div class="muted small" style="margin-top:3px">Exact: <b>${esc(l.loc.correct)}</b></div>` : ''}</td>
            <td class="muted small desktop-only" style="white-space:nowrap">${esc(String(l.updatedBy).replace(/^\d+-/, ''))}<br>${esc(l.updatedAt)}</td>
            <td class="r"><div class="row" style="gap:4px;justify-content:flex-end"><button class="btn sm ok hidden" data-save title="Save">${I.check}</button><button class="btn icon sm ghost" data-del title="Delete">${I.trash}</button></div></td></tr>`).join('')
            || '<tr><td colspan="8" class="empty">No items in this task.</td></tr>'}</tbody></table></div>` : ''}`;
      $('[data-x]', body).onclick = () => m.close();
      const ux = $('[data-uxls]', body); if (ux) ux.onclick = () => exportUser(username);
      $$('[data-t]', body).forEach((b) => (b.onclick = () => { sel = b.dataset.t; dirty = false; draw(); }));
      if (!t) return;
      const f = $('[data-filter]', body);
      const applyFilter = () => { const v = f.value.trim().toLowerCase(); $$('[data-row]', body).forEach((r) => r.classList.toggle('hidden', !!v && !r.dataset.s.includes(v))); };
      f.oninput = applyFilter; applyFilter();
      $('[data-txls]', body).onclick = () => exportUser(username, t.taskId);
      $('[data-add]', body).onclick = async () => {
        const it = await searchDialog({ wh: t.wh, title: `Add item to Task #${t.taskNo}` });
        if (!it) return;
        const r = await qtyDialog({ item: it, code: it.b[0], wh: t.wh, zone: t.zone, bin: '', title: 'Quantity to add' });
        if (!r) return;
        act(() => api('adminAdd', { clientId: uid(), taskId: t.taskId, material: it.m, code: it.b[0], qty: r.qty, bin: r.bin }), 'Item added.');
      };
      const ro = $('[data-reopen]', body);
      if (ro) ro.onclick = async () => {
        if (!(await confirmDialog({ title: `Reopen Task #${t.taskNo}?`, text: `${esc(u.display)} will be able to scan and edit this task again until they press End Scan.`, yes: 'Reopen', no: 'Cancel' }))) return;
        act(() => api('reopenTask', { taskId: t.taskId }), 'Task reopened.');
      };
      const fc = $('[data-force]', body);
      if (fc) fc.onclick = async () => {
        if (!(await confirmDialog({ title: `Close Task #${t.taskNo}?`, text: `This submits the task on behalf of ${esc(u.display)}. Scans still on their device will go into a new task automatically.`, yes: 'Close task', no: 'Cancel' }))) return;
        act(() => api('closeTask', { taskId: t.taskId }), 'Task closed.');
      };
      $('[data-tdel]', body).onclick = async () => {
        if (!(await confirmDialog({ title: `Delete Task #${t.taskNo}?`, text: `All ${lines.length} line(s) (qty ${fmtQty(lines.reduce((s, l) => s + l.qty, 0))}) are removed from the count. The ScanLog tab in the Google Sheet keeps a record.`, yes: 'Delete task', no: 'Cancel', danger: true }))) return;
        act(() => api('deleteTask', { taskId: t.taskId }), 'Task deleted.');
      };
      $$('[data-row]', body).forEach((row) => {
        const id = row.dataset.row, l = lines.find((x) => x.lineId === id);
        const q = $('[data-q]', row), b = $('[data-b]', row), sv = $('[data-save]', row);
        const check = () => { const d = Number(q.value) !== l.qty || b.value.trim().toUpperCase() !== (l.bin || ''); sv.classList.toggle('hidden', !d); dirty = $$('[data-save]:not(.hidden)', body).length > 0; };
        q.oninput = check; b.oninput = check;
        const save = () => {
          const qty = Number(String(q.value).replace(',', '.'));
          if (!(qty > 0)) return toast('Quantity must be greater than 0 (use delete to remove).', 'bad');
          act(() => api('adminEdit', { taskId: l.taskId, key: l.key, expectedQty: l.qty, qty, bin: b.value, material: l.material, description: l.description, barcode: l.barcode }), 'Saved.');
        };
        sv.onclick = save;
        [q, b].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }));
        $('[data-del]', row).onclick = async () => {
          if (!(await confirmDialog({ title: 'Delete this line?', text: `${esc(l.description)} – qty ${fmtQty(l.qty)}`, yes: 'Delete', no: 'Cancel', danger: true }))) return;
          act(() => api('adminEdit', { taskId: l.taskId, key: l.key, expectedQty: l.qty, delete: true, material: l.material, description: l.description, barcode: l.barcode }), 'Line deleted.');
        };
      });
    }
    draw();
  }

  // ================= SAP Comparison (live) =================
  const SAP_FILTERS = [['all', 'All'], ['different', 'Qty different'], ['perfect', 'Qty perfect'], ['short', 'Short'], ['excess', 'Excess'], ['notscanned', 'Not scanned'], ['notinsap', 'Not in SAP']];
  const sapCmp = () => Report.sapCompare({ whs: [S.sapWh], includeOpen: S.sapOpen });
  function renderSap() {
    if (!S.sapWh || !D.warehouses.some((w) => w.code === S.sapWh)) S.sapWh = D.warehouses[0] && D.warehouses[0].code;
    const sapRows = D.sapRows.filter((r) => r[0] === S.sapWh);
    const sapMats = new Set(sapRows.map((r) => r[1])).size, sapQty = sapRows.reduce((s, r) => s + (Number(r[3]) || 0), 0);
    P().innerHTML = `<div data-sap-root>
      <div class="page-head">
        <div><h1>SAP Comparison</h1><p>Scanned quantity vs SAP available stock, per material. Updates live while users scan.</p></div>
        <div class="row wrap">
          <div class="seg" style="margin:0">${D.warehouses.map((x) => `<button data-sw="${x.code}" class="${x.code === S.sapWh ? 'on' : ''}">${esc(x.name)} ${x.code}</button>`).join('')}</div>
          <button class="btn" data-sapup>${I.upload} Upload SAP stock</button><input type="file" accept=".xlsx" data-sapfile class="hidden">
          <button class="btn" data-gsrefresh title="Write the latest comparison into the Google Sheet 'Compare' tab now">${I.refresh} Update Google Sheet</button>
          <button class="btn dark" data-sapxls>${I.download} Download Excel</button>
        </div>
      </div>
      <div class="muted small" style="margin:-6px 2px 12px">${sapRows.length ? `SAP stock loaded · ${fmtQty(sapMats)} materials · ${fmtQty(sapQty)} qty` : '<b style="color:var(--bad)">No SAP stock loaded for this warehouse yet – click Upload SAP stock.</b>'}</div>
      <div class="kpis" data-sapkpis></div>
      <div class="toolbar">
        <div class="chips">${SAP_FILTERS.map(([k, v]) => `<button data-f="${k}" class="${S.sapFilter === k ? 'on' : ''}">${v} <span data-fc="${k}"></span></button>`).join('')}</div>
        <span class="grow"></span>
        <label class="row small" style="gap:6px;cursor:pointer"><input type="checkbox" data-sapopen ${S.sapOpen ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)"> Include tasks in progress</label>
      </div>
      <input class="input" data-sapq placeholder="Search material, description or location…" value="${esc(S.sapQ)}" style="margin-bottom:10px;min-height:42px">
      <div class="tbl-wrap" style="max-height:62vh"><table class="tbl"><thead><tr>
        <th>Material</th><th>Description</th><th class="desktop-only">SAP Location</th><th class="desktop-only">Scanned Location(s)</th>
        <th class="r">SAP Qty</th><th class="r">Scanned</th><th class="r">Difference</th><th>Qty Status</th><th class="desktop-only">Remark</th></tr></thead>
        <tbody data-saprows></tbody></table></div>
      <div class="muted small" data-sapnote style="margin:8px 2px"></div></div>`;
    $$('[data-sw]').forEach((b) => (b.onclick = () => { S.sapWh = b.dataset.sw; renderSap(); }));
    $$('[data-f]').forEach((b) => (b.onclick = () => { S.sapFilter = b.dataset.f; $$('[data-f]').forEach((x) => x.classList.toggle('on', x === b)); renderSapTable(); }));
    $('[data-sapopen]').onchange = (e) => { S.sapOpen = e.target.checked; renderSapKpis(); renderSapTable(); };
    let tm = null;
    $('[data-sapq]').oninput = (e) => { S.sapQ = e.target.value; clearTimeout(tm); tm = setTimeout(renderSapTable, 120); };
    $('[data-gsrefresh]').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api('refreshCompare', {}, { timeout: 180000 }); toast('Google Sheet "Compare" tab updated.', 'ok'); } catch (er) { toast(er.message, 'bad', 6000); }
      b.disabled = false;
    };
    $('[data-sapxls]').onclick = () => withFresh(async () => { const n = await Report.download(await Report.sapWorkbook({ whs: [S.sapWh], includeOpen: S.sapOpen })); toast('Downloaded ' + n, 'ok'); });
    const f = $('[data-sapfile]');
    $('[data-sapup]').onclick = () => f.click();
    f.onchange = async () => {
      const file = f.files[0]; f.value = '';
      if (!file) return;
      const w2 = D.warehouses.find((x) => x.code === S.sapWh);
      let rows;
      try { rows = await Report.parseSap(await file.arrayBuffer()); Report.checkSapWarehouse(S.sapWh, rows); } catch (e) { return toast(e.message, 'bad', 8000); }
      const mats = new Set(rows.map((r) => r.material)).size, qty = rows.reduce((s, r) => s + r.qty, 0);
      if (!(await confirmDialog({ title: `Load SAP stock for ${w2.name} ${w2.code}?`, text: `<b>${esc(file.name)}</b>: ${rows.length} rows, ${fmtQty(mats)} materials, ${fmtQty(qty)} qty.<br>This replaces the current SAP stock for this warehouse. Scans are not changed.`, yes: 'Load SAP stock', no: 'Cancel' }))) return;
      try { toast(`Uploading ${rows.length} rows – please wait…`, '', 6000); await api('uploadSap', { wh: S.sapWh, rows }, { timeout: 300000 }); toast(`SAP stock loaded: ${fmtQty(mats)} materials, ${fmtQty(qty)} qty.`, 'ok', 4000); await sync(); renderSap(); }
      catch (e) { toast(e.message, 'bad', 7000); }
    };
    renderSapKpis(); renderSapTable();
  }
  function renderSapKpis() {
    const el = $('[data-sapkpis]'); if (!el) return;
    S.sap = sapCmp();
    const t = S.sap.totals;
    el.innerHTML = `
      <div class="kpi ok"><div class="k">Qty perfect</div><div class="v">${fmtQty(t.perfect)}</div></div>
      <div class="kpi ${t.different ? 'bad' : ''}"><div class="k">Qty different</div><div class="v">${fmtQty(t.different)}</div></div>
      <div class="kpi"><div class="k">Short / Excess</div><div class="v">${fmtQty(t.short)} <span class="muted" style="font-size:15px">/ ${fmtQty(t.excess)}</span></div></div>
      <div class="kpi"><div class="k">Not scanned yet</div><div class="v">${fmtQty(t.notScanned)}</div></div>
      <div class="kpi"><div class="k">SAP qty</div><div class="v">${fmtQty(t.sapQty)}</div></div>
      <div class="kpi"><div class="k">Scanned qty</div><div class="v">${fmtQty(t.scanQty)}</div></div>
      <div class="kpi ${t.netDiff ? 'bad' : 'ok'}"><div class="k">Net difference</div><div class="v">${t.netDiff > 0 ? '+' : ''}${fmtQty(t.netDiff)}</div></div>`;
    const counts = { all: t.materials, different: t.different, perfect: t.perfect, short: t.short, excess: t.excess, notscanned: t.notScanned, notinsap: t.notInSap };
    $$('[data-fc]').forEach((s) => (s.textContent = fmtQty(counts[s.dataset.fc])));
    const n = $('[data-sapnote]');
    if (n) n.textContent = t.unknownLines ? `${t.unknownLines} unknown-barcode line(s) (qty ${fmtQty(t.unknownQty)}) are not compared because they have no material code.` : '';
  }
  function renderSapTable() {
    const body = $('[data-saprows]'); if (!body) return;
    if (!S.sap) S.sap = sapCmp();
    const q = S.sapQ.trim().toLowerCase(), f = S.sapFilter;
    const rows = S.sap.rows.filter((r) => (f === 'all' || (f === 'different' ? !r.perfect : f === 'perfect' ? r.perfect : r.kind === f))
      && (!q || (r.material + ' ' + r.description + ' ' + r.sapLoc + ' ' + r.scanLoc).toLowerCase().includes(q)));
    const shown = rows.slice(0, 800);
    body.innerHTML = shown.map((r) => `<tr>
      <td class="mono">${hl(r.material, q)}</td><td style="min-width:200px">${hl(r.description, q)}</td>
      <td class="desktop-only small">${esc(r.sapLoc || '—')}</td><td class="desktop-only small">${esc(r.scanLoc || '—')}</td>
      <td class="r num">${fmtQty(r.sapQty)}</td><td class="r num"><b>${fmtQty(r.scanQty)}</b></td>
      <td class="r num"><b style="color:${r.diff < 0 ? 'var(--bad)' : r.diff > 0 ? 'var(--warn)' : 'var(--ok)'}">${r.diff > 0 ? '+' : ''}${fmtQty(r.diff)}</b></td>
      <td><span class="qs ${r.perfect ? 'ok' : 'bad'}">${r.perfect ? I.check : I.alert}${r.status}</span></td>
      <td class="desktop-only small muted">${esc(r.remark)}</td></tr>`).join('')
      || '<tr><td colspan="9" class="empty">Nothing matches this filter.</td></tr>';
    if (rows.length > shown.length) body.insertAdjacentHTML('beforeend', `<tr><td colspan="9" class="muted small">Showing ${shown.length} of ${rows.length}. Use search or download Excel for all.</td></tr>`);
  }

  // ================= Users =================
  function usersPage() {
    const whName = Object.fromEntries(D.warehouses.map((w) => [w.code, w.name]));
    const users = D.users.slice().sort((a, b) => a.wh.localeCompare(b.wh) || a.zone.localeCompare(b.zone) || a.display.localeCompare(b.display));
    P().innerHTML = `
      <div class="page-head"><div><h1>Users</h1><p>Two users per zone are created automatically from the master data. Default PIN is <b>1234</b> – set a personal PIN for each user.</p></div>
        <button class="btn primary" data-add>${I.plus} Add user</button></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Warehouse</th><th>Zone</th><th>User</th><th class="desktop-only">Login name</th><th>PIN</th><th>Status</th><th class="r">Actions</th></tr></thead><tbody>
      ${users.map((u) => `<tr><td>${esc(whName[u.wh] || '')} ${esc(u.wh)}</td><td><b>${esc(u.zone)}</b></td><td><b>${esc(u.display)}</b></td><td class="mono desktop-only">${esc(u.username)}</td>
        <td>${u.pinDefault ? '<span class="badge warn">Default 1234</span>' : '<span class="badge ok">Personal</span>'}</td>
        <td>${u.active ? '<span class="badge ok">Active</span>' : '<span class="badge grey">Disabled</span>'}</td>
        <td class="r"><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn sm" data-pin="${esc(u.username)}" data-name="${esc(u.display)}">${I.key} Set PIN</button>
        <button class="btn sm ${u.active ? 'danger-ghost' : ''}" data-act="${esc(u.username)}" data-on="${u.active ? 0 : 1}">${u.active ? 'Disable' : 'Enable'}</button></div></td></tr>`).join('') || '<tr><td colspan="7" class="empty">No users yet – upload the master data first.</td></tr>'}
      </tbody></table></div>`;
    $$('[data-pin]').forEach((b) => (b.onclick = () => {
      const m = Modal.open(`<h2>Set PIN – ${esc(b.dataset.name)}</h2><p class="sub">4–8 digits. The user is logged out of all devices (their unsaved scans stay on the device).</p>
        <input class="input lg pin-input" data-p inputmode="numeric" maxlength="8" placeholder="••••"><div class="err" data-err></div>
        <div class="actions"><button class="btn lg" data-c>Cancel</button><button class="btn lg primary" data-ok>Save PIN</button></div>`);
      const save = async () => { try { await api('setPin', { username: b.dataset.pin, pin: $('[data-p]', m.el).value }); toast('PIN updated.', 'ok'); m.close(); await sync(); usersPage(); } catch (e) { $('[data-err]', m.el).textContent = e.message; } };
      $('[data-c]', m.el).onclick = () => m.close(); $('[data-ok]', m.el).onclick = save;
      $('[data-p]', m.el).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
      setTimeout(() => $('[data-p]', m.el).focus(), 40);
    }));
    $$('[data-act]').forEach((b) => (b.onclick = async () => {
      try { await api('setActive', { username: b.dataset.act, active: b.dataset.on === '1' }); await sync(); usersPage(); } catch (e) { toast(e.message, 'bad'); }
    }));
    $('[data-add]').onclick = () => {
      const m = Modal.open(`<h2>Add user</h2><p class="sub">Adds the next device number in the zone (e.g. A01-003). PIN starts as 1234.</p>
        <div class="field"><label class="lbl">Warehouse</label><select class="input" data-w>${D.warehouses.map((w) => `<option value="${w.code}">${esc(w.name)} · ${w.code}</option>`).join('')}</select></div>
        <div class="field"><label class="lbl">Zone</label><input class="input" data-z placeholder="e.g. A01" style="text-transform:uppercase"></div><div class="err" data-err></div>
        <div class="actions"><button class="btn lg" data-c>Cancel</button><button class="btn lg primary" data-ok>Add</button></div>`);
      $('[data-c]', m.el).onclick = () => m.close();
      $('[data-ok]', m.el).onclick = async () => {
        try { const x = await api('addUser', { wh: $('[data-w]', m.el).value, zone: $('[data-z]', m.el).value }); toast(`User ${x.username} added.`, 'ok'); m.close(); await sync(); usersPage(); }
        catch (e) { $('[data-err]', m.el).textContent = e.message; }
      };
    };
  }

  // ================= Master data =================
  function masterPage() {
    S.masterWh = S.masterWh || (D.warehouses[0] && D.warehouses[0].code);
    P().innerHTML = `
      <div class="page-head"><div><h1>Master data</h1><p>Material → zone / bin / barcode. Used for scanning and for the location check.</p></div>
        <div class="row wrap"><div class="seg" style="margin:0">${D.warehouses.map((w) => `<button data-mw="${w.code}" class="${S.masterWh === w.code ? 'on' : ''}">${esc(w.name)} ${w.code}</button>`).join('')}</div>
        <button class="btn primary" data-up>${I.upload} Upload master Excel</button><input type="file" accept=".xlsx" data-file class="hidden"></div></div>
      <input class="input" data-q placeholder="Search material, description, barcode or location (e.g. A02 / R03)…" style="margin-bottom:12px">
      <div class="muted small" data-count style="margin:0 2px 8px"></div>
      <div class="tbl-wrap" style="max-height:66vh"><table class="tbl"><thead><tr><th>Material</th><th>Description</th><th>Barcode</th><th>Zone / Bin</th></tr></thead><tbody data-rows></tbody></table></div>`;
    $$('[data-mw]').forEach((b) => (b.onclick = () => { S.masterWh = b.dataset.mw; masterPage(); }));
    const q = $('[data-q]');
    const run = () => {
      const v = q.value.trim().toLowerCase();
      const items = Master.items.filter((m) => m.w === S.masterWh)
        .filter((m) => !v || m._s.includes(v) || m.l.some((l) => `${l.zone} / ${l.bin}`.toLowerCase().includes(v)));
      $('[data-count]').textContent = `${items.length} material(s)${items.length > 300 ? ' – showing first 300, refine the search' : ''}`;
      $('[data-rows]').innerHTML = items.slice(0, 300).map((i) => `<tr><td class="mono">${hl(i.m, q.value)}</td><td>${hl(i.d, q.value)}</td><td class="mono">${hl(i.b.join(', '), q.value)}</td>
        <td>${i.l.map((l) => `<span class="badge grey" style="margin:1px">${esc(l.zone)} / ${esc(l.bin)}</span>`).join(' ')}</td></tr>`).join('')
        || `<tr><td colspan="4" class="empty">${Master.items.some((m) => m.w === S.masterWh) ? 'No match.' : 'No master data for this warehouse yet – click Upload master Excel.'}</td></tr>`;
    };
    let t = null;
    q.oninput = () => { clearTimeout(t); t = setTimeout(run, 150); };
    run();
    const file = $('[data-file]');
    $('[data-up]').onclick = () => file.click();
    file.onchange = async () => {
      const f = file.files[0]; file.value = '';
      if (!f) return;
      const w = D.warehouses.find((x) => x.code === S.masterWh);
      let rows;
      try { rows = await Report.parseMaster(await f.arrayBuffer()); } catch (e) { return toast(e.message, 'bad', 7000); }
      const zones = [...new Set(rows.map((r) => r.zone))].sort();
      if (!(await confirmDialog({ title: `Replace master for ${w.name} ${w.code}?`, text: `<b>${esc(f.name)}</b>: ${rows.length} rows, zones ${esc(zones.join(', '))}.<br>The current master list for this warehouse is replaced. Existing scans are kept and re-checked. New zones get 2 users automatically.`, yes: 'Replace', no: 'Cancel' }))) return;
      try {
        toast(`Uploading ${rows.length} rows – please wait…`, '', 6000);
        const r = await api('uploadMaster', { wh: S.masterWh, rows }, { timeout: 300000 });
        toast(`Master updated: ${r.rows} rows${r.newUsers ? `, ${r.newUsers} new user(s)` : ''}.`, 'ok', 5000);
        await Master.load(true); await sync(); masterPage();
      } catch (e) { toast(e.message, 'bad', 7000); }
    };
  }

  // ================= Activity =================
  async function activityPage() {
    P().innerHTML = '<div class="boot" style="min-height:40vh"><div class="spinner"></div></div>';
    try {
      const r = await api('audit');
      const names = { task_start: 'Started task', task_submit: 'Ended scan (submitted)', task_reopen: 'Reopened task', task_close: 'Closed task',
        task_delete: 'Deleted task', line_add: 'Added item', line_edit: 'Edited quantity', line_delete: 'Deleted item',
        master_import: 'Imported master data', sap_import: 'Loaded SAP stock', user_pin_reset: 'Set user PIN', user_add: 'Added user', user_enable: 'Enabled user', user_disable: 'Disabled user', change_pin: 'Changed own PIN/password' };
      P().innerHTML = `<div class="page-head"><div><h1>Activity log</h1><p>Last 300 actions, newest first. Every single scan is also recorded in the <b>ScanLog</b> tab of the Google Sheet.</p></div>
        ${D.sheetUrl ? `<a class="btn" href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">${I.box} Open Google Sheet</a>` : ''}</div>
        <div class="tbl-wrap" style="max-height:72vh"><table class="tbl"><thead><tr><th>Time</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>
        ${r.rows.map((a) => { let d = ''; try { d = a.details ? Object.entries(JSON.parse(a.details)).map(([k, v]) => `${k}: ${v}`).join(' · ') : ''; } catch (_) { d = a.details; }
          return `<tr><td class="small">${esc(a.at)}</td><td><b>${esc(a.actor)}</b></td><td>${esc(names[a.action] || a.action)}</td><td class="small muted mono">${esc(d)}</td></tr>`; }).join('')
          || '<tr><td colspan="4" class="empty">No activity yet.</td></tr>'}
        </tbody></table></div>`;
    } catch (e) { P().innerHTML = `<div class="card">${esc(e.message)}</div>`; }
  }

  return { start, stop, _data: D, _sync: sync };
})();
