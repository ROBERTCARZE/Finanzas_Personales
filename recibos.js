// ============================================
// MÓDULO 6 — Recibos y Suscripciones
// El botón "Pagar" crea una transacción real en
// Módulo 2, actualizando saldo de cuenta (y deuda,
// si el recibo está vinculado a una) — misma lógica
// atómica que usa Transacciones.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid = null;
let accounts = [];
let categories = [];
let debts = [];
let receipts = [];
let editingReceiptId = null;
let currentReceiptType = 'utility';

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  listenAccounts();
  listenCategories();
  listenDebts();
  listenReceipts();
  attachEventListeners();

  if (new URLSearchParams(window.location.search).has('new')) openReceiptDrawer();
});

function listenAccounts() {
  onSnapshot(collection(db, 'users', uid, 'accounts'), (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateSelects();
  });
}
function listenCategories() {
  onSnapshot(collection(db, 'users', uid, 'categories'), (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((c) => c.type === 'expense');
    populateSelects();
  });
}
function listenDebts() {
  onSnapshot(collection(db, 'users', uid, 'debts'), (snap) => {
    debts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateSelects();
  });
}
function listenReceipts() {
  const q = query(collection(db, 'users', uid, 'receipts'), orderBy('dueDay'));
  onSnapshot(q, (snap) => {
    receipts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderReceipts();
  });
}

function populateSelects() {
  const catSel = document.getElementById('receiptCategory');
  const prevCat = catSel.value;
  catSel.innerHTML = '';
  categories.forEach((c) => catSel.appendChild(new Option(c.name, c.id)));
  if ([...catSel.options].some((o) => o.value === prevCat)) catSel.value = prevCat;

  const accSel = document.getElementById('receiptAccount');
  const prevAcc = accSel.value;
  accSel.innerHTML = '';
  accounts.forEach((a) => accSel.appendChild(new Option(a.name, a.id)));
  if ([...accSel.options].some((o) => o.value === prevAcc)) accSel.value = prevAcc;

  const debtSel = document.getElementById('receiptDebt');
  const prevDebt = debtSel.value;
  debtSel.innerHTML = '<option value="">No aplica</option>';
  debts.forEach((d) => debtSel.appendChild(new Option(d.name, d.id)));
  if ([...debtSel.options].some((o) => o.value === prevDebt)) debtSel.value = prevDebt;
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

// ---------- Render ----------
function renderReceipts() {
  const utilGrid = document.getElementById('utilitiesGrid');
  const subGrid = document.getElementById('subscriptionsGrid');
  utilGrid.innerHTML = '';
  subGrid.innerHTML = '';

  const utilities = receipts.filter((r) => r.type === 'utility');
  const subscriptions = receipts.filter((r) => r.type === 'subscription');

  if (utilities.length === 0) utilGrid.innerHTML = '<div class="empty-cell">Sin servicios ni cuotas registradas.</div>';
  if (subscriptions.length === 0) subGrid.innerHTML = '<div class="empty-cell">Sin suscripciones registradas.</div>';

  utilities.forEach((r) => utilGrid.appendChild(renderCard(r)));
  subscriptions.forEach((r) => subGrid.appendChild(renderCard(r)));

  // KPIs
  const monthly = receipts.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  document.getElementById('kpiMonthly').textContent = formatMoney(monthly);
  document.getElementById('kpiAnnual').textContent = formatMoney(monthly * 12);

  if (receipts.length > 0) {
    const next = [...receipts].sort((a, b) => daysUntilDue(a.dueDay) - daysUntilDue(b.dueDay))[0];
    const d = daysUntilDue(next.dueDay);
    document.getElementById('kpiNext').textContent = `${next.name} · ${d === 0 ? 'hoy' : d + 'd'}`;
  } else {
    document.getElementById('kpiNext').textContent = '—';
  }
}

function renderCard(r) {
  const days = daysUntilDue(r.dueDay);
  const soon = days <= 2;
  const dueLabel = days === 0 ? 'Vence hoy' : (days === 1 ? 'Vence mañana' : `Vence en ${days}d`);

  const card = document.createElement('div');
  card.className = 'receipt-card';
  card.innerHTML = `
    <div class="card-top">
      <div class="card-name">${escapeHtml(r.name)}</div>
      <span class="due-badge ${soon ? 'soon' : 'normal'}">${dueLabel}</span>
    </div>
    <div class="card-amount">${formatMoney(r.amount)}</div>
    <div class="card-footer-row">
      <span>Día ${r.dueDay} de cada mes</span>
    </div>
    <button type="button" class="pay-btn" data-id="${r.id}">Marcar como pagado</button>
  `;
  card.addEventListener('click', (e) => {
    if (e.target.classList.contains('pay-btn')) return;
    openReceiptDrawer(r);
  });
  card.querySelector('.pay-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    payReceipt(r);
  });
  return card;
}

