// ============================================
// MÓDULO 11 — Registro de Gimnasio
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, getDoc, deleteDoc,
  query, orderBy, onSnapshot, limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const DAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

let uid = null;
let settings = { goalDays: 16, membershipCost: 0 };
let checkins = {}; // { 'YYYY-MM-DD': true }
let logs = [];
let metrics = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  await loadSettings();
  await loadCycleTip();
  listenCheckins();
  listenLogs();
  listenMetrics();
  attachEventListeners();
});

async function loadSettings() {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'gym'));
  if (snap.exists()) settings = snap.data();
}

async function loadCycleTip() {
  const snap = await getDoc(doc(db, 'users', uid, 'settings', 'cycle'));
  const tipEl = document.getElementById('kpiCycleTip');
  if (!snap.exists()) return;

  const s = snap.data();
  const start = new Date(s.lastPeriodStart + 'T00:00:00');
  const today = new Date();
  const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const cycleDay = ((diffDays % s.avgCycleLength) + s.avgCycleLength) % s.avgCycleLength + 1;
  const ovulationDay = s.avgCycleLength - 14;

  let phase;
  if (cycleDay <= s.avgPeriodLength) phase = 'menstrual';
  else if (cycleDay < ovulationDay - 1) phase = 'folicular';
  else if (cycleDay <= ovulationDay + 1) phase = 'ovulatoria';
  else phase = 'lutea';

  const tips = {
    menstrual: 'Fase menstrual: considera una sesión ligera o de movilidad hoy.',
    folicular: 'Fase folicular: buena energía disponible — puedes subir intensidad.',
    ovulatoria: 'Fase ovulatoria: pico de energía, buen día para un entrenamiento fuerte.',
    lutea: 'Fase lútea: baja el volumen si sientes menos energía.',
  };
  tipEl.textContent = tips[phase];
}

function listenCheckins() {
  onSnapshot(collection(db, 'users', uid, 'gymCheckins'), (snap) => {
    checkins = {};
    snap.docs.forEach((d) => { checkins[d.id] = d.data().attended; });
    renderCalendar();
    renderKpis();
  });
}
function listenLogs() {
  const q = query(collection(db, 'users', uid, 'trainingLogs'), orderBy('date', 'desc'), limit(10));
  onSnapshot(q, (snap) => {
    logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderLogs();
  });
}
function listenMetrics() {
  const q = query(collection(db, 'users', uid, 'bodyMetrics'), orderBy('date', 'desc'), limit(10));
  onSnapshot(q, (snap) => {
    metrics = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderMetrics();
  });
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}
function pad(n) { return String(n).padStart(2, '0'); }

