// ============================================
// MÓDULO 1 — Dashboard
// Escucha en tiempo real las mismas colecciones
// que ya usan Transacciones, Cuentas y Presupuestos,
// y las combina en una sola vista.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, query, orderBy, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCKED_CATEGORY_NAME = 'Servicio de Deuda';

let uid = null;
let accounts = [];
let debts = [];
let categories = [];
let budgets = [];
let transactions = [];
let scheduleBlocks = [];
let gymCheckins = {};
let cycleModel = null;
let gymSettings = { goalDays: 16 };

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  uid = user.uid;
  document.getElementById('pageLoader')?.classList.add('hidden');
  setGreeting();

  listenAccounts();
  listenDebts();
  listenCategories();
  listenBudgets();
  listenTransactions();
  listenScheduleBlocks();
  listenGymCheckins();
  await loadLifestyleSettings();
  attachEventListeners();
  renderAll();
});

async function loadLifestyleSettings() {
  const cycleSnap = await getDocs(query(collection(db, 'users', uid, 'cycleLogs'), orderBy('startDate')));
  const logs = cycleSnap.docs.map((d) => d.data());
  cycleModel = buildCycleModel(logs);

  const gymSnap = await getDoc(doc(db, 'users', uid, 'settings', 'gym'));
  if (gymSnap.exists()) gymSettings = gymSnap.data();
}

// Mismo cálculo que en el Módulo 9: aprende del historial de inicios de regla.
function buildCycleModel(logs) {
  if (logs.length === 0) return null;
  const sorted = [...logs].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lengths = [];
  for (let i = 1; i < sorted.length; i++) {
    const diff = Math.round((new Date(sorted[i].startDate) - new Date(sorted[i - 1].startDate)) / (1000 * 60 * 60 * 24));
    if (diff > 0) lengths.push(diff);
  }
  const avgCycleLength = lengths.length > 0 ? Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length) : 28;
  const periodLengths = sorted.map((l) => Number(l.periodLength)).filter((v) => v > 0);
  const avgPeriodLength = periodLengths.length > 0 ? Math.round(periodLengths.reduce((a, b) => a + b, 0) / periodLengths.length) : 5;
  return { avgCycleLength, avgPeriodLength, lastStart: sorted[sorted.length - 1].startDate };
}

function setGreeting() {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : (hour < 19 ? 'Buenas tardes' : 'Buenas noches');
  document.getElementById('greeting').textContent = greeting;
  document.getElementById('dateLabel').textContent =
    'Hoy es ' + new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }) + '. Tu radiografía financiera de hoy.';
}

