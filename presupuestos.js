// ============================================
// MÓDULO 3 — Presupuestos
// El "ejecutado" de cada presupuesto se calcula
// en vivo a partir de users/{uid}/transactions
// del mes en curso — no se guarda ningún total,
// así nunca se desincroniza de la realidad.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LOCKED_CATEGORY_NAME = 'Servicio de Deuda';

let uid = null;
let categories = [];
let budgets = [];
let transactions = [];
let editingBudgetId = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  uid = user.uid;
  setMonthLabel();
  listenCategories();
  listenBudgets();
  listenTransactions();
  attachEventListeners();

  if (new URLSearchParams(window.location.search).has('new')) openBudgetDrawer();
});

function setMonthLabel() {
  const label = new Date().toLocaleDateString('es-PE', { month: 'long', year: 'numeric' });
  document.getElementById('monthLabel').textContent = `Límites de gasto por categoría para ${capitalize(label)}.`;
}
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
function currentMonthPrefix() { return new Date().toISOString().slice(0, 7); } // "YYYY-MM"

function daysRemainingInMonth() {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.max(1, lastDay - now.getDate() + 1);
}

// ---------- Escuchas en tiempo real ----------
function listenCategories() {
  const q = query(collection(db, 'users', uid, 'categories'), orderBy('name'));
  onSnapshot(q, (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.type === 'expense');
    populateCategorySelect();
    renderBudgets();
  });
}

function listenBudgets() {
  const q = collection(db, 'users', uid, 'budgets');
  onSnapshot(q, (snap) => {
    budgets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateCategorySelect();
    renderBudgets();
  });
}

function listenTransactions() {
  const q = collection(db, 'users', uid, 'transactions');
  onSnapshot(q, (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBudgets();
  });
}

// ---------- Gastado por categoría (mes actual) ----------
function spentForCategory(categoryId) {
  const month = currentMonthPrefix();
  return transactions
    .filter((tx) => tx.categoryId === categoryId && tx.type !== 'transfer' && (tx.date || '').startsWith(month))
    .reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
}

// ---------- Render ----------
function renderBudgets() {
  const grid = document.getElementById('budgetsGrid');
  grid.innerHTML = '';

  let totalBudget = 0;
  let totalSpent = 0;
  let totalDailyAllowance = 0;
  const days = daysRemainingInMonth();

  if (budgets.length === 0) {
    grid.innerHTML = '<div class="empty-cell">Todavía no tienes presupuestos. Crea uno para empezar a controlar tus gastos por categoría.</div>';
  }

  budgets.forEach((b) => {
    const category = categories.find((c) => c.id === b.categoryId);
    const categoryName = category?.name || '(categoría eliminada)';
    const isLocked = categoryName === LOCKED_CATEGORY_NAME;
    const limit = Number(b.limitAmount) || 0;
    const spent = spentForCategory(b.categoryId);
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    const colorClass = pct >= 90 ? 'red' : (pct >= 70 ? 'yellow' : 'green');
    const dailyAllowance = Math.max(0, (limit - spent)) / days;

    totalBudget += limit;
    totalSpent += spent;
    totalDailyAllowance += dailyAllowance;

    const card = document.createElement('div');
    card.className = 'budget-card';
    card.innerHTML = `
      <div class="card-top">
        <div class="card-name">${escapeHtml(categoryName)} ${isLocked ? '<span class="lock-badge">🔒 Obligatorio</span>' : ''}</div>
      </div>
      <div class="budget-amounts">
        <span class="budget-spent">S/ ${spent.toFixed(2)}</span>
        <span class="budget-limit">de S/ ${limit.toFixed(2)}</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill ${colorClass}" style="width:${Math.min(100, pct)}%"></div>
      </div>
      <div class="budget-meta">
        <span class="pct-label ${colorClass}">${pct}% usado</span>
        <span>${limit > spent ? 'S/ ' + (limit - spent).toFixed(2) + ' disponible' : 'Presupuesto superado'}</span>
      </div>
      <div class="card-footer-row">
        <span>Puedes gastar por día</span>
        <strong>S/ ${dailyAllowance.toFixed(2)}</strong>
      </div>
    `;
    card.addEventListener('click', () => openBudgetDrawer(b));
    grid.appendChild(card);
  });

  document.getElementById('kpiTotalBudget').textContent = formatMoney(totalBudget);
  document.getElementById('kpiTotalSpent').textContent = formatMoney(totalSpent);
  document.getElementById('kpiDailyAllowance').textContent = formatMoney(totalDailyAllowance);
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Select de categoría en el drawer ----------
function populateCategorySelect() {
  const sel = document.getElementById('budgetCategory');
  const prevValue = sel.value;
  sel.innerHTML = '';

  const budgetedCategoryIds = budgets.filter((b) => b.id !== editingBudgetId).map((b) => b.categoryId);

  categories
    .filter((c) => !budgetedCategoryIds.includes(c.id))
    .forEach((c) => sel.appendChild(new Option(c.name, c.id)));

  if ([...sel.options].some((o) => o.value === prevValue)) sel.value = prevValue;
}

// ---------- Drawer ----------
function openBudgetDrawer(budget = null) {
  editingBudgetId = budget ? budget.id : null;
  document.getElementById('budgetDrawerTitle').textContent = budget ? 'Editar presupuesto' : 'Nuevo presupuesto';
  document.getElementById('deleteBudgetBtn').classList.toggle('hidden', !budget);

  populateCategorySelect();

  document.getElementById('budgetCategory').value = budget?.categoryId || '';
  document.getElementById('budgetCategory').disabled = !!budget; // no cambiar la categoría de un presupuesto existente
  document.getElementById('budgetLimit').value = budget?.limitAmount ?? '';

  document.getElementById('budgetOverlay').classList.add('open');
}
function closeBudgetDrawer() { document.getElementById('budgetOverlay').classList.remove('open'); }

async function handleBudgetSubmit(e) {
  e.preventDefault();
  const categoryId = document.getElementById('budgetCategory').value;
  const limitAmount = parseFloat(document.getElementById('budgetLimit').value) || 0;
  if (!categoryId || limitAmount <= 0) return;

  if (editingBudgetId) {
    await updateDoc(doc(db, 'users', uid, 'budgets', editingBudgetId), { limitAmount });
  } else {
    await addDoc(collection(db, 'users', uid, 'budgets'), { categoryId, limitAmount });
  }
  closeBudgetDrawer();
}

async function handleDeleteBudget() {
  if (!editingBudgetId) return;
  if (!confirm('¿Eliminar este presupuesto?')) return;
  await deleteDoc(doc(db, 'users', uid, 'budgets', editingBudgetId));
  closeBudgetDrawer();
}

// ---------- Utilidades ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function togglePrivacy() {
  document.querySelectorAll('.budget-spent, .kpi-value').forEach((el) => el.classList.toggle('blurred'));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newBudgetBtn').addEventListener('click', () => openBudgetDrawer());
  document.getElementById('closeBudgetBtn').addEventListener('click', closeBudgetDrawer);
  document.getElementById('budgetOverlay').addEventListener('click', (e) => { if (e.target.id === 'budgetOverlay') closeBudgetDrawer(); });
  document.getElementById('budgetForm').addEventListener('submit', handleBudgetSubmit);
  document.getElementById('deleteBudgetBtn').addEventListener('click', handleDeleteBudget);

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
