// ============================================
// MÓDULO 7 — Flujo de Caja
// Proyección: Saldo Actual + Ingresos Esperados
//   - (Recibos Programados + Gasto Promedio)
// Es una estimación (no una garantía): los ingresos
// y el gasto promedio se toman de tu historial
// reciente y de tus presupuestos activos.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid = null;
let accounts = [];
let receipts = [];
let budgets = [];
let transactions = [];
let horizonDays = 30;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  listenAccounts();
  listenReceipts();
  listenBudgets();
  listenTransactions();
  attachEventListeners();
});

function listenAccounts() {
  onSnapshot(collection(db, 'users', uid, 'accounts'), (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenReceipts() {
  onSnapshot(collection(db, 'users', uid, 'receipts'), (snap) => {
    receipts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenBudgets() {
  onSnapshot(collection(db, 'users', uid, 'budgets'), (snap) => {
    budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
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

function daysUntilDue(dueDay) {
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  let days = dueDay - today.getDate();
  if (days < 0) days += daysInMonth;
  return days;
}

// ---------- Promedio diario de ingresos (últimos 30 días reales de transacciones) ----------
function dailyIncomeAverage() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const total = transactions
    .filter((tx) => tx.type === 'income' && (tx.date || '') >= cutoffStr)
    .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  return total / 30;
}

// ---------- Gasto promedio diario (según presupuestos activos, Módulo 3) ----------
function dailyBudgetAverage() {
  const totalMonthly = budgets.reduce((s, b) => s + (Number(b.limitAmount) || 0), 0);
  return totalMonthly / 30;
}

// ---------- Cuánto han restado los recibos acumulados hasta el día N ----------
function receiptsCumulativeAt(day) {
  let total = 0;
  const culprits = [];
  receipts.forEach((r) => {
    const offset = daysUntilDue(r.dueDay);
    if (day >= offset) {
      const cycles = Math.floor((day - offset) / 30) + 1;
      total += cycles * (Number(r.amount) || 0);
      if (day - ((cycles - 1) * 30 + offset) <= 2) culprits.push(r.name); // recién "cobrado" cerca de este día
    }
  });
  return { total, culprits };
}

// ---------- Construir la serie de proyección ----------
function buildProjection(days) {
  const currentBalance = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const dailyIncome = dailyIncomeAverage();
  const dailyBudget = dailyBudgetAverage();

  const series = [];
  for (let n = 0; n <= days; n++) {
    const { total: receiptsTotal, culprits } = receiptsCumulativeAt(n);
    const balance = currentBalance + dailyIncome * n - dailyBudget * n - receiptsTotal;
    series.push({ day: n, balance, culprits });
  }
  return { series, currentBalance };
}

// ---------- Render general ----------
function render() {
  const { series, currentBalance } = buildProjection(horizonDays);
  const final = series[series.length - 1].balance;
  const lowestPoint = series.reduce((min, p) => (p.balance < min.balance ? p : min), series[0]);

  document.getElementById('kpiCurrent').textContent = formatMoney(currentBalance);
  const projEl = document.getElementById('kpiProjected');
  projEl.textContent = formatMoney(final);
  projEl.classList.toggle('negative', final < 0);

  const lowEl = document.getElementById('kpiLowest');
  lowEl.textContent = formatMoney(lowestPoint.balance);
  lowEl.classList.toggle('negative', lowestPoint.balance < 0);

  renderAlerts(lowestPoint);
  renderChart(series);
}

function renderAlerts(lowestPoint) {
  const stack = document.getElementById('alertsStack');
  stack.innerHTML = '';
  if (lowestPoint.balance >= 0) return;

  const culpritText = lowestPoint.culprits.length > 0
    ? ` La cuota que más pesa cerca de ese día es "${lowestPoint.culprits[0]}".`
    : '';

  const el = document.createElement('div');
  el.className = 'alert-item danger';
  el.textContent = `Alerta de liquidez negativa: se proyecta un saldo de ${formatMoney(lowestPoint.balance)} alrededor del día ${lowestPoint.day}.${culpritText}`;
  stack.appendChild(el);
}

// ---------- Gráfico SVG ----------
function renderChart(series) {
  const width = 760, height = 260, padding = { top: 20, right: 20, bottom: 30, left: 70 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const balances = series.map((p) => p.balance);
  const maxVal = Math.max(...balances, 0);
  const minVal = Math.min(...balances, 0);
  const range = (maxVal - minVal) || 1;

  const xFor = (day) => padding.left + (day / (series.length - 1)) * innerW;
  const yFor = (val) => padding.top + innerH - ((val - minVal) / range) * innerH;

  const points = series.map((p) => `${xFor(p.day)},${yFor(p.balance)}`).join(' ');
  const areaPoints = `${xFor(0)},${yFor(0)} ` + points + ` ${xFor(series.length - 1)},${yFor(0)}`;
  const zeroY = yFor(0);

  const hasNegative = minVal < 0;
  const lineColor = hasNegative ? '#E5484D' : '#1B4B79';

  // marcas del eje X cada ~10 días
  const step = series.length > 40 ? 15 : 10;
  let xLabels = '';
  for (let d = 0; d < series.length; d += step) {
    xLabels += `<text x="${xFor(d)}" y="${height - 8}" font-size="11" fill="#94A3B8" text-anchor="middle">${d}d</text>`;
  }

  const lowest = series.reduce((min, p) => (p.balance < min.balance ? p : min), series[0]);
  const lowestMarker = lowest.balance < 0
    ? `<circle cx="${xFor(lowest.day)}" cy="${yFor(lowest.balance)}" r="4" fill="#E5484D" />`
    : '';

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" stroke="#CBD5E1" stroke-width="1" stroke-dasharray="4 3" />
      <text x="${padding.left - 8}" y="${zeroY + 4}" font-size="11" fill="#94A3B8" text-anchor="end">S/ 0</text>
      <text x="${padding.left - 8}" y="${padding.top + 4}" font-size="11" fill="#94A3B8" text-anchor="end">${Math.round(maxVal)}</text>
      <text x="${padding.left - 8}" y="${padding.top + innerH}" font-size="11" fill="#94A3B8" text-anchor="end">${Math.round(minVal)}</text>
      <polygon points="${areaPoints}" fill="${lineColor}" opacity="0.08" />
      <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${lowestMarker}
      ${xLabels}
    </svg>
  `;

  document.getElementById('chartContainer').innerHTML = svg;
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.querySelectorAll('#horizonToggle button').forEach((btn) => {
    btn.addEventListener('click', () => {
      horizonDays = parseInt(btn.dataset.days, 10);
      document.querySelectorAll('#horizonToggle button').forEach((b) => b.classList.toggle('active', b === btn));
      render();
    });
  });

  document.getElementById('privacyBtn').addEventListener('click', () => {
    document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
