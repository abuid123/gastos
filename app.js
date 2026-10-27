/* Gasto diario: SQLite (sql.js) corriendo en el navegador, guardado en IndexedDB del dispositivo. */
(() => {
'use strict';

/* ---------- utilidades ---------- */
const $ = (s) => document.querySelector(s);
const rid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const CATS = [['super','Súper'],['comida','Comida'],['transporte','Transporte'],['salidas','Salidas'],['casa','Casa'],['salud','Salud'],['otros','Otros']];
const CAT_NAME = Object.fromEntries(CATS);
const MESES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const DIAS = ['dom','lun','mar','mié','jue','vie','sáb'];
const LS = (k) => 'gasto-diario.' + k;
const NAG_DAYS = 14;

const pad = (n) => String(n).padStart(2, '0');
function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function toUTC(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function addDays(s, n) { const t = new Date(toUTC(s) + n * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; }
function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 864e5); }
function endOfMonth(s) { const [y, m] = s.split('-').map(Number); return `${y}-${pad(m)}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`; }
function fmtDate(s, withDay = true) { const [y, m, d] = s.split('-').map(Number); const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return `${withDay ? DIAS[wd] + ' ' : ''}${d} ${MESES[m - 1]}`; }
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
function lsGet(k) { try { return localStorage.getItem(LS(k)); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(LS(k), v); } catch {} }

const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
function money(c, sign = false) {
  const v = Math.round(c / 100);
  const pre = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
  return `${pre}$${nf0.format(Math.abs(v))}`;
}
function parseMonto(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/[$\s]/g, '');
  if (!s) return null;
  let mult = 1;
  if (s.endsWith('k')) { mult = 1000; s = s.slice(0, -1); }
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Math.round(parseFloat(s) * mult * 100);
  return v > 0 ? v : null;
}
const plural = (n, uno, varios) => `${nf0.format(n)} ${n === 1 ? uno : varios}`;
function daysAgoText(iso) {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5);
  return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
}

/* ---------- cálculo del presupuesto (puro) ---------- */
function calc(p, rows, T) {
  const N = diffDays(p.desde, p.hasta) + 1;
  const B = p.monto;
  const daily = {}, fixed = {};
  for (const r of rows) { const bag = r.fijo ? fixed : daily; bag[r.fecha] = (bag[r.fecha] || 0) + r.total; }
  const status = T < p.desde ? 'antes' : T > p.hasta ? 'terminado' : 'activo';
  const idx = status === 'antes' ? 0 : status === 'terminado' ? N - 1 : diffDays(p.desde, T);
  const fx = Object.entries(fixed).map(([f, m]) => ({ f, m, span: diffDays(f, p.hasta) + 1 }));
  const days = [];
  let sumBase = 0, spentBefore = 0, fixedSoFar = 0;
  for (let i = 0; i < N; i++) {
    const d = addDays(p.desde, i);
    let base = B / N;
    for (const x of fx) if (x.f <= d) base -= x.m / x.span;
    fixedSoFar += fixed[d] || 0;
    sumBase += base;
    const avail = p.modo === 'reparto' ? (B - fixedSoFar - spentBefore) / (N - i) : sumBase - spentBefore;
    const spent = daily[d] || 0;
    days.push({ d, base, avail, spent, fixed: fixed[d] || 0 });
    spentBefore += spent;
  }
  const totalDaily = spentBefore;
  const totalFixed = Object.values(fixed).reduce((a, b) => a + b, 0);
  const hoy = days[idx];
  const nominal = p.modo === 'reparto' ? B / N : hoy.base;
  const pastSpent = days.slice(0, idx).reduce((a, x) => a + x.spent, 0);
  const avg = idx > 0 ? pastSpent / idx : null;
  return {
    N, B, idx, status, days, hoy, nominal,
    ajuste: hoy.avail - nominal,
    left: hoy.avail - hoy.spent,
    manana: idx + 1 < N ? days[idx + 1].avail : null,
    totalDaily, totalFixed,
    gastado: totalDaily + totalFixed,
    restante: B - totalDaily - totalFixed,
    avg,
    proyeccion: avg != null ? B - totalFixed - avg * N : null,
  };
}

