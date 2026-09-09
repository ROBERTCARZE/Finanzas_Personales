// ============================================
// MÓDULO 9 — Ciclo Menstrual y Finanzas
// Aprende de tu historial: cada vez que registras
// un inicio de regla, recalcula tu duración de ciclo
// promedio (y de período) a partir de los datos reales,
// no de un número fijo que tú escribas.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, deleteDoc, onSnapshot,
  query, orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HEALTH_CATEGORY_NAME = 'Salud e Higiene';
const PHASE_LABELS = { menstrual: 'Menstrual', folicular: 'Folicular', ovulatoria: 'Ovulatoria', lutea: 'Lútea' };
const PHASE_SUGGESTIONS = {
  menstrual: 'Energía más baja de lo habitual. Considera aligerar tu carga en el Horario Personal y bajar la intensidad en el Gimnasio estos días.',
  folicular: 'Energía en aumento — buen momento para tareas que requieran más esfuerzo o iniciar cosas nuevas.',
  ovulatoria: 'Pico de energía del ciclo. Es un buen momento para entrenamientos más intensos o tareas exigentes.',
  lutea: 'La energía empieza a bajar. Prioriza descanso y reduce el volumen de entrenamiento hacia el final de esta fase.',
};
const PROTECTION_LABELS = { ninguno: 'Sin protección', condon: 'Condón', otro: 'Otro método' };

let uid = null;
let cycleLogs = [];
let intimacyLogs = [];
let categories = [];
let transactions = [];

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  document.getElementById('pageLoader')?.classList.add('hidden');

  listenCycleLogs();
  listenIntimacyLogs();
  listenCategories();
  listenTransactions();
  attachEventListeners();
});