// ---------- Pagar: crea la transacción real (Módulo 2) ----------
async function payReceipt(r) {
  if (!confirm(`¿Registrar el pago de "${r.name}" por ${formatMoney(r.amount)}?`)) return;

  const userRef = doc(db, 'users', uid);
  const newTxRef = doc(collection(db, 'users', uid, 'transactions'));
  const accountRef = doc(db, 'users', uid, 'accounts', r.accountId);
  const debtRef = r.debtId ? doc(db, 'users', uid, 'debts', r.debtId) : null;
  const type = r.debtId ? 'debt_payment' : 'expense';

  try {
    await runTransaction(db, async (t) => {
      const userSnap = await t.get(userRef);
      const accountSnap = await t.get(accountRef);
      const debtSnap = debtRef ? await t.get(debtRef) : null;

      const folio = userSnap.data()?.nextTransactionFolio || 1;
      const amount = Number(r.amount) || 0;

      t.set(newTxRef, {
        folio,
        date: new Date().toISOString().slice(0, 10),
        type,
        amount,
        categoryId: r.categoryId,
        accountId: r.accountId,
        destinationAccountId: null,
        debtId: r.debtId || null,
        notes: `Pago de ${r.name}`,
        hashtags: ['#Recibo'],
        createdAt: serverTimestamp(),
      });
      t.update(userRef, { nextTransactionFolio: folio + 1 });

      const currentBalance = Number(accountSnap.data()?.balance) || 0;
      t.update(accountRef, { balance: currentBalance - amount });

      if (debtRef) {
        const debtData = debtSnap.data() || {};
        const newRemaining = Math.max(0, (Number(debtData.remainingBalance) || 0) - amount);
        const update = { remainingBalance: newRemaining };
        if (debtData.remainingInstallments != null) {
          update.remainingInstallments = Math.max(0, Number(debtData.remainingInstallments) - 1);
        }
        t.update(debtRef, update);
      }
    });
  } catch (err) {
    console.error(err);
    alert('No se pudo registrar el pago.');
  }
}

// ---------- Drawer ----------
function setReceiptType(type) {
  currentReceiptType = type;
  document.querySelectorAll('#receiptTypeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
}

function openReceiptDrawer(r = null) {
  editingReceiptId = r ? r.id : null;
  document.getElementById('receiptDrawerTitle').textContent = r ? 'Editar recibo' : 'Nuevo recibo';
  document.getElementById('deleteReceiptBtn').classList.toggle('hidden', !r);

  setReceiptType(r?.type || 'utility');
  document.getElementById('receiptName').value = r?.name || '';
  document.getElementById('receiptAmount').value = r?.amount ?? '';
  document.getElementById('receiptDueDay').value = r?.dueDay ?? '';
  populateSelects();
  document.getElementById('receiptCategory').value = r?.categoryId || '';
  document.getElementById('receiptAccount').value = r?.accountId || '';
  document.getElementById('receiptDebt').value = r?.debtId || '';

  document.getElementById('receiptOverlay').classList.add('open');
}
function closeReceiptDrawer() { document.getElementById('receiptOverlay').classList.remove('open'); }

async function handleReceiptSubmit(e) {
  e.preventDefault();
  const data = {
    type: currentReceiptType,
    name: document.getElementById('receiptName').value.trim(),
    amount: parseFloat(document.getElementById('receiptAmount').value) || 0,
    dueDay: parseInt(document.getElementById('receiptDueDay').value, 10),
    categoryId: document.getElementById('receiptCategory').value,
    accountId: document.getElementById('receiptAccount').value,
    debtId: document.getElementById('receiptDebt').value || null,
    isActive: true,
  };

  if (editingReceiptId) {
    await updateDoc(doc(db, 'users', uid, 'receipts', editingReceiptId), data);
  } else {
    await addDoc(collection(db, 'users', uid, 'receipts'), data);
  }
  closeReceiptDrawer();
}

async function handleDeleteReceipt() {
  if (!editingReceiptId) return;
  if (!confirm('¿Eliminar este recibo?')) return;
  await deleteDoc(doc(db, 'users', uid, 'receipts', editingReceiptId));
  closeReceiptDrawer();
}

// ---------- Utilidades ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
function togglePrivacy() {
  document.querySelectorAll('.card-amount, .kpi-value').forEach((el) => el.classList.toggle('blurred'));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newReceiptBtn').addEventListener('click', () => openReceiptDrawer());
  document.getElementById('closeReceiptBtn').addEventListener('click', closeReceiptDrawer);
  document.getElementById('receiptOverlay').addEventListener('click', (e) => { if (e.target.id === 'receiptOverlay') closeReceiptDrawer(); });
  document.querySelectorAll('#receiptTypeToggle button').forEach((btn) => btn.addEventListener('click', () => setReceiptType(btn.dataset.type)));
  document.getElementById('receiptForm').addEventListener('submit', handleReceiptSubmit);
  document.getElementById('deleteReceiptBtn').addEventListener('click', handleDeleteReceipt);

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
