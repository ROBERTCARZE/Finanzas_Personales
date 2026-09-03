// ============================================
// MÓDULO 4 — Cuentas y Activos
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACCOUNT_TYPE_LABELS = {
  bank: 'Banco',
  cash: 'Efectivo',
  digital_wallet: 'Billetera digital',
  credit_card: 'Tarjeta de crédito',
};

let uid = null;
let accounts = [];
let debts = [];
let editingAccountId = null;
let editingDebtId = null;
let currentDebtType = 'loan';

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  uid = user.uid;
  listenAccounts();
  listenDebts();
  attachEventListeners();
});

// ---------- Escuchas en tiempo real ----------
function listenAccounts() {
  const q = query(collection(db, 'users', uid, 'accounts'), orderBy('name'));
  onSnapshot(q, (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAccounts();
    renderKpis();
  });
}

function listenDebts() {
  const q = query(collection(db, 'users', uid, 'debts'), orderBy('name'));
  onSnapshot(q, (snap) => {
    debts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDebts();
    renderKpis();
  });
}

// ---------- KPIs ----------
function renderKpis() {
  const liquidity = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalDebt = debts.reduce((sum, d) => sum + (Number(d.remainingBalance) || 0), 0);
  const assetValue = debts.reduce((sum, d) => sum + (Number(d.linkedAssetValue) || 0), 0);
  const netWorth = liquidity + assetValue - totalDebt;

  document.getElementById('kpiLiquidity').textContent = formatMoney(liquidity);
  document.getElementById('kpiDebt').textContent = formatMoney(totalDebt);
  document.getElementById('kpiNetWorth').textContent = formatMoney(netWorth);
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================
// CUENTAS
// ============================================
function renderAccounts() {
  const grid = document.getElementById('accountsGrid');
  grid.innerHTML = '';

  if (accounts.length === 0) {
    grid.innerHTML = '<div class="empty-cell">Todavía no tienes cuentas registradas.</div>';
    return;
  }

  accounts.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(a.name || 'Sin nombre')}</div>
          <div class="card-sub">${a.bankName ? escapeHtml(a.bankName) : ''}${a.accountNumber ? ' · ' + escapeHtml(a.accountNumber) : ''}</div>
        </div>
        <span class="type-pill">${ACCOUNT_TYPE_LABELS[a.type] || 'Cuenta'}</span>
      </div>
      <div class="card-amount">${formatMoney(a.balance)}</div>
      <div class="card-amount-label">Saldo disponible</div>
    `;
    card.addEventListener('click', () => openAccountDrawer(a));
    grid.appendChild(card);
  });
}

function openAccountDrawer(account = null) {
  editingAccountId = account ? account.id : null;
  document.getElementById('accountDrawerTitle').textContent = account ? 'Editar cuenta' : 'Nueva cuenta';
  document.getElementById('deleteAccountBtn').classList.toggle('hidden', !account);

  document.getElementById('accName').value = account?.name || '';
  document.getElementById('accType').value = account?.type || 'bank';
  document.getElementById('accBankName').value = account?.bankName || '';
  document.getElementById('accNumber').value = account?.accountNumber || '';
  document.getElementById('accCci').value = account?.cci || '';
  document.getElementById('accBalance').value = account?.balance ?? 0;

  toggleBankFields();
  document.getElementById('accountOverlay').classList.add('open');
}
function closeAccountDrawer() { document.getElementById('accountOverlay').classList.remove('open'); }

function toggleBankFields() {
  const isBank = document.getElementById('accType').value === 'bank';
  document.querySelectorAll('.bank-only').forEach((el) => el.classList.toggle('hidden', !isBank));
}

async function handleAccountSubmit(e) {
  e.preventDefault();
  const data = {
    name: document.getElementById('accName').value.trim(),
    type: document.getElementById('accType').value,
    bankName: document.getElementById('accBankName').value.trim(),
    accountNumber: document.getElementById('accNumber').value.trim(),
    cci: document.getElementById('accCci').value.trim(),
    balance: parseFloat(document.getElementById('accBalance').value) || 0,
    isActive: true,
  };

  if (editingAccountId) {
    await updateDoc(doc(db, 'users', uid, 'accounts', editingAccountId), data);
  } else {
    await addDoc(collection(db, 'users', uid, 'accounts'), data);
  }
  closeAccountDrawer();
}

async function handleDeleteAccount() {
  if (!editingAccountId) return;
  if (!confirm('¿Eliminar esta cuenta? Las transacciones ya registradas no se verán afectadas, pero perderás la referencia.')) return;
  await deleteDoc(doc(db, 'users', uid, 'accounts', editingAccountId));
  closeAccountDrawer();
}

// ============================================
// DEUDAS (préstamos y terreno)
// ============================================
function renderDebts() {
  const grid = document.getElementById('debtsGrid');
  grid.innerHTML = '';

  if (debts.length === 0) {
    grid.innerHTML = '<div class="empty-cell">Todavía no tienes préstamos ni el terreno registrados.</div>';
    return;
  }

  debts.forEach((d) => {
    const original = Number(d.originalAmount) || Number(d.remainingBalance) || 0;
    const remaining = Number(d.remainingBalance) || 0;
    const paidPct = original > 0 ? Math.min(100, Math.round(((original - remaining) / original) * 100)) : 0;
    const isLand = d.type === 'land_financing';

    const card = document.createElement('div');
    card.className = 'entity-card';
    card.innerHTML = `
      <div class="card-top">
        <div>
          <div class="card-name">${escapeHtml(d.name || 'Sin nombre')}</div>
          <div class="card-sub">${d.entity ? escapeHtml(d.entity) : 'Sin entidad registrada'}</div>
        </div>
        <span class="type-pill">${isLand ? 'Terreno' : 'Préstamo'}</span>
      </div>

      <div class="card-amount negative">${formatMoney(remaining)}</div>
      <div class="card-amount-label">Saldo pendiente${isLand && d.linkedAssetValue ? ' · Activo: ' + formatMoney(d.linkedAssetValue) : ''}</div>

      <div class="progress-track"><div class="progress-fill" style="width:${paidPct}%"></div></div>
      <div class="progress-meta">
        <span>${paidPct}% pagado</span>
        <span>${d.remainingInstallments ?? '—'}/${d.totalInstallments ?? '—'} cuotas</span>
      </div>

      <div class="card-footer-row">
        <span>Cuota mensual</span>
        <strong>${formatMoney(d.monthlyPayment)}${d.dueDay ? ' · día ' + d.dueDay : ''}</strong>
      </div>
      ${Number(d.lateFees) > 0 ? `<div class="card-footer-row"><span>Moras acumuladas</span><strong>${formatMoney(d.lateFees)}</strong></div>` : ''}
    `;
    card.addEventListener('click', () => openDebtDrawer(d));
    grid.appendChild(card);
  });
}

function openDebtDrawer(debtItem = null) {
  editingDebtId = debtItem ? debtItem.id : null;
  document.getElementById('debtDrawerTitle').textContent = debtItem ? 'Editar compromiso' : 'Nuevo compromiso';
  document.getElementById('deleteDebtBtn').classList.toggle('hidden', !debtItem);

  setDebtType(debtItem?.type || 'loan');

  document.getElementById('debtName').value = debtItem?.name || '';
  document.getElementById('debtEntity').value = debtItem?.entity || '';
  document.getElementById('debtAssetValue').value = debtItem?.linkedAssetValue || '';
  document.getElementById('debtRemaining').value = debtItem?.remainingBalance ?? '';
  document.getElementById('debtMonthly').value = debtItem?.monthlyPayment ?? '';
  document.getElementById('debtDueDay').value = debtItem?.dueDay || '';
  document.getElementById('debtRemainingInst').value = debtItem?.remainingInstallments ?? '';
  document.getElementById('debtTotalInst').value = debtItem?.totalInstallments ?? '';
  document.getElementById('debtLateFees').value = debtItem?.lateFees ?? 0;

  // Guardamos el monto original si ya existía (para la barra de progreso); si es nuevo, se fija al crear.
  document.getElementById('debtForm').dataset.originalAmount = debtItem?.originalAmount ?? debtItem?.remainingBalance ?? '';

  document.getElementById('debtOverlay').classList.add('open');
}
function closeDebtDrawer() { document.getElementById('debtOverlay').classList.remove('open'); }

function setDebtType(type) {
  currentDebtType = type;
  document.querySelectorAll('#debtTypeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  document.getElementById('assetValueField').classList.toggle('hidden', type !== 'land_financing');
}

async function handleDebtSubmit(e) {
  e.preventDefault();
  const remaining = parseFloat(document.getElementById('debtRemaining').value) || 0;
  const existingOriginal = parseFloat(e.target.dataset.originalAmount);

  const data = {
    name: document.getElementById('debtName').value.trim(),
    type: currentDebtType,
    entity: document.getElementById('debtEntity').value.trim(),
    linkedAssetValue: currentDebtType === 'land_financing' ? (parseFloat(document.getElementById('debtAssetValue').value) || 0) : null,
    remainingBalance: remaining,
    originalAmount: !isNaN(existingOriginal) && existingOriginal > 0 ? existingOriginal : remaining,
    monthlyPayment: parseFloat(document.getElementById('debtMonthly').value) || 0,
    dueDay: parseInt(document.getElementById('debtDueDay').value, 10) || null,
    totalInstallments: parseInt(document.getElementById('debtTotalInst').value, 10) || null,
    remainingInstallments: parseInt(document.getElementById('debtRemainingInst').value, 10) || null,
    lateFees: parseFloat(document.getElementById('debtLateFees').value) || 0,
    isActive: true,
  };

  if (editingDebtId) {
    await updateDoc(doc(db, 'users', uid, 'debts', editingDebtId), data);
  } else {
    await addDoc(collection(db, 'users', uid, 'debts'), data);
  }
  closeDebtDrawer();
}

async function handleDeleteDebt() {
  if (!editingDebtId) return;
  if (!confirm('¿Eliminar este compromiso? Esta acción no se puede deshacer.')) return;
  await deleteDoc(doc(db, 'users', uid, 'debts', editingDebtId));
  closeDebtDrawer();
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
  document.getElementById('newAccountBtn').addEventListener('click', () => openAccountDrawer());
  document.getElementById('closeAccountBtn').addEventListener('click', closeAccountDrawer);
  document.getElementById('accountOverlay').addEventListener('click', (e) => { if (e.target.id === 'accountOverlay') closeAccountDrawer(); });
  document.getElementById('accType').addEventListener('change', toggleBankFields);
  document.getElementById('accountForm').addEventListener('submit', handleAccountSubmit);
  document.getElementById('deleteAccountBtn').addEventListener('click', handleDeleteAccount);

  document.getElementById('newDebtBtn').addEventListener('click', () => openDebtDrawer());
  document.getElementById('closeDebtBtn').addEventListener('click', closeDebtDrawer);
  document.getElementById('debtOverlay').addEventListener('click', (e) => { if (e.target.id === 'debtOverlay') closeDebtDrawer(); });
  document.querySelectorAll('#debtTypeToggle button').forEach((btn) => btn.addEventListener('click', () => setDebtType(btn.dataset.type)));
  document.getElementById('debtForm').addEventListener('submit', handleDebtSubmit);
  document.getElementById('deleteDebtBtn').addEventListener('click', handleDeleteDebt);

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