/* ---------- esquema SQLite ---------- */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS periodo (
  id     TEXT PRIMARY KEY,
  monto  INTEGER NOT NULL,                 -- centavos
  desde  TEXT NOT NULL,                    -- YYYY-MM-DD
  hasta  TEXT NOT NULL,
  modo   TEXT NOT NULL DEFAULT 'arrastre' CHECK (modo IN ('arrastre','reparto')),
  creado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gasto (
  id        TEXT PRIMARY KEY,
  fecha     TEXT NOT NULL,                 -- YYYY-MM-DD
  monto     INTEGER NOT NULL CHECK (monto > 0),  -- centavos
  categoria TEXT NOT NULL,
  nota      TEXT,
  fijo      INTEGER NOT NULL DEFAULT 0,
  creado    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gasto_fecha ON gasto(fecha);`;
const INS_GASTO = 'INSERT OR REPLACE INTO gasto (id, fecha, monto, categoria, nota, fijo, creado) VALUES (?,?,?,?,?,?,?)';
const INS_PERIODO = 'INSERT OR REPLACE INTO periodo (id, monto, desde, hasta, modo, creado) VALUES (?,?,?,?,?,?)';

/* ---------- almacenamiento local: IndexedDB, si no localStorage, si no memoria ---------- */
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b) { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

const IDBStore = {
  kind: 'idb', db: null,
  p(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async open() {
    const r = indexedDB.open('gasto-diario', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    this.db = await this.p(r);
  },
  get(k) { return this.p(this.db.transaction('kv', 'readonly').objectStore('kv').get(k)); },
  set(k, v) {
    const t = this.db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k);
    return new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  },
};
const LSStore = {
  kind: 'ls',
  async open() { localStorage.setItem(LS('probe'), '1'); localStorage.removeItem(LS('probe')); },
  async get(k) { const v = localStorage.getItem(LS('kv.' + k)); if (v == null) return undefined; const o = JSON.parse(v); return o && o.__b64 ? fromB64(o.__b64) : o; },
  async set(k, v) { localStorage.setItem(LS('kv.' + k), JSON.stringify(v instanceof Uint8Array ? { __b64: toB64(v) } : v)); },
};
const MemStore = { kind: 'mem', m: new Map(), async open() {}, async get(k) { return this.m.get(k); }, async set(k, v) { this.m.set(k, v); } };

let SQL = null, sdb = null, kv = null, meta = {};
let saving = false, dirty = false;

function q(sql, params = []) {
  const st = sdb.prepare(sql); st.bind(params);
  const out = []; while (st.step()) out.push(st.getAsObject());
  st.free(); return out;
}
function openDb(bytes) {
  const d = bytes ? new SQL.Database(bytes) : new SQL.Database();
  d.run(SCHEMA);
  return d;
}
function commit(sql, params) {
  sdb.run(sql, params);
  save();
}
async function save() {
  dirty = true;
  if (saving) return;
  saving = true;
  setSave('saving', 'Guardando…');
  try {
    while (dirty) { dirty = false; await kv.set('db', sdb.export()); }
    setSave('ok', savedLabel());
  } catch (e) {
    console.error(e);
    setSave('error', 'No se pudo guardar. Bajá un backup desde Ajustes.');
  } finally {
    saving = false;
    updateFooter();
  }
}
async function saveMeta() { try { await kv.set('meta', meta); } catch (e) { console.error(e); } }
function savedLabel() { return kv.kind === 'mem' ? 'Sin guardar: este navegador no deja guardar datos' : 'Guardado en este dispositivo'; }

/* ---------- interfaz: estado y pie ---------- */
function setSave(s, text) { $('#save-state').dataset.s = s; $('#save-text').textContent = text; }
function counts() { return { gastos: q('SELECT COUNT(*) AS n FROM gasto')[0].n, periodos: q('SELECT COUNT(*) AS n FROM periodo')[0].n }; }
function updateFooter() {
  if (!sdb) return;
  const size = sdb.export().length;
  $('#db-info').textContent = `SQLite · ${(size / 1024).toFixed(0)} KB · ${plural(counts().gastos, 'gasto', 'gastos')}`;
  $('#backup-info').textContent = meta.lastBackup ? `Último backup: ${daysAgoText(meta.lastBackup)}` : 'Todavía no hiciste ningún backup';
}

/* ---------- toast ---------- */
let toastTimer = null;
function toast(text, actionLabel, action, ms) {
  const t = $('#toast'), b = $('#toast-btn');
  $('#toast-text').textContent = text;
  b.hidden = !action;
  if (action) { b.textContent = actionLabel; b.onclick = () => { t.hidden = true; action(); }; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms || (action ? 6000 : 3200));
}

/* ---------- render ---------- */
let cur = null;
let selectedDay = null, showAll = false, lastToday = todayStr();
let category = lsGet('categoria') || 'super';
if (!CAT_NAME[category]) category = 'super';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) e.append(k);
  return e;
}
function svgEl(tag, attrs = {}) { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; }
function setMode(m) { document.body.dataset.mode = m; }

function render() {
  if (!sdb) return;
  lastToday = todayStr();
  const p = q('SELECT * FROM periodo ORDER BY creado DESC LIMIT 1')[0];
  if (!p) { setMode('setup'); renderSetup(); updateFooter(); return; }
  setMode('ready');
  const rows = q('SELECT fecha, fijo, SUM(monto) AS total FROM gasto WHERE fecha BETWEEN ? AND ? GROUP BY fecha, fijo', [p.desde, p.hasta]);
  const c = calc(p, rows, lastToday);
  cur = { p, c };
  if (selectedDay && (selectedDay < p.desde || selectedDay > p.hasta)) selectedDay = null;

  const diaTxt = c.status === 'activo' ? `día ${c.idx + 1} de ${c.N}` : c.status === 'antes' ? `arranca en ${diffDays(lastToday, p.desde)} días` : 'terminado';
  $('#eyebrow').textContent = `Del ${fmtDate(p.desde, false)} al ${fmtDate(p.hasta, false)} · ${diaTxt}`;

  renderHero(c, p);
  renderForm(p);
  renderNag();
  renderPeriodo(c);
  renderChart(c);
  renderCats(p);
  renderMovs(c, p);
  updateFooter();
}

function renderSetup() {
  $('#eyebrow').textContent = 'Primero, cuánta plata tenés y hasta cuándo';
  $('#hero').classList.remove('is-over');
  $('#hero-label').textContent = 'Te quedan para hoy';
  $('#hero-digits').textContent = '—';
  $('#hero-sub').textContent = 'Cargá el monto y las fechas del período. Después anotás cada gasto y esto se actualiza solo.';
  const T = todayStr();
  if (!$('#su-desde').value) $('#su-desde').value = T;
  if (!$('#su-hasta').value) $('#su-hasta').value = endOfMonth(T);
}

function renderHero(c, p) {
  const hero = $('#hero');
  const lab = $('#hero-label'), dig = $('#hero-digits'), sub = $('#hero-sub'), pills = $('#pills'), tm = $('#tomorrow'), meter = $('#meter');
  pills.replaceChildren(); tm.replaceChildren();
  hero.classList.remove('is-over');

  if (c.status === 'terminado') {
    const over = c.restante < 0;
    hero.classList.toggle('is-over', over);
    lab.textContent = over ? 'Terminó el período. Te pasaste' : 'Terminó el período. Te sobró';
    dig.textContent = nf0.format(Math.abs(Math.round(c.restante / 100)));
    sub.replaceChildren('Gastaste ', el('b', { text: money(c.gastado) }), ` de ${money(c.B)}.`);
    meter.style.width = Math.min(100, c.gastado / c.B * 100) + '%';
    pills.append(el('button', { class: 'btn primary', type: 'button', text: 'Empezar período nuevo', onclick: () => openSettings('nuevo') }));
    return;
  }
  if (c.status === 'antes') {
    lab.textContent = `El ${fmtDate(p.desde)} vas a tener`;
    dig.textContent = nf0.format(Math.round(c.hoy.avail / 100));
    sub.textContent = 'El período todavía no empezó.';
    meter.style.width = '0%';
    return;
  }
  const over = c.left < 0;
  hero.classList.toggle('is-over', over);
  lab.textContent = over ? 'Hoy te pasaste' : 'Te quedan para hoy';
  dig.textContent = nf0.format(Math.abs(Math.round(c.left / 100)));
  const avail = c.hoy.avail;
  if (avail <= 0) {
    sub.replaceChildren('Arrancaste el día debiendo ', el('b', { text: money(-avail) }), ' de días anteriores.');
    meter.style.width = '100%'; hero.classList.add('is-over');
  } else if (!c.hoy.spent) {
    sub.replaceChildren('Todavía no anotaste gastos hoy. Tenés ', el('b', { text: money(avail) }), ' disponibles.');
    meter.style.width = '0%';
  } else {
    sub.replaceChildren('Gastaste ', el('b', { text: money(c.hoy.spent) }), ` de ${money(avail)} disponibles hoy.`);
    meter.style.width = Math.min(100, c.hoy.spent / avail * 100) + '%';
  }
  const ajusteLabel = p.modo === 'reparto' ? 'Ajuste' : 'Arrastre';
  const aj = Math.round(c.ajuste / 100) * 100;
  pills.append(
    el('span', { class: 'pill' }, 'Base', el('span', { class: 'num', text: money(c.nominal) })),
    el('span', { class: 'pill ' + (aj > 0 ? 'pos' : aj < 0 ? 'neg' : '') }, ajusteLabel, el('span', { class: 'num', text: aj === 0 ? '$0' : money(aj, true) })),
  );
  if (c.manana != null) {
    tm.append('Mañana: ', el('span', { class: 'num', text: money(c.manana) }), over ? ', ya con lo que te pasaste descontado.' : (c.hoy.spent ? ' si no gastás más hoy.' : ' si hoy no gastás nada.'));
  } else {
    tm.textContent = 'Hoy es el último día del período.';
  }
}

function renderForm(p) {
  const f = $('#in-fecha');
  f.min = p.desde; f.max = p.hasta;
  const T = todayStr();
  const def = T < p.desde ? p.desde : T > p.hasta ? p.hasta : T;
  if (!f.value || f.dataset.auto !== '0' || f.value < p.desde || f.value > p.hasta) { f.value = def; f.dataset.auto = '1'; }
  const chips = $('#chips');
  if (!chips.childElementCount) {
    for (const [k, name] of CATS) chips.append(el('button', { type: 'button', class: 'chip', role: 'radio', 'data-k': k, 'aria-checked': String(k === category), text: name, onclick: () => pickCat(k) }));
  }
}
function pickCat(k) {
  category = k;
  lsSet('categoria', k);
  for (const b of $('#chips').children) b.setAttribute('aria-checked', String(b.dataset.k === k));
}

function renderNag() {
  const box = $('#nag');
  const first = q('SELECT MIN(creado) AS c FROM gasto')[0].c;
  if (!first || kv.kind === 'mem') { box.hidden = true; return; }
  const since = meta.lastBackup || first;
  const d = Math.floor((Date.now() - Date.parse(since)) / 864e5);
  if (d < NAG_DAYS) { box.hidden = true; return; }
  $('#nag-text').replaceChildren(el('b', { text: 'Hacé un backup. ' }),
    meta.lastBackup ? `El último fue hace ${d} días. ` : 'Todavía no hiciste ninguno. ',
    'Tus gastos están guardados solo en este dispositivo: si borrás la app o los datos del navegador, se pierden.');
  box.hidden = false;
}

function renderPeriodo(c) {
  const pct = Math.max(0, Math.min(100, c.gastado / c.B * 100));
  $('#month-fill').style.width = pct + '%';
  $('#monthbar').classList.toggle('over', c.restante < 0);
  const pace = c.status === 'antes' ? 0 : (c.idx + 1) / c.N * 100;
  $('#month-pace').style.left = `calc(${pace}% - 1px)`;
  const ideal = c.B * (c.status === 'antes' ? 0 : (c.idx + 1) / c.N);
  const diff = ideal - c.gastado;
  $('#month-cap').textContent = c.status === 'antes' ? 'El período todavía no empezó.' :
    `Gastaste el ${Math.round(pct)}% del total. La rayita marca hasta dónde podías gastar al terminar hoy: ` +
    (diff >= 0 ? `vas ${money(diff)} por debajo.` : `vas ${money(-diff)} por encima.`);

  const st = $('#stats'); st.replaceChildren();
  const add = (label, value, cls = '', small = '') => st.append(el('div', {}, el('dt', { text: label }), el('dd', { class: cls }, value, small ? el('small', { text: small }) : null)));
  add('Gastado', money(c.gastado), '', c.totalFixed ? `${money(c.totalFixed)} en fijos` : '');
  add('Queda en el período', money(c.restante), c.restante < 0 ? 'neg' : '', `de ${money(c.B)}`);
  add('Promedio por día', c.avg != null ? money(c.avg) : '—', '', c.avg != null ? `base ${money(c.B / c.N)}` : 'aparece mañana');
  if (c.proyeccion != null) add('Al ritmo actual, al cierre', money(c.proyeccion, true), c.proyeccion < 0 ? 'neg' : 'pos', c.proyeccion < 0 ? 'te faltaría' : 'te sobraría');
  else add('Al ritmo actual, al cierre', '—', '', 'aparece mañana');
}

function renderChart(c) {
  const wrap = $('#chart');
  const W = 360, H = 150, top = 12, bottom = 4;
  const N = c.N, step = W / N, bw = Math.max(2, step - 2);
  const upto = c.status === 'antes' ? -1 : c.idx;
  let max = c.B / c.N;
  for (let i = 0; i <= upto; i++) max = Math.max(max, c.days[i].spent, c.days[i].avail);
  max *= 1.08;
  const y = (v) => H - bottom - Math.max(0, v) / max * (H - top - bottom);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gasto por día del período comparado con lo disponible' });
  svg.append(svgEl('line', { x1: 0, x2: W, y1: H - bottom, y2: H - bottom, stroke: 'var(--line)', 'stroke-width': 1 }));
  const yb = y(c.B / c.N);
  svg.append(svgEl('line', { x1: 0, x2: W, y1: yb, y2: yb, stroke: 'var(--muted)', 'stroke-width': 1.2, 'stroke-dasharray': '4 4' }));
  c.days.forEach((d, i) => {
    const x = i * step + (step - bw) / 2;
    const g = svgEl('g', { class: 'col', tabindex: '0', 'aria-label': `${fmtDate(d.d)}: gastaste ${money(d.spent)}` });
    g.append(svgEl('rect', { class: 'hit', x: i * step, y: 0, width: step, height: H, fill: d.d === selectedDay ? 'var(--track)' : 'transparent' }));
    if (i <= upto) {
      const over = d.spent > Math.max(0, d.avail) + 1;
      if (d.spent > 0) {
        const yt = y(d.spent), h = H - bottom - yt, r = Math.min(3, bw / 2, h);
        const x2 = x + bw, yB = H - bottom;
        g.append(svgEl('path', { d: `M${x},${yB}V${yt + r}Q${x},${yt} ${x + r},${yt}H${x2 - r}Q${x2},${yt} ${x2},${yt + r}V${yB}Z`, fill: over ? 'var(--over)' : 'var(--bar)' }));
      }
      if (d.avail > 0) g.append(svgEl('rect', { x: x - 1, y: y(d.avail) - 1, width: bw + 2, height: 2, rx: 1, fill: 'var(--ink)' }));
      if (i === c.idx && c.status === 'activo') g.append(svgEl('circle', { cx: x + bw / 2, cy: H + 5, r: 2.5, fill: 'var(--ink)' }));
    } else {
      g.append(svgEl('rect', { x, y: H - bottom - 2, width: bw, height: 2, rx: 1, fill: 'var(--track)' }));
    }
    const pick = () => { selectedDay = selectedDay === d.d ? null : d.d; showAll = false; render(); };
    g.addEventListener('click', pick);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    svg.append(g);
  });
  const lbl = svgEl('text', { x: W - 2, y: yb - 5, 'text-anchor': 'end', 'font-size': 10, fill: 'var(--muted)', 'font-family': 'DM Mono, ui-monospace, monospace' });
  lbl.textContent = `base ${money(c.B / c.N)}`;
  svg.append(lbl);
  const axis = el('div', { class: 'axis' }, el('span', { text: fmtDate(c.days[0].d, false) }), el('span', { text: c.status === 'activo' ? 'hoy ' + fmtDate(c.days[c.idx].d, false) : '' }), el('span', { text: fmtDate(c.days[N - 1].d, false) }));
  wrap.replaceChildren(svg, axis);

  const cap = $('#daycap');
  const sel = selectedDay ? c.days.find(x => x.d === selectedDay) : null;
  if (sel) {
    const i = c.days.indexOf(sel);
    if (i > upto) cap.replaceChildren(`${fmtDate(sel.d)}: todavía no llegó. Hoy calculado tendría `, el('span', { class: 'num', text: money(sel.avail) }), '.');
    else {
      const diff = sel.avail - sel.spent;
      cap.replaceChildren(`${fmtDate(sel.d)}: gastaste `, el('span', { class: 'num', text: money(sel.spent) }), ' de ', el('span', { class: 'num', text: money(Math.max(0, sel.avail)) }),
        diff >= 0 ? ` (sobraron ${money(diff)})` : ` (te pasaste ${money(-diff)})`, sel.fixed ? ` y ${money(sel.fixed)} en fijos.` : '.');
    }
  } else cap.textContent = 'Tocá un día para ver el detalle y filtrar los movimientos.';
}

function renderCats(p) {
  const rows = q('SELECT categoria, SUM(monto) AS total, COUNT(*) AS n FROM gasto WHERE fecha BETWEEN ? AND ? GROUP BY categoria ORDER BY total DESC', [p.desde, p.hasta]);
  const box = $('#cats'); box.replaceChildren();
  if (!rows.length) { box.append(el('p', { class: 'empty', text: 'Cuando anotes gastos vas a ver acá en qué se te va la plata.' })); return; }
  const total = rows.reduce((a, r) => a + r.total, 0);
  const top = rows[0].total;
  for (const r of rows) {
    const bar = el('span'); bar.style.width = (r.total / top * 100) + '%';
    box.append(el('div', { class: 'cat' },
      el('span', { class: 'name', text: CAT_NAME[r.categoria] || r.categoria }),
      el('span', { class: 'amt' }, money(r.total), el('small', { text: `${Math.round(r.total / total * 100)}%` })),
      el('div', { class: 'track', 'aria-hidden': 'true' }, bar)));
  }
}

function renderMovs(c, p) {
  const box = $('#movs'); box.replaceChildren();
  const all = selectedDay
    ? q('SELECT * FROM gasto WHERE fecha = ? ORDER BY creado DESC', [selectedDay])
    : q('SELECT * FROM gasto WHERE fecha BETWEEN ? AND ? ORDER BY fecha DESC, creado DESC', [p.desde, p.hasta]);
  const LIMIT = 20;
  const list = (showAll || selectedDay) ? all : all.slice(0, LIMIT);
  const btn = $('#btn-todos');
  if (selectedDay) { btn.hidden = false; btn.textContent = 'Ver todo el período'; }
  else { btn.hidden = all.length <= LIMIT || showAll; btn.textContent = `Ver todos (${all.length})`; }
  $('#h-movs').textContent = selectedDay ? `Movimientos del ${fmtDate(selectedDay)}` : 'Movimientos';
  if (!list.length) {
    box.append(el('p', { class: 'empty', text: selectedDay ? 'Ese día no anotaste nada.' : 'Todavía no anotaste nada. Arriba ponés el monto, elegís la categoría y listo.' }));
    return;
  }
  const byDay = new Map();
  for (const g of list) { if (!byDay.has(g.fecha)) byDay.set(g.fecha, []); byDay.get(g.fecha).push(g); }
  for (const [fecha, items] of byDay) {
    const info = c.days.find(d => d.d === fecha);
    const tot = items.reduce((a, g) => a + (g.fijo ? 0 : g.monto), 0);
    const over = info && tot > Math.max(0, info.avail) + 1;
    const head = el('h3', {}, el('span', { text: fecha === lastToday ? `Hoy, ${fmtDate(fecha)}` : fmtDate(fecha) }),
      el('span', { class: 'num' + (over ? ' neg' : ''), text: info && fecha <= lastToday ? `${money(tot)} de ${money(Math.max(0, info.avail))}` : money(tot) }));
    const ul = el('ul');
    for (const g of items) {
      const what = el('div', { class: 'what' }, el('b', { text: CAT_NAME[g.categoria] || g.categoria }), g.fijo ? el('span', { class: 'tag', text: 'fijo' }) : null, g.nota ? el('span', { text: g.nota }) : null);
      const del = el('button', { class: 'del', type: 'button', 'aria-label': `Borrar ${money(g.monto)} de ${CAT_NAME[g.categoria] || g.categoria}`, onclick: () => borrar(g) });
      del.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      ul.append(el('li', { class: 'mov' }, what, el('span', { class: 'amt', text: money(g.monto) }), del));
    }
    box.append(el('div', { class: 'day' }, head, ul));
  }
}

/* ---------- acciones ---------- */
function borrar(g) {
  commit('DELETE FROM gasto WHERE id = ?', [g.id]);
  render();
  toast(`Borraste ${money(g.monto)} de ${CAT_NAME[g.categoria] || g.categoria}`, 'Deshacer', () => {
    commit(INS_GASTO, [g.id, g.fecha, g.monto, g.categoria, g.nota, g.fijo, g.creado]);
    render();
  });
}

function previewAmount(input, out, fallback) {
  const v = parseMonto(input.value);
  out.textContent = input.value.trim() ? (v ? `= ${money(v)}` : 'No entiendo ese monto') : fallback;
}
const HINT = 'Podés escribir 4500, 4.500,50 o 15k';
$('#in-monto').addEventListener('input', () => { $('#in-err').textContent = ''; previewAmount($('#in-monto'), $('#in-preview'), HINT); });
$('#in-fecha').addEventListener('change', (e) => { e.target.dataset.auto = e.target.value === todayStr() ? '1' : '0'; });
$('#su-monto').addEventListener('input', () => previewAmount($('#su-monto'), $('#su-preview'), ''));

$('#f-gasto').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!cur) return;
  const v = parseMonto($('#in-monto').value);
  if (!v) { $('#in-err').textContent = 'Escribí un monto, por ejemplo 4500, 4.500,50 o 15k.'; $('#in-monto').focus(); return; }
  const fecha = isDate($('#in-fecha').value) ? $('#in-fecha').value : todayStr();
  const fijo = $('#in-fijo').checked ? 1 : 0;
  const nota = $('#in-nota').value.trim() || null;
  const id = rid();
  commit(INS_GASTO, [id, fecha, v, category, nota, fijo, new Date().toISOString()]);
  $('#in-monto').value = ''; $('#in-nota').value = ''; $('#in-fijo').checked = false;
  $('#in-preview').textContent = HINT;
  $('#in-monto').blur();
  render();
  toast(`Anotado: ${money(v)} en ${CAT_NAME[category]}`, 'Deshacer', () => { commit('DELETE FROM gasto WHERE id = ?', [id]); render(); });
});

$('#setup').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = parseMonto($('#su-monto').value), d = $('#su-desde').value, h = $('#su-hasta').value;
  const err = $('#su-err');
  if (!v) { err.textContent = 'Escribí cuánta plata tenés para el período.'; return; }
  if (!isDate(d) || !isDate(h) || h < d) { err.textContent = 'Revisá las fechas: "hasta" tiene que ser igual o posterior a "desde".'; return; }
  err.textContent = '';
  commit(INS_PERIODO, [rid(), v, d, h, 'arrastre', new Date().toISOString()]);
  render();
});

$('#btn-todos').addEventListener('click', () => { if (selectedDay) selectedDay = null; else showAll = true; render(); });

/* ---------- ajustes ---------- */
const dlg = $('#dlg');
function openSettings(focus) {
  if (!cur && focus !== 'backup') return;
  if (cur) {
    const { p, c } = cur;
    $('#aj-monto').value = nf0.format(Math.round(p.monto / 100));
    $('#aj-desde').value = p.desde; $('#aj-hasta').value = p.hasta;
    $(p.modo === 'reparto' ? '#aj-modo-r' : '#aj-modo-a').checked = true;
    const T = todayStr();
    const npDesde = T > p.hasta ? T : addDays(p.hasta, 1);
    $('#np-monto').value = nf0.format(Math.round(p.monto / 100));
    $('#np-desde').value = npDesde; $('#np-hasta').value = endOfMonth(npDesde);
    const r = Math.round(c.restante / 100) * 100;
    $('#np-arrastre').checked = false;
    $('#np-arrastre-wrap').hidden = r === 0;
    $('#np-arrastre-txt').textContent = r > 0 ? `Sumar lo que sobró de este período (${money(r)})` : `Descontar lo que me pasé en este período (${money(-r)})`;
  }
  $('#aj-err').textContent = ''; $('#np-err').textContent = '';
  if (!dlg.open) { try { dlg.showModal(); } catch { dlg.setAttribute('open', ''); } }
  if (focus === 'nuevo') setTimeout(() => $('#np-monto').focus(), 50);
  if (focus === 'backup') setTimeout(() => $('#sec-backup').scrollIntoView({ block: 'nearest' }), 50);
}
$('#btn-ajustes').addEventListener('click', () => { $('#exp-msg').textContent = ''; $('#imp-confirm').hidden = true; openSettings(); });
$('#dlg-close').addEventListener('click', () => dlg.close());
dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

$('#f-ajustes').addEventListener('submit', (e) => {
  e.preventDefault();
  const { p } = cur;
  const v = parseMonto($('#aj-monto').value), d = $('#aj-desde').value, h = $('#aj-hasta').value;
  const modo = document.querySelector('input[name="modo"]:checked')?.value || 'arrastre';
  if (!v) { $('#aj-err').textContent = 'Escribí un monto válido.'; return; }
  if (!isDate(d) || !isDate(h) || h < d) { $('#aj-err').textContent = 'Revisá las fechas: "hasta" tiene que ser igual o posterior a "desde".'; return; }
  commit('UPDATE periodo SET monto = ?, desde = ?, hasta = ?, modo = ? WHERE id = ?', [v, d, h, modo, p.id]);
  dlg.close(); render(); toast('Guardaste los ajustes del período');
});

$('#f-nuevo').addEventListener('submit', (e) => {
  e.preventDefault();
  const { p, c } = cur;
  let v = parseMonto($('#np-monto').value);
  const d = $('#np-desde').value, h = $('#np-hasta').value;
  if (!v) { $('#np-err').textContent = 'Escribí cuánta plata tenés para el período nuevo.'; return; }
  if (!isDate(d) || !isDate(h) || h < d) { $('#np-err').textContent = 'Revisá las fechas: "hasta" tiene que ser igual o posterior a "desde".'; return; }
  if (!$('#np-arrastre-wrap').hidden && $('#np-arrastre').checked) v = Math.max(100, v + Math.round(c.restante / 100) * 100);
  if (p.hasta >= d) {
    const nuevoHasta = addDays(d, -1);
    if (nuevoHasta >= p.desde) commit('UPDATE periodo SET hasta = ? WHERE id = ?', [nuevoHasta, p.id]);
  }
  commit(INS_PERIODO, [rid(), v, d, h, p.modo, new Date().toISOString()]);
  selectedDay = null; showAll = false;
  dlg.close(); render(); toast(`Período nuevo: ${money(v)} del ${fmtDate(d, false)} al ${fmtDate(h, false)}`);
});

/* ---------- backup: exportar ---------- */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function saveFile(name, blob) {
  if (isIOS && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return 'ok'; }
      catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'ok';
}
async function exportBackup() {
  const name = `gastos-${todayStr()}.sqlite`;
  const res = await saveFile(name, new Blob([sdb.export()], { type: 'application/octet-stream' }));
  const msg = $('#exp-msg');
  if (res === 'cancel') { msg.textContent = 'Cancelaste el backup.'; return; }
  meta.lastBackup = new Date().toISOString();
  await saveMeta();
  msg.textContent = `Listo: ${name}. Guardalo fuera del dispositivo (iCloud, Drive o un mail) para que sirva si perdés el teléfono.`;
  render();
  toast('Backup listo');
}
$('#exp-db').addEventListener('click', exportBackup);
$('#nag-btn').addEventListener('click', exportBackup);
$('#exp-csv').addEventListener('click', async () => {
  const rows = q('SELECT fecha, categoria, nota, monto, fijo FROM gasto ORDER BY fecha, creado');
  const esc = (s) => /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  const lines = ['fecha;categoria;detalle;monto;fijo', ...rows.map(r => [r.fecha, CAT_NAME[r.categoria] || r.categoria, esc(r.nota || ''), (r.monto / 100).toFixed(2).replace('.', ','), r.fijo ? 'sí' : 'no'].join(';'))];
  const res = await saveFile(`gastos-${todayStr()}.csv`, new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }));
  $('#exp-msg').textContent = res === 'cancel' ? '' : 'CSV listo. Se abre con Excel o Google Sheets (separado por punto y coma).';
});

/* ---------- backup: importar (.sqlite, o el .zip que baja la versión de Claude) ---------- */
async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Tu navegador no puede abrir ese .zip. Descomprimilo y elegí el archivo .sqlite.');
  const stream = new Blob([u8]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function sqliteFromZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El .zip está dañado.');
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const entries = [];
  for (let k = 0; k < n && dv.getUint32(off, true) === 0x02014b50; k++) {
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nlen = dv.getUint16(off + 28, true), xlen = dv.getUint16(off + 30, true), clen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nlen));
    entries.push({ name, method, csize, lho });
    off += 46 + nlen + xlen + clen;
  }
  const pick = entries.find(e => /\.(sqlite3?|db)$/i.test(e.name)) || entries.find(e => !e.name.endsWith('/'));
  if (!pick) throw new Error('El .zip no tiene ningún archivo de base de datos.');
  const start = pick.lho + 30 + dv.getUint16(pick.lho + 26, true) + dv.getUint16(pick.lho + 28, true);
  const data = u8.subarray(start, start + pick.csize);
  if (pick.method === 0) return data.slice();
  if (pick.method === 8) return inflateRaw(data);
  throw new Error('No puedo abrir ese tipo de .zip. Descomprimilo y elegí el archivo .sqlite.');
}
const SQLITE_MAGIC = 'SQLite format 3\0';
function isSqlite(u8) { return u8.length >= 16 && String.fromCharCode(...u8.subarray(0, 16)) === SQLITE_MAGIC; }

let pendingImport = null;
async function readBackup(file) {
  let u8 = new Uint8Array(await file.arrayBuffer());
  if (u8[0] === 0x50 && u8[1] === 0x4b) u8 = await sqliteFromZip(u8);
  if (!isSqlite(u8)) throw new Error('Ese archivo no es un backup de esta app. Elegí un .sqlite (o el .zip que baja la versión de Claude).');
  let test;
  try { test = new SQL.Database(u8); } catch { throw new Error('El archivo está dañado o no es una base SQLite.'); }
  try {
    const tables = (test.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values || []).map(r => r[0]);
    if (!tables.includes('gasto') || !tables.includes('periodo')) throw new Error('Esa base SQLite no es de esta app: le faltan las tablas gasto y periodo.');
    test.run(SCHEMA);
    const g = test.exec('SELECT COUNT(*) FROM gasto')[0].values[0][0];
    const p = test.exec('SELECT COUNT(*) FROM periodo')[0].values[0][0];
    return { bytes: test.export(), gastos: g, periodos: p, name: file.name };
  } finally { test.close(); }
}
async function applyImport(imp) {
  const prev = sdb.export();
  try { await kv.set('antes-de-importar', prev); } catch {}
  sdb.close(); sdb = openDb(imp.bytes);
  selectedDay = null; showAll = false;
  await save();
  render();
  toast(`Importaste ${plural(imp.gastos, 'gasto', 'gastos')}`, 'Deshacer', async () => {
    sdb.close(); sdb = openDb(prev); await save(); render();
  }, 8000);
}
async function handleImportFile(file) {
  const msg = $('#exp-msg');
  try {
    const imp = await readBackup(file);
    const now = counts();
    if (!now.gastos && !now.periodos) { if (dlg.open) dlg.close(); await applyImport(imp); return; }
    pendingImport = imp;
    openSettings('backup');
    $('#imp-confirm-text').textContent = `"${imp.name}" tiene ${plural(imp.gastos, 'gasto', 'gastos')} y ${plural(imp.periodos, 'período', 'períodos')}. Va a reemplazar lo que tenés ahora (${plural(now.gastos, 'gasto', 'gastos')}). Podés deshacerlo enseguida si te equivocaste.`;
    $('#imp-confirm').hidden = false;
    msg.textContent = '';
    $('#imp-ok').focus();
  } catch (e) {
    console.warn(e);
    if (cur) { openSettings('backup'); msg.textContent = e.message || 'No pude leer ese archivo.'; }
    else toast(e.message || 'No pude leer ese archivo.', null, null, 6000);
  }
}
const fileInput = $('#imp-file');
function pickFile() { fileInput.value = ''; fileInput.click(); }
$('#imp-btn').addEventListener('click', pickFile);
$('#su-import').addEventListener('click', pickFile);
fileInput.addEventListener('change', () => { const f = fileInput.files && fileInput.files[0]; if (f) handleImportFile(f); });
$('#imp-cancel').addEventListener('click', () => { pendingImport = null; $('#imp-confirm').hidden = true; });
$('#imp-ok').addEventListener('click', async () => {
  if (!pendingImport) return;
  const imp = pendingImport; pendingImport = null;
  $('#imp-confirm').hidden = true;
  dlg.close();
  await applyImport(imp);
});

/* ---------- instalar como app ---------- */
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isMacSafari = /Macintosh/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|Firefox|OPR/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1);
const shareGlyph = '<svg class="share-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>';
let deferredPrompt = null;
function showInstall(html, withButton) {
  if (standalone || lsGet('install-ok')) return;
  $('#install-text').innerHTML = html;
  $('#install-btn').hidden = !withButton;
  $('#install').hidden = false;
}
$('#install-dismiss').addEventListener('click', () => { lsSet('install-ok', '1'); $('#install').hidden = true; });
if (isIOS) {
  const dev = /iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !/iPhone/.test(navigator.userAgent) ? 'iPad' : 'iPhone';
  showInstall(`<b>Instalala en tu ${dev}.</b> Tocá Compartir ${shareGlyph} y después <b>Agregar a pantalla de inicio</b>. Usala siempre desde ese ícono: lo que anotes acá en el navegador no pasa a la app instalada.`);
} else if (isMacSafari) {
  showInstall('<b>Instalala en la Mac.</b> En Safari, menú <b>Archivo</b> y después <b>Agregar al Dock</b>. Usala siempre desde el Dock: lo que anotes acá en Safari no pasa a la app.');
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  showInstall('<b>Instalala como app.</b> Se abre en su propia ventana y funciona sin internet.', true);
});
$('#install-btn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  const r = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  if (r && r.outcome === 'accepted') $('#install').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });

/* ---------- service worker (modo sin conexión y actualizaciones) ---------- */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Hay una versión nueva de la app', 'Actualizar', () => location.reload(), 15000);
  });
}

/* ---------- arranque ---------- */
async function boot() {
  setMode('loading');
  try {
    SQL = await initSqlJs({ locateFile: (f) => f });
  } catch (e) {
    console.error(e); setMode('error');
    $('#eyebrow').textContent = 'No pude cargar SQLite';
    $('#hero-sub').textContent = 'Revisá la conexión y volvé a abrir la app. La primera vez necesita internet.';
    setSave('error', 'Sin base de datos'); return;
  }
  for (const s of [IDBStore, LSStore, MemStore]) {
    try { await s.open(); kv = s; break; } catch (e) { console.warn('almacenamiento', s.kind, e); }
  }
  let bytes;
  try {
    bytes = await kv.get('db');
    meta = (await kv.get('meta')) || {};
  } catch (e) {
    console.error(e); setMode('error');
    $('#eyebrow').textContent = 'No pude leer tus datos guardados';
    $('#hero-sub').textContent = 'Para no pisar nada, no abro una base vacía. Cerrá y volvé a abrir la app.';
    setSave('error', 'Sin acceso a los datos'); return;
  }
  if (bytes && !(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  try { sdb = openDb(bytes || null); }
  catch (e) {
    console.error(e); setMode('error');
    $('#eyebrow').textContent = 'Tus datos guardados están dañados';
    $('#hero-sub').textContent = 'Si tenés un backup, podés importarlo desde un navegador nuevo.';
    setSave('error', 'Base dañada'); return;
  }
  setSave(kv.kind === 'mem' ? 'error' : 'ok', savedLabel());
  render();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

setInterval(() => { if (sdb && todayStr() !== lastToday) render(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && sdb && todayStr() !== lastToday) render(); });

boot();
})();