// ---------- Escuchas en tiempo real ----------
function listenAccounts() {
  onSnapshot(collection(db, 'users', uid, 'accounts'), (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenDebts() {
  onSnapshot(collection(db, 'users', uid, 'debts'), (snap) => {
    debts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenCategories() {
  onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenBudgets() {
  onSnapshot(collection(db, 'users', uid, 'budgets'), (snap) => {
    budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenTransactions() {
  onSnapshot(collection(db, 'users', uid, 'transactions'), (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenScheduleBlocks() {
  onSnapshot(collection(db, 'users', uid, 'scheduleBlocks'), (snap) => {
    scheduleBlocks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}
function listenGymCheckins() {
  onSnapshot(collection(db, 'users', uid, 'gymCheckins'), (snap) => {
    gymCheckins = {};
    snap.docs.forEach((d) => { gymCheckins[d.id] = d.data().attended; });
    renderAll();
  });
}

// ---------- Render general ----------
function renderAll() {
  renderKpis();
  renderIncomeVsExpense();
  renderBudgetsMini();
  renderLifestyle();
  renderAlerts();
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function currentMonthPrefix() { return new Date().toISOString().slice(0, 7); }

// ---------- KPIs ----------
function renderKpis() {
  const liquidity = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const available = accounts
    .filter((a) => a.type !== 'credit_card')
    .reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalDebt = debts.reduce((sum, d) => sum + (Number(d.remainingBalance) || 0), 0);
  const assetValue = debts.reduce((sum, d) => sum + (Number(d.linkedAssetValue) || 0), 0);
  const netWorth = liquidity + assetValue - totalDebt;

  const { income, expense } = monthTotals();
  const savings = income - expense;

  document.getElementById('kpiNetWorth').textContent = formatMoney(netWorth);
  document.getElementById('kpiAvailable').textContent = formatMoney(available);

  const savingsEl = document.getElementById('kpiSavings');
  savingsEl.textContent = formatMoney(savings);
  savingsEl.classList.remove('kpi-sage', 'kpi-clay');
  savingsEl.classList.add(savings >= 0 ? 'kpi-sage' : 'kpi-clay');
}

function monthTotals() {
  const month = currentMonthPrefix();
  const monthTx = transactions.filter((tx) => (tx.date || '').startsWith(month) && tx.type !== 'transfer');
  const income = monthTx.filter((tx) => tx.type === 'income').reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  const expense = monthTx.filter((tx) => tx.type === 'expense' || tx.type === 'debt_payment').reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  return { income, expense };
}

// ---------- Estilo de vida (Módulos 9, 10 y 11) ----------
function renderLifestyle() {
  // Fase del ciclo (Módulo 9)
  const phaseEl = document.getElementById('lifestylePhase');
  if (cycleModel) {
    const start = new Date(cycleModel.lastStart + 'T00:00:00');
    const today = new Date();
    const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
    const cycleDay = ((diffDays % cycleModel.avgCycleLength) + cycleModel.avgCycleLength) % cycleModel.avgCycleLength + 1;
    const ovulationDay = cycleModel.avgCycleLength - 14;
    let phase;
    if (cycleDay <= cycleModel.avgPeriodLength) phase = 'Menstrual';
    else if (cycleDay < ovulationDay - 1) phase = 'Folicular';
    else if (cycleDay <= ovulationDay + 1) phase = 'Ovulatoria';
    else phase = 'Lútea';
    phaseEl.textContent = `${phase} (día ${cycleDay})`;
  } else {
    phaseEl.textContent = 'Sin configurar';
  }

  // Próximo bloque de hoy (Módulo 10)
  const scheduleEl = document.getElementById('lifestyleSchedule');
  const now = new Date();
  const todayIndex = (now.getDay() + 6) % 7; // 0 = lunes
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const todayBlocks = scheduleBlocks
    .filter((b) => b.day === todayIndex && b.startHour >= currentHour)
    .sort((a, b) => a.startHour - b.startHour);
  scheduleEl.textContent = todayBlocks.length > 0
    ? `${todayBlocks[0].title} a las ${todayBlocks[0].startHour}:00`
    : 'Nada más agendado por hoy';

  // Asistencia al gym este mes (Módulo 11)
  const gymEl = document.getElementById('lifestyleGym');
  const monthPrefix = new Date().toISOString().slice(0, 7);
  const attended = Object.entries(gymCheckins).filter(([date, val]) => val && date.startsWith(monthPrefix)).length;
  gymEl.textContent = `${attended} / ${gymSettings.goalDays || 0} días`;
}

// ---------- Ingresos vs Gastos ----------
function renderIncomeVsExpense() {
  const { income, expense } = monthTotals();
  const max = Math.max(income, expense, 1);

  document.getElementById('incomeBar').style.width = `${(income / max) * 100}%`;
  document.getElementById('expenseBar').style.width = `${(expense / max) * 100}%`;
  document.getElementById('incomeValue').textContent = formatMoney(income);
  document.getElementById('expenseValue').textContent = formatMoney(expense);
}

// ---------- Mini presupuestos ----------
function renderBudgetsMini() {
  const container = document.getElementById('budgetsMiniList');
  container.innerHTML = '';

  if (budgets.length === 0) {
    container.innerHTML = '<div class="widget-empty">Todavía no tienes presupuestos activos.</div>';
    return;
  }

  const month = currentMonthPrefix();

  budgets.slice(0, 5).forEach((b) => {
    const category = categories.find((c) => c.id === b.categoryId);
    const name = category?.name || '(categoría eliminada)';
    const limit = Number(b.limitAmount) || 0;
    const spent = transactions
      .filter((tx) => tx.categoryId === b.categoryId && tx.type !== 'transfer' && (tx.date || '').startsWith(month))
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const colorClass = pct >= 90 ? 'red' : (pct >= 70 ? 'yellow' : 'green');

    const row = document.createElement('div');
    row.className = 'mini-budget-row';
    row.innerHTML = `
      <div class="mini-budget-top">
        <span>${escapeHtml(name)}</span>
        <strong>${pct}%</strong>
      </div>
      <div class="mini-track"><div class="mini-fill ${colorClass}" style="width:${Math.min(100, pct)}%"></div></div>
    `;
    container.appendChild(row);
  });
}

// ---------- Alertas ----------
function renderAlerts() {
  const stack = document.getElementById('alertsStack');
  stack.innerHTML = '';
  const alerts = [];

  // Vencimientos de deuda en los próximos 3 días
  const today = new Date();
  const todayDay = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  debts.forEach((d) => {
    if (!d.dueDay) return;
    let daysUntil = d.dueDay - todayDay;
    if (daysUntil < 0) daysUntil += daysInMonth; // ya pasó este mes, cuenta al próximo
    if (daysUntil >= 0 && daysUntil <= 3) {
      const when = daysUntil === 0 ? 'hoy' : (daysUntil === 1 ? 'mañana' : `en ${daysUntil} días`);
      alerts.push({ level: 'danger', text: `La cuota de "${d.name}" (S/ ${(Number(d.monthlyPayment) || 0).toFixed(2)}) vence ${when}.` });
    }
  });

  // Presupuestos por encima del 85%
  const month = currentMonthPrefix();
  budgets.forEach((b) => {
    const limit = Number(b.limitAmount) || 0;
    if (limit <= 0) return;
    const spent = transactions
      .filter((tx) => tx.categoryId === b.categoryId && tx.type !== 'transfer' && (tx.date || '').startsWith(month))
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
    const pct = (spent / limit) * 100;
    if (pct >= 85) {
      const category = categories.find((c) => c.id === b.categoryId);
      const name = category?.name || 'una categoría';
      alerts.push({
        level: pct >= 100 ? 'danger' : 'warning',
        text: pct >= 100
          ? `Superaste el presupuesto de "${name}" (${Math.round(pct)}% usado).`
          : `El presupuesto de "${name}" ya lleva ${Math.round(pct)}% usado.`,
      });
    }
  });

  if (alerts.length === 0) return;

  alerts.forEach((a) => {
    const el = document.createElement('div');
    el.className = `alert-item ${a.level}`;
    el.textContent = a.text;
    stack.appendChild(el);
  });
}

// ---------- Utilidades ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function togglePrivacy() {
  document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
