// ============================================
// MÓDULO 7 — Flujo de Caja (estado mensual real)
// Cada fila de Ingresos/Egresos es una categoría de
// tus Transacciones; cada fila de Financiamiento es
// una deuda de Cuentas y Activos. Todo dinámico: si
// creas una categoría o deuda nueva, aparece sola.
//
// Lógica contable:
//   Flujo económico(mes)  = Saldo inicial + Ingresos − Egresos
//   Flujo financiero(mes) = Flujo económico + Financiamiento
//   Saldo inicial(mes+1)  = Flujo financiero(mes)
// El saldo inicial de enero se reconstruye hacia atrás
// desde tu saldo real de HOY (Módulo 4), así el cuadro
// siempre cuadra con tu dinero de verdad.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MONTH_LABELS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

let uid = null;
let accounts = [];
let categories = [];
let debts = [];
let transactions = [];
let selectedYear = new Date().getFullYear();

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  document.getElementById('pageLoader')?.classList.add('hidden');

  listenAccounts();
  listenCategories();
  listenDebts();
  listenTransactions();
  attachEventListeners();
  updateYearLabel();
});

function listenAccounts() {
  onSnapshot(collection(db, 'users', uid, 'accounts'), (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenCategories() {
  onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenDebts() {
  onSnapshot(collection(db, 'users', uid, 'debts'), (snap) => {
    debts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}
function listenTransactions() {
  onSnapshot(collection(db, 'users', uid, 'transactions'), (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

function pad(n) { return String(n).padStart(2, '0'); }
function monthPrefix(year, monthIndex) { return `${year}-${pad(monthIndex + 1)}`; }

// Efecto neto de una transacción sobre el patrimonio líquido.
// Las transferencias no cuentan: es tu mismo dinero cambiando de cuenta.
function netEffect(tx) {
  const amount = Number(tx.amount) || 0;
  if (tx.type === 'income') return amount;
  if (tx.type === 'expense' || tx.type === 'debt_payment') return -amount;
  return 0;
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCell(n) {
  const rounded = Math.round(n);
  if (rounded === 0) return '<span class="cell-zero">—</span>';
  if (rounded < 0) return `<span class="cell-negative">(${Math.abs(rounded).toLocaleString('es-PE')})</span>`;
  return rounded.toLocaleString('es-PE');
}

function sumMonthly(filterFn) {
  const months = new Array(12).fill(0);
  transactions.forEach((tx) => {
    if (!tx.date || !tx.date.startsWith(String(selectedYear))) return;
    if (!filterFn(tx)) return;
    const monthIndex = parseInt(tx.date.slice(5, 7), 10) - 1;
    if (monthIndex >= 0 && monthIndex < 12) months[monthIndex] += Number(tx.amount) || 0;
  });
  return months;
}

// ---------- Render principal ----------
function render() {
  if (!uid) return;

  // Saldo inicial de enero: reconstruido hacia atrás desde el saldo real de hoy.
  const currentTotalBalance = accounts.reduce((s, a) => s + (Number(a.balance) || 0), 0);
  const jan1 = `${selectedYear}-01-01`;
  const reverseSum = transactions
    .filter((tx) => (tx.date || '') >= jan1)
    .reduce((s, tx) => s + netEffect(tx), 0);
  const saldoInicialJan = currentTotalBalance - reverseSum;

  // Filas dinámicas de categorías
  const incomeCats = categories.filter((c) => c.type === 'income');
  const expenseCats = categories.filter((c) => c.type === 'expense');

  const incomeRows = incomeCats.map((c) => ({
    label: c.name,
    values: sumMonthly((tx) => tx.type === 'income' && tx.categoryId === c.id),
  }));
  const expenseRows = expenseCats.map((c) => ({
    label: c.name,
    values: sumMonthly((tx) => tx.type === 'expense' && tx.categoryId === c.id),
  }));
  const financingRows = debts.map((d) => ({
    label: d.name,
    values: sumMonthly((tx) => tx.type === 'debt_payment' && tx.debtId === d.id),
  }));

  const totalIncome = sumRows(incomeRows);
  const totalExpense = sumRows(expenseRows);
  const totalFinancing = sumRows(financingRows);

  // Secuencia mes a mes
  const saldoInicial = new Array(12).fill(0);
  const flujoEconomico = new Array(12).fill(0);
  const flujoFinanciero = new Array(12).fill(0);

  saldoInicial[0] = saldoInicialJan;
  for (let m = 0; m < 12; m++) {
    flujoEconomico[m] = saldoInicial[m] + totalIncome[m] - totalExpense[m];
    flujoFinanciero[m] = flujoEconomico[m] + totalFinancing[m];
    if (m < 11) saldoInicial[m + 1] = flujoFinanciero[m];
  }

  renderTable({ incomeRows, expenseRows, financingRows, totalIncome, totalExpense, totalFinancing, saldoInicial, flujoEconomico, flujoFinanciero });
  renderKpis(totalIncome, totalExpense, flujoFinanciero);
}

function sumRows(rows) {
  const totals = new Array(12).fill(0);
  rows.forEach((r) => r.values.forEach((v, i) => { totals[i] += v; }));
  return totals;
}

// ---------- Construir la tabla ----------
function renderTable(data) {
  const { incomeRows, expenseRows, financingRows, totalIncome, totalExpense, totalFinancing, saldoInicial, flujoEconomico, flujoFinanciero } = data;

  const thead = `<thead><tr><th>Concepto</th>${MONTH_LABELS.map((m) => `<th>${m}</th>`).join('')}<th>Total</th></tr></thead>`;

  let body = '';
  body += buildRow('Saldo inicial', saldoInicial, 'row-saldo', 'blank');

  body += sectionRow('Ingresos', 'income');
  incomeRows.forEach((r) => { body += buildRow(r.label, r.values, 'row-category'); });
  if (incomeRows.length === 0) body += emptyRow('Sin categorías de ingreso todavía');
  body += buildRow('Total Ingresos', totalIncome, 'row-total income');

  body += sectionRow('Egresos', 'expense');
  expenseRows.forEach((r) => { body += buildRow(r.label, r.values, 'row-category'); });
  if (expenseRows.length === 0) body += emptyRow('Sin categorías de gasto todavía');
  body += buildRow('Total Egresos', totalExpense, 'row-total expense');

  body += buildRow('Flujo de caja económico', flujoEconomico, 'row-flow', 'last');

  body += sectionRow('Financiamiento', 'financing');
  financingRows.forEach((r) => { body += buildRow(r.label, r.values, 'row-category'); });
  if (financingRows.length === 0) body += emptyRow('Sin préstamos ni terreno registrados');
  body += buildRow('Total Financiamiento', totalFinancing, 'row-total financing');

  body += buildRow('Flujo de caja financiero', flujoFinanciero, 'row-flow', 'last');

  document.getElementById('cashflowTable').innerHTML = thead + `<tbody>${body}</tbody>`;
}

function buildRow(label, values, rowClass, totalMode = 'sum') {
  const cells = values.map((v) => `<td>${formatCell(v)}</td>`).join('');
  let totalCell;
  if (totalMode === 'sum') totalCell = formatCell(values.reduce((a, b) => a + b, 0));
  else if (totalMode === 'last') totalCell = formatCell(values[11]);
  else totalCell = '<span class="cell-zero">—</span>';
  return `<tr class="${rowClass}"><td>${escapeHtml(label)}</td>${cells}<td>${totalCell}</td></tr>`;
}
function sectionRow(label, cls) {
  return `<tr class="row-section-header ${cls}"><td colspan="14">${label}</td></tr>`;
}
function emptyRow(text) {
  return `<tr class="row-category"><td colspan="14" style="color:var(--mist-dim); font-style:italic;">${text}</td></tr>`;
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- KPIs ----------
function renderKpis(totalIncome, totalExpense, flujoFinanciero) {
  document.getElementById('kpiYearIncome').textContent = formatMoney(totalIncome.reduce((a, b) => a + b, 0));
  document.getElementById('kpiYearExpense').textContent = formatMoney(totalExpense.reduce((a, b) => a + b, 0));
  document.getElementById('kpiYearEnd').textContent = formatMoney(flujoFinanciero[11]);
}

// ---------- Navegación de año ----------
function updateYearLabel() {
  document.getElementById('yearLabel').textContent = selectedYear;
  document.getElementById('nextYearBtn').disabled = selectedYear >= new Date().getFullYear();
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('prevYearBtn').addEventListener('click', () => {
    selectedYear -= 1;
    updateYearLabel();
    render();
  });
  document.getElementById('nextYearBtn').addEventListener('click', () => {
    if (selectedYear >= new Date().getFullYear()) return;
    selectedYear += 1;
    updateYearLabel();
    render();
  });

  document.getElementById('privacyBtn').addEventListener('click', () => {
    document.querySelectorAll('.kpi-value').forEach((el) => el.classList.toggle('blurred'));
  });
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
