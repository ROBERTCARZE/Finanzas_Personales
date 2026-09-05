// ============================================
// MÓDULO 9 — Ciclo Menstrual y Finanzas
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc, getDoc, setDoc, collection, addDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HEALTH_CATEGORY_NAME = 'Salud e Higiene';

let uid = null;
let settings = null;
let categories = [];
let transactions = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  await loadSettings();
  listenCategories();
  listenTransactions();
  attachEventListeners();
  render();
});

async function loadSettings() {
  const ref = doc(db, 'users', uid, 'settings', 'cycle');
  const snap = await getDoc(ref);
  settings = snap.exists() ? snap.data() : null;
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

// ---------- Cálculo de fase (aproximación estándar) ----------
function computeCycleInfo(s) {
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

  const daysUntilNextPeriod = s.avgCycleLength - cycleDay + 1;
  const nextPeriodDate = new Date(today);
  nextPeriodDate.setDate(today.getDate() + daysUntilNextPeriod);

  return { cycleDay, phase, daysUntilNextPeriod, nextPeriodDate };
}

const PHASE_LABELS = { menstrual: 'Menstrual', folicular: 'Folicular', ovulatoria: 'Ovulatoria', lutea: 'Lútea' };
const PHASE_SUGGESTIONS = {
  menstrual: 'Energía más baja de lo habitual. Considera aligerar tu carga en el Horario Personal y bajar la intensidad en el Gimnasio estos días.',
  folicular: 'Energía en aumento — buen momento para tareas que requieran más esfuerzo o iniciar cosas nuevas.',
  ovulatoria: 'Pico de energía del ciclo. Es un buen momento para entrenamientos más intensos o tareas exigentes.',
  lutea: 'La energía empieza a bajar. Prioriza descanso y reduce el volumen de entrenamiento hacia el final de esta fase.',
};

// ---------- Render ----------
function render() {
  if (!settings) {
    document.getElementById('kpiPhase').textContent = 'Sin configurar';
    document.getElementById('kpiCycleDay').textContent = 'Presiona "Editar seguimiento" para empezar';
    document.getElementById('kpiNextPeriod').textContent = '—';
    document.getElementById('forecastList').innerHTML = '<div class="forecast-row"><span>Configura tu ciclo para ver el pronóstico</span></div>';
    document.getElementById('suggestionText').textContent = 'Configura tu seguimiento para recibir sugerencias.';
    return;
  }

  const info = computeCycleInfo(settings);

  const phaseCard = document.getElementById('phaseCard');
  phaseCard.className = `kpi-card phase-card ${info.phase}`;
  document.getElementById('kpiPhase').textContent = PHASE_LABELS[info.phase];
  document.getElementById('kpiCycleDay').textContent = `Día ${info.cycleDay} de ${settings.avgCycleLength}`;
  document.getElementById('kpiNextPeriod').textContent = `${formatDate(info.nextPeriodDate.toISOString().slice(0, 10))} (en ${info.daysUntilNextPeriod}d)`;

  document.getElementById('suggestionText').textContent = PHASE_SUGGESTIONS[info.phase];

  // Pronóstico de los próximos 3 ciclos
  const forecastList = document.getElementById('forecastList');
  forecastList.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const d = new Date(info.nextPeriodDate);
    d.setDate(d.getDate() + i * settings.avgCycleLength);
    const row = document.createElement('div');
    row.className = 'forecast-row';
    row.innerHTML = `<span>Ciclo ${i + 1}</span><span>${formatDate(d.toISOString().slice(0, 10))}</span>`;
    forecastList.appendChild(row);
  }

  // Cruce financiero: gastos del mes en la categoría "Salud e Higiene"
  const healthCategory = categories.find((c) => c.name === HEALTH_CATEGORY_NAME);
  const month = new Date().toISOString().slice(0, 7);
  const cost = healthCategory
    ? transactions.filter((tx) => tx.categoryId === healthCategory.id && (tx.date || '').startsWith(month))
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0)
    : 0;
  document.getElementById('kpiCost').textContent = formatMoney(cost);
}

// ---------- Drawer de configuración ----------
function openSettingsDrawer() {
  document.getElementById('lastPeriodStart').value = settings?.lastPeriodStart || '';
  document.getElementById('avgCycleLength').value = settings?.avgCycleLength || 28;
  document.getElementById('avgPeriodLength').value = settings?.avgPeriodLength || 5;
  document.getElementById('settingsOverlay').classList.add('open');
}
function closeSettingsDrawer() { document.getElementById('settingsOverlay').classList.remove('open'); }

async function handleSettingsSubmit(e) {
  e.preventDefault();
  const data = {
    lastPeriodStart: document.getElementById('lastPeriodStart').value,
    avgCycleLength: parseInt(document.getElementById('avgCycleLength').value, 10) || 28,
    avgPeriodLength: parseInt(document.getElementById('avgPeriodLength').value, 10) || 5,
  };
  await setDoc(doc(db, 'users', uid, 'settings', 'cycle'), data);
  settings = data;

  // Asegura que exista la categoría "Salud e Higiene" para el cruce financiero
  if (!categories.some((c) => c.name === HEALTH_CATEGORY_NAME)) {
    await addDoc(collection(db, 'users', uid, 'categories'), { name: HEALTH_CATEGORY_NAME, type: 'expense' });
  }

  closeSettingsDrawer();
  render();
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('editSettingsBtn').addEventListener('click', openSettingsDrawer);
  document.getElementById('closeSettingsBtn').addEventListener('click', closeSettingsDrawer);
  document.getElementById('settingsOverlay').addEventListener('click', (e) => { if (e.target.id === 'settingsOverlay') closeSettingsDrawer(); });
  document.getElementById('settingsForm').addEventListener('submit', handleSettingsSubmit);

  document.getElementById('privacyBtn').addEventListener('click', () => {
    document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