function listenCycleLogs() {
  const q = query(collection(db, 'users', uid, 'cycleLogs'), orderBy('startDate'));
  onSnapshot(q, (snap) => {
    cycleLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenIntimacyLogs() {
  const q = query(collection(db, 'users', uid, 'intimacyLogs'), orderBy('date', 'desc'));
  onSnapshot(q, (snap) => {
    intimacyLogs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderIntimacyList();
  });
}
function listenCategories() {
  onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenTransactions() {
  onSnapshot(collection(db, 'users', uid, 'transactions'), (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}
function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ---------- El modelo: aprende del historial de cycleLogs ----------
function buildCycleModel() {
  if (cycleLogs.length === 0) return null;
  const sorted = [...cycleLogs].sort((a, b) => a.startDate.localeCompare(b.startDate));

  const lengths = [];
  for (let i = 1; i < sorted.length; i++) {
    const d1 = new Date(sorted[i - 1].startDate + 'T00:00:00');
    const d2 = new Date(sorted[i].startDate + 'T00:00:00');
    const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    if (diff > 0) lengths.push(diff);
  }
  const avgCycleLength = lengths.length > 0
    ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length)
    : 28;

  const periodLengths = sorted.map((l) => Number(l.periodLength)).filter((v) => v > 0);
  const avgPeriodLength = periodLengths.length > 0
    ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length)
    : 5;

  return { sorted, avgCycleLength, avgPeriodLength, sampleSize: lengths.length, lastStart: sorted[sorted.length - 1].startDate };
}

// ---------- Info del ciclo actual: fase, fertilidad, pronóstico ----------
function computeCycleInfo(model) {
  const start = new Date(model.lastStart + 'T00:00:00');
  const today = new Date();
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const cyclesElapsed = Math.floor(diffDays / model.avgCycleLength);
  const cycleDay = (diffDays % model.avgCycleLength + model.avgCycleLength) % model.avgCycleLength + 1;

  const currentCycleStart = addDays(start, cyclesElapsed * model.avgCycleLength);

  const ovulationDay = model.avgCycleLength - 14; // día de mayor fertilidad (pico)
  const fertileStart = Math.max(1, ovulationDay - 5);
  const fertileEnd = Math.min(model.avgCycleLength, ovulationDay + 1);

  let phase;
  if (cycleDay <= model.avgPeriodLength) phase = 'menstrual';
  else if (cycleDay < ovulationDay - 1) phase = 'folicular';
  else if (cycleDay <= ovulationDay + 1) phase = 'ovulatoria';
  else phase = 'lutea';

  const daysUntilNextPeriod = model.avgCycleLength - cycleDay + 1;
  const nextPeriodDate = addDays(today, daysUntilNextPeriod);

  return {
    cycleDay, phase, ovulationDay, fertileStart, fertileEnd,
    currentCycleStart, daysUntilNextPeriod, nextPeriodDate,
    fertileWindowStart: addDays(currentCycleStart, fertileStart - 1),
    fertileWindowEnd: addDays(currentCycleStart, fertileEnd - 1),
    peakOvulationDate: addDays(currentCycleStart, ovulationDay - 1),
  };
}

function phaseForDay(day, model, ovulationDay) {
  if (day <= model.avgPeriodLength) return 'menstrual';
  if (day < ovulationDay - 1) return 'folicular';
  if (day <= ovulationDay + 1) return 'ovulatoria';
  return 'lutea';
}

// ---------- Render principal ----------
function render() {
  const model = buildCycleModel();

  if (!model) {
    document.getElementById('kpiPhase').textContent = 'Sin registros';
    document.getElementById('kpiCycleDay').textContent = 'Registra tu primera regla para empezar';
    document.getElementById('kpiNextPeriod').textContent = '—';
    document.getElementById('kpiFertileWindow').textContent = '—';
    document.getElementById('cycleStrip').innerHTML = '<div class="widget-empty">Registra al menos un inicio de regla para ver el calendario del ciclo.</div>';
    document.getElementById('forecastList').innerHTML = '<div class="forecast-row"><span>Sin datos suficientes todavía</span></div>';
    document.getElementById('cycleHistoryList').innerHTML = '<div class="widget-empty">Sin registros todavía.</div>';
    document.getElementById('suggestionText').textContent = 'Registra tu ciclo para recibir sugerencias.';
    document.getElementById('sampleNote').textContent = '';
    renderCost();
    return;
  }

  const info = computeCycleInfo(model);

  const phaseCard = document.getElementById('phaseCard');
  phaseCard.className = `kpi-card phase-card ${info.phase}`;
  document.getElementById('kpiPhase').textContent = PHASE_LABELS[info.phase];
  document.getElementById('kpiCycleDay').textContent = `Día ${info.cycleDay} de ${model.avgCycleLength}`;
  document.getElementById('kpiNextPeriod').textContent = `${formatDate(info.nextPeriodDate.toISOString().slice(0, 10))} (en ${info.daysUntilNextPeriod}d)`;
  document.getElementById('kpiFertileWindow').textContent = `${formatDate(info.fertileWindowStart.toISOString().slice(0, 10))} – ${formatDate(info.fertileWindowEnd.toISOString().slice(0, 10))}`;
  document.getElementById('suggestionText').textContent = PHASE_SUGGESTIONS[info.phase];

  document.getElementById('sampleNote').textContent = model.sampleSize > 0
    ? `Calculado con ${model.sampleSize} ciclo${model.sampleSize > 1 ? 's' : ''} registrados`
    : 'Registra un segundo ciclo para calcular el promedio';

  renderStrip(model, info);
  renderForecast(model, info);
  renderHistory(model);
  renderCost();
}

// ---------- Tira visual del ciclo actual ----------
function renderStrip(model, info) {
  const strip = document.getElementById('cycleStrip');
  strip.innerHTML = '';
  for (let day = 1; day <= model.avgCycleLength; day++) {
    const phase = phaseForDay(day, model, info.ovulationDay);
    const isFertile = day >= info.fertileStart && day <= info.fertileEnd;
    const isPeak = day === info.ovulationDay;
    const isToday = day === info.cycleDay;

    const cell = document.createElement('div');
    cell.className = `strip-day ${phase}${isToday ? ' today' : ''}`;
    cell.title = `Día ${day} · ${PHASE_LABELS[phase]}${isFertile ? ' · Fértil' : ''}${isPeak ? ' · Pico de ovulación' : ''}`;
    cell.innerHTML = `${day}${isPeak ? '<span class="peak-star">★</span>' : (isFertile ? '<span class="fertile-dot"></span>' : '')}`;
    strip.appendChild(cell);
  }
}

// ---------- Pronóstico de próximos ciclos ----------
function renderForecast(model, info) {
  const list = document.getElementById('forecastList');
  list.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = addDays(info.nextPeriodDate, i * model.avgCycleLength);
    const row = document.createElement('div');
    row.className = 'forecast-row';
    row.innerHTML = `<span>Regla ${i + 1}</span><span>${formatDate(d.toISOString().slice(0, 10))}</span>`;
    list.appendChild(row);
  }
}

// ---------- Historial de ciclos registrados ----------
function renderHistory(model) {
  const container = document.getElementById('cycleHistoryList');
  container.innerHTML = '';
  const sortedDesc = [...model.sorted].reverse();

  sortedDesc.forEach((log, idx) => {
    const prev = model.sorted[model.sorted.indexOf(log) - 1];
    const length = prev ? Math.round((new Date(log.startDate) - new Date(prev.startDate)) / (1000 * 60 * 60 * 24)) : null;

    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `
      <div>
        <div class="log-main">${formatDate(log.startDate)}${log.periodLength ? ` · ${log.periodLength}d de regla` : ''}</div>
        <div class="log-sub">${length ? `Ciclo de ${length} días` : 'Primer registro'}</div>
      </div>
      <button type="button" class="log-delete" data-id="${log.id}" title="Eliminar">✕</button>
    `;
    row.querySelector('.log-delete').addEventListener('click', () => deleteCycleLog(log.id));
    container.appendChild(row);
  });
}

// ---------- Cruce financiero ----------
function renderCost() {
  const healthCategory = categories.find((c) => c.name === HEALTH_CATEGORY_NAME);
  const month = new Date().toISOString().slice(0, 7);
  const cost = healthCategory
    ? transactions.filter((tx) => tx.categoryId === healthCategory.id && (tx.date || '').startsWith(month))
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
    : 0;
  document.getElementById('kpiCost').textContent = formatMoney(cost);
}

// ---------- Relaciones registradas ----------
function renderIntimacyList() {
  const container = document.getElementById('intimacyList');
  container.innerHTML = '';
  if (intimacyLogs.length === 0) {
    container.innerHTML = '<div class="widget-empty">Sin registros todavía.</div>';
    return;
  }
  intimacyLogs.slice(0, 10).forEach((l) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `
      <div>
        <div class="log-main">${formatDate(l.date)}${l.internalEjaculation ? ' · Con eyaculación interna' : ''}
          <span class="protection-chip ${l.protection}">${PROTECTION_LABELS[l.protection] || l.protection}</span>
        </div>
        ${l.notes ? `<div class="log-sub">${escapeHtml(l.notes)}</div>` : ''}
      </div>
      <button type="button" class="log-delete" data-id="${l.id}" title="Eliminar">✕</button>
    `;
    row.querySelector('.log-delete').addEventListener('click', () => deleteIntimacyLog(l.id));
    container.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- CRUD: registro de ciclo ----------
function openCycleLogDrawer() {
  document.getElementById('cycleLogDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('cycleLogPeriodLength').value = 5;
  document.getElementById('cycleLogOverlay').classList.add('open');
}
function closeCycleLogDrawer() { document.getElementById('cycleLogOverlay').classList.remove('open'); }

async function handleCycleLogSubmit(e) {
  e.preventDefault();
  await addDoc(collection(db, 'users', uid, 'cycleLogs'), {
    startDate: document.getElementById('cycleLogDate').value,
    periodLength: parseInt(document.getElementById('cycleLogPeriodLength').value, 10) || 5,
  });

  if (!categories.some((c) => c.name === HEALTH_CATEGORY_NAME)) {
    await addDoc(collection(db, 'users', uid, 'categories'), { name: HEALTH_CATEGORY_NAME, type: 'expense' });
  }

  closeCycleLogDrawer();
}
async function deleteCycleLog(id) {
  if (!confirm('¿Eliminar este registro de ciclo?')) return;
  await deleteDoc(doc(db, 'users', uid, 'cycleLogs', id));
}

// ---------- CRUD: registro de relación ----------
function openIntimacyDrawer() {
  document.getElementById('intimacyDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('intimacyProtection').value = 'ninguno';
  document.getElementById('intimacyEjaculation').checked = false;
  document.getElementById('intimacyNotes').value = '';
  document.getElementById('intimacyOverlay').classList.add('open');
}
function closeIntimacyDrawer() { document.getElementById('intimacyOverlay').classList.remove('open'); }

async function handleIntimacySubmit(e) {
  e.preventDefault();
  await addDoc(collection(db, 'users', uid, 'intimacyLogs'), {
    date: document.getElementById('intimacyDate').value,
    protection: document.getElementById('intimacyProtection').value,
    internalEjaculation: document.getElementById('intimacyEjaculation').checked,
    notes: document.getElementById('intimacyNotes').value.trim(),
  });
  closeIntimacyDrawer();
}
async function deleteIntimacyLog(id) {
  if (!confirm('¿Eliminar este registro?')) return;
  await deleteDoc(doc(db, 'users', uid, 'intimacyLogs', id));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newCycleLogBtn').addEventListener('click', openCycleLogDrawer);
  document.getElementById('closeCycleLogBtn').addEventListener('click', closeCycleLogDrawer);
  document.getElementById('cycleLogOverlay').addEventListener('click', (e) => { if (e.target.id === 'cycleLogOverlay') closeCycleLogDrawer(); });
  document.getElementById('cycleLogForm').addEventListener('submit', handleCycleLogSubmit);

  document.getElementById('newIntimacyBtn').addEventListener('click', openIntimacyDrawer);
  document.getElementById('closeIntimacyBtn').addEventListener('click', closeIntimacyDrawer);
  document.getElementById('intimacyOverlay').addEventListener('click', (e) => { if (e.target.id === 'intimacyOverlay') closeIntimacyDrawer(); });
  document.getElementById('intimacyForm').addEventListener('submit', handleIntimacySubmit);

  document.getElementById('privacyBtn').addEventListener('click', () => {
    document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