// ---------- Calendario del mes actual ----------
function renderCalendar() {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthLabel = today.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
  document.getElementById('calendarMonthLabel').textContent = `Check-in de ${monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}`;

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingEmpty = (firstDay.getDay() + 6) % 7; // lunes=0

  const grid = document.getElementById('checkinGrid');
  grid.innerHTML = '';
  DAY_LABELS.forEach((l) => grid.appendChild(makeEl('div', 'checkin-day-label', l)));

  for (let i = 0; i < leadingEmpty; i++) grid.appendChild(makeEl('div', 'checkin-cell empty', ''));

  const todayStr = today.toISOString().slice(0, 10);
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${pad(month + 1)}-${pad(day)}`;
    const cell = makeEl('div', 'checkin-cell', String(day));
    if (checkins[dateStr]) cell.classList.add('attended');
    if (dateStr > todayStr) {
      cell.classList.add('future');
    } else {
      cell.addEventListener('click', () => toggleCheckin(dateStr));
    }
    grid.appendChild(cell);
  }
}
function makeEl(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
}

async function toggleCheckin(dateStr) {
  const attended = !checkins[dateStr];
  await setDoc(doc(db, 'users', uid, 'gymCheckins', dateStr), { attended });
}

function daysAttendedThisMonth() {
  const prefix = new Date().toISOString().slice(0, 7);
  return Object.entries(checkins).filter(([date, val]) => val && date.startsWith(prefix)).length;
}

function renderKpis() {
  const attended = daysAttendedThisMonth();
  document.getElementById('kpiAttendance').textContent = `${attended} / ${settings.goalDays || 0}`;

  const cost = attended > 0 ? (Number(settings.membershipCost) || 0) / attended : (Number(settings.membershipCost) || 0);
  document.getElementById('kpiCostPerSession').textContent = attended > 0 ? formatMoney(cost) : (settings.membershipCost > 0 ? 'Sin asistencias aún' : 'S/ 0.00');
}

// ---------- Bitácora ----------
function renderLogs() {
  const container = document.getElementById('trainingLog');
  container.innerHTML = '';
  if (logs.length === 0) { container.innerHTML = '<div class="widget-empty">Sin registros todavía.</div>'; return; }
  logs.forEach((l) => {
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `<div><div class="log-main">${escapeHtml(l.muscleGroup)}${l.notes ? ' — ' + escapeHtml(l.notes) : ''}</div></div><div class="log-date">${formatDate(l.date)}</div>`;
    container.appendChild(row);
  });
}

// ---------- Evolución corporal ----------
function renderMetrics() {
  const container = document.getElementById('bodyMetricsList');
  container.innerHTML = '';
  if (metrics.length === 0) { container.innerHTML = '<div class="widget-empty">Sin mediciones todavía.</div>'; return; }
  metrics.forEach((m) => {
    const parts = [];
    if (m.weight) parts.push(`${m.weight} kg`);
    if (m.bodyFatPct) parts.push(`${m.bodyFatPct}% grasa`);
    if (m.notes) parts.push(m.notes);
    const row = document.createElement('div');
    row.className = 'log-row';
    row.innerHTML = `<div class="log-main">${escapeHtml(parts.join(' · '))}</div><div class="log-date">${formatDate(m.date)}</div>`;
    container.appendChild(row);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Drawers ----------
function openSettingsDrawer() {
  document.getElementById('goalDays').value = settings.goalDays || 16;
  document.getElementById('membershipCost').value = settings.membershipCost || 0;
  document.getElementById('settingsOverlay').classList.add('open');
}
async function handleSettingsSubmit(e) {
  e.preventDefault();
  settings = {
    goalDays: parseInt(document.getElementById('goalDays').value, 10) || 16,
    membershipCost: parseFloat(document.getElementById('membershipCost').value) || 0,
  };
  await setDoc(doc(db, 'users', uid, 'settings', 'gym'), settings);
  document.getElementById('settingsOverlay').classList.remove('open');
  renderKpis();
}

function openLogDrawer() {
  document.getElementById('logDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('logNotes').value = '';
  document.getElementById('logOverlay').classList.add('open');
}
async function handleLogSubmit(e) {
  e.preventDefault();
  await addDoc(collection(db, 'users', uid, 'trainingLogs'), {
    date: document.getElementById('logDate').value,
    muscleGroup: document.getElementById('logMuscleGroup').value,
    notes: document.getElementById('logNotes').value.trim(),
  });
  document.getElementById('logOverlay').classList.remove('open');
}

function openMetricDrawer() {
  document.getElementById('metricDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('metricWeight').value = '';
  document.getElementById('metricFat').value = '';
  document.getElementById('metricNotes').value = '';
  document.getElementById('metricOverlay').classList.add('open');
}
async function handleMetricSubmit(e) {
  e.preventDefault();
  await addDoc(collection(db, 'users', uid, 'bodyMetrics'), {
    date: document.getElementById('metricDate').value,
    weight: parseFloat(document.getElementById('metricWeight').value) || null,
    bodyFatPct: parseFloat(document.getElementById('metricFat').value) || null,
    notes: document.getElementById('metricNotes').value.trim(),
  });
  document.getElementById('metricOverlay').classList.remove('open');
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('settingsBtn').addEventListener('click', openSettingsDrawer);
  document.getElementById('closeSettingsBtn').addEventListener('click', () => document.getElementById('settingsOverlay').classList.remove('open'));
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);

  document.getElementById('newLogBtn').addEventListener('click', openLogDrawer);
  document.getElementById('closeLogBtn').addEventListener('click', () => document.getElementById('logOverlay').classList.remove('open'));
  document.getElementById('logForm').addEventListener('submit', handleLogSubmit);

  document.getElementById('newMetricBtn').addEventListener('click', openMetricDrawer);
  document.getElementById('closeMetricBtn').addEventListener('click', () => document.getElementById('metricOverlay').classList.remove('open'));
  document.getElementById('metricForm').addEventListener('submit', handleMetricSubmit);

  [document.getElementById('settingsOverlay'), document.getElementById('logOverlay'), document.getElementById('metricOverlay')].forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.remove('open'); });
  });

  document.getElementById('privacyBtn').addEventListener('click', () => {
    document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
