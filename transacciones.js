// ============================================
// MÓDULO 2 — Transacciones (conectado a Firestore)
// Estructura: users/{uid}/accounts, /categories,
// /debts, /transactions — según el modelo de datos
// diseñado previamente.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, addDoc, setDoc,
  query, orderBy, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const TYPE_LABELS = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  debt_payment: 'Pago de Deuda',
};

let uid = null;
let accounts = [];
let categories = [];
let debts = [];
let transactions = [];
let currentType = 'income';
let editingTxId = null;

// ---------- Guardia de sesión ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  uid = user.uid;

  await ensureUserDoc();
  await seedIfEmpty();
  await loadReferenceData();

  populateStaticSelects();
  populateCategoryOptions('income');
  document.getElementById('txDate').value = todayISO();

  listenTransactions();
  attachEventListeners();

  // Si llegamos desde el acceso rápido del Dashboard, abrir el formulario directo.
  if (new URLSearchParams(window.location.search).has('new')) openDrawer();
});

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ---------- Documento raíz del usuario ----------
async function ensureUserDoc() {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, {
      email: auth.currentUser.email,
      currency: 'PEN',
      privacyMode: false,
      createdAt: serverTimestamp(),
      nextTransactionFolio: 1,
    });
  }
}

// ---------- Datos semilla (solo la primera vez) ----------
async function seedIfEmpty() {
  const accSnap = await getDocs(collection(db, 'users', uid, 'accounts'));
  if (accSnap.empty) {
    const seed = [['acc_efectivo', 'Efectivo'], ['acc_bcp', 'BCP Ahorros'], ['acc_yape', 'Yape']];
    for (const [id, name] of seed) await setDoc(doc(db, 'users', uid, 'accounts', id), { name });
  }

  const catSnap = await getDocs(collection(db, 'users', uid, 'categories'));
  if (catSnap.empty) {
    const seed = [
      ['cat_sueldo', 'Sueldo', 'income'],
      ['cat_freelance', 'Freelance', 'income'],
      ['cat_alimentacion', 'Alimentación', 'expense'],
      ['cat_transporte', 'Transporte', 'expense'],
      ['cat_gym', 'Gimnasio', 'expense'],
      ['cat_servicio_deuda', 'Servicio de Deuda', 'expense'],
    ];
    for (const [id, name, type] of seed) await setDoc(doc(db, 'users', uid, 'categories', id), { name, type });
  }

  const debtSnap = await getDocs(collection(db, 'users', uid, 'debts'));
  if (debtSnap.empty) {
    const seed = [['debt_prestamo1', 'Préstamo 1'], ['debt_prestamo2', 'Préstamo 2'], ['debt_terreno', 'Financiamiento Terreno']];
    for (const [id, name] of seed) await setDoc(doc(db, 'users', uid, 'debts', id), { name });
  }
}

// ---------- Cargar catálogos ----------
async function loadReferenceData() {
  const [accSnap, catSnap, debtSnap] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'accounts')),
    getDocs(collection(db, 'users', uid, 'categories')),
    getDocs(collection(db, 'users', uid, 'debts')),
  ]);
  accounts = accSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  categories = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  debts = debtSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Escucha en tiempo real de transacciones ----------
function listenTransactions() {
  const q = query(collection(db, 'users', uid, 'transactions'), orderBy('folio', 'desc'));
  onSnapshot(q, (snap) => {
    transactions = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderList();
  });
}

// ---------- Selects estáticos ----------
function populateStaticSelects() {
  populateAccountOptions();

  const debtSelect = document.getElementById('txDebt');
  debtSelect.innerHTML = '';
  debts.forEach((d) => debtSelect.appendChild(new Option(d.name, d.id)));

  const filterCat = document.getElementById('filterCategory');
  categories.forEach((c) => filterCat.appendChild(new Option(c.name, c.id)));
}

function populateAccountOptions() {
  const txAccount = document.getElementById('txAccount');
  const txDestination = document.getElementById('txDestination');
  const filterAccount = document.getElementById('filterAccount');

  const prevAccount = txAccount.value;
  const prevDestination = txDestination.value;

  [txAccount, txDestination].forEach((sel) => {
    sel.innerHTML = '';
    accounts.forEach((a) => sel.appendChild(new Option(a.name, a.id)));
    sel.appendChild(new Option('+ Nueva cuenta...', '__new__'));
  });

  filterAccount.innerHTML = '<option value="">Todas las cuentas</option>';
  accounts.forEach((a) => filterAccount.appendChild(new Option(a.name, a.id)));

  if (accounts.some((a) => a.id === prevAccount)) txAccount.value = prevAccount;
  if (accounts.some((a) => a.id === prevDestination)) txDestination.value = prevDestination;
}

function populateCategoryOptions(type) {
  const sel = document.getElementById('txCategory');
  sel.innerHTML = '';
  const wanted = (type === 'expense' || type === 'debt_payment') ? 'expense' : 'income';
  categories.filter((c) => c.type === wanted).forEach((c) => sel.appendChild(new Option(c.name, c.id)));
  sel.appendChild(new Option('+ Nueva categoría...', '__new__'));
}

// ---------- Tipo de transacción ----------
function setType(type) {
  currentType = type;
  document.querySelectorAll('#typeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));

  document.getElementById('categoryField').classList.toggle('hidden', type === 'transfer');
  document.getElementById('destinationField').classList.toggle('hidden', type !== 'transfer');
  document.getElementById('debtField').classList.toggle('hidden', type !== 'debt_payment');
  document.getElementById('txAccountLabel').textContent = type === 'transfer' ? 'Cuenta origen' : 'Cuenta';

  if (type !== 'transfer') populateCategoryOptions(type);
}

// ---------- Nueva categoría sobre la marcha ----------
async function addNewCategory() {
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if (!name) return;

  const type = (currentType === 'expense' || currentType === 'debt_payment') ? 'expense' : 'income';
  const docRef = await addDoc(collection(db, 'users', uid, 'categories'), { name, type });
  const newCat = { id: docRef.id, name, type };
  categories.push(newCat);

  populateCategoryOptions(currentType);
  document.getElementById('txCategory').value = newCat.id;
  document.getElementById('newCategoryRow').classList.add('hidden');
  input.value = '';

  document.getElementById('filterCategory').appendChild(new Option(newCat.name, newCat.id));
}

// ---------- Nueva cuenta sobre la marcha ----------
// Se crea en la misma colección que usa el Módulo 4 (Cuentas y Activos),
// así que aparece ahí automáticamente, ya lista para completar sus datos
// (banco, CCI, etc.) cuando quieras.
async function addNewAccount(targetSelectId, inputId, rowId) {
  const input = document.getElementById(inputId);
  const name = input.value.trim();
  if (!name) return;

  const docRef = await addDoc(collection(db, 'users', uid, 'accounts'), {
    name,
    type: 'bank',
    balance: 0,
    isActive: true,
  });
  accounts.push({ id: docRef.id, name, type: 'bank', balance: 0 });

  populateAccountOptions();
  document.getElementById(targetSelectId).value = docRef.id;
  document.getElementById(rowId).classList.add('hidden');
  input.value = '';
}

// ---------- Drawer ----------
function openDrawer(tx = null) {
  editingTxId = tx ? tx.id : null;
  document.getElementById('txDrawerTitle').textContent = tx ? 'Editar transacción' : 'Nueva transacción';
  document.getElementById('deleteTxBtn').classList.toggle('hidden', !tx);

  if (tx) {
    setType(tx.type);
    document.getElementById('txDate').value = tx.date;
    document.getElementById('txAmount').value = tx.amount;
    document.getElementById('txAccount').value = tx.accountId;
    if (tx.type === 'transfer') document.getElementById('txDestination').value = tx.destinationAccountId || '';
    if (tx.type === 'debt_payment') document.getElementById('txDebt').value = tx.debtId || '';
    if (tx.type !== 'transfer') document.getElementById('txCategory').value = tx.categoryId || '';
    document.getElementById('txNotes').value = tx.notes || '';
    document.getElementById('txHashtags').value = (tx.hashtags || []).join(' ');
  } else {
    document.getElementById('txForm').reset();
    document.getElementById('txDate').value = todayISO();
    setType('income');
  }

  document.getElementById('txOverlay').classList.add('open');
}
function closeDrawer() { document.getElementById('txOverlay').classList.remove('open'); }

// ---------- Efectos de una transacción sobre saldos y deudas ----------
// Dado un registro (type, amount, accountId, destinationAccountId, debtId),
// devuelve cuánto mueve cada cuenta y, si aplica, cuánto reduce la deuda.
// Se usa tanto para aplicar (crear) como para revertir (editar/eliminar).
function computeEffects(record) {
  const accounts = {};
  const amount = Number(record.amount) || 0;

  if (record.type === 'income') {
    accounts[record.accountId] = (accounts[record.accountId] || 0) + amount;
  } else if (record.type === 'expense') {
    accounts[record.accountId] = (accounts[record.accountId] || 0) - amount;
  } else if (record.type === 'transfer') {
    accounts[record.accountId] = (accounts[record.accountId] || 0) - amount;
    if (record.destinationAccountId) {
      accounts[record.destinationAccountId] = (accounts[record.destinationAccountId] || 0) + amount;
    }
  } else if (record.type === 'debt_payment') {
    accounts[record.accountId] = (accounts[record.accountId] || 0) - amount;
  }

  let debt = null;
  if (record.type === 'debt_payment' && record.debtId) {
    debt = { debtId: record.debtId, balanceDelta: -amount, installmentDelta: -1 };
  }
  return { accounts, debt };
}

function addDebtEffect(map, effect, sign) {
  if (!effect) return;
  const cur = map[effect.debtId] || { balanceDelta: 0, installmentDelta: 0 };
  cur.balanceDelta += sign * effect.balanceDelta;
  cur.installmentDelta += sign * effect.installmentDelta;
  map[effect.debtId] = cur;
}

// ---------- Leer el formulario como un registro de transacción ----------
function readFormAsRecord() {
  const accountId = document.getElementById('txAccount').value;
  const destinationId = currentType === 'transfer' ? document.getElementById('txDestination').value : null;
  const debtId = currentType === 'debt_payment' ? document.getElementById('txDebt').value : null;

  return {
    date: document.getElementById('txDate').value || todayISO(),
    type: currentType,
    amount: parseFloat(document.getElementById('txAmount').value) || 0,
    categoryId: currentType === 'transfer' ? null : document.getElementById('txCategory').value,
    accountId,
    destinationAccountId: destinationId,
    debtId,
    notes: document.getElementById('txNotes').value.trim(),
    hashtags: document.getElementById('txHashtags').value.trim().split(/\s+/).filter((h) => h.startsWith('#')),
  };
}

// ---------- Guardar (crear o editar) ----------
async function handleSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) return;

  if (document.getElementById('txAccount').value === '__new__' || document.getElementById('txDestination').value === '__new__') {
    alert('Completa el nombre de la nueva cuenta y presiona "Agregar" antes de guardar.');
    return;
  }

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  try {
    if (editingTxId) {
      await editTransaction(editingTxId, readFormAsRecord());
    } else {
      await createTransaction(readFormAsRecord());
    }
    closeDrawer();
  } catch (err) {
    console.error(err);
    alert('No se pudo guardar la transacción. Revisa tu conexión e intenta de nuevo.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar transacción';
  }
}

// ---------- Crear transacción nueva ----------
async function createTransaction(record) {
  const userRef = doc(db, 'users', uid);
  const newTxRef = doc(collection(db, 'users', uid, 'transactions'));
  const effects = computeEffects(record);

  const accountRefs = {};
  Object.keys(effects.accounts).forEach((id) => { accountRefs[id] = doc(db, 'users', uid, 'accounts', id); });
  const debtRef = effects.debt ? doc(db, 'users', uid, 'debts', effects.debt.debtId) : null;

  await runTransaction(db, async (t) => {
    // --- Lecturas ---
    const userSnap = await t.get(userRef);
    const accountSnaps = {};
    for (const id of Object.keys(accountRefs)) accountSnaps[id] = await t.get(accountRefs[id]);
    const debtSnap = debtRef ? await t.get(debtRef) : null;

    const folio = userSnap.data()?.nextTransactionFolio || 1;

    // --- Escrituras ---
    t.set(newTxRef, { folio, ...record, createdAt: serverTimestamp() });
    t.update(userRef, { nextTransactionFolio: folio + 1 });

    Object.entries(effects.accounts).forEach(([id, delta]) => {
      const current = Number(accountSnaps[id].data()?.balance) || 0;
      t.update(accountRefs[id], { balance: current + delta });
    });

    if (effects.debt && debtRef) {
      const debtData = debtSnap.data() || {};
      const newRemaining = Math.max(0, (Number(debtData.remainingBalance) || 0) + effects.debt.balanceDelta);
      const update = { remainingBalance: newRemaining };
      if (debtData.remainingInstallments != null) {
        update.remainingInstallments = Math.max(0, Number(debtData.remainingInstallments) + effects.debt.installmentDelta);
      }
      t.update(debtRef, update);
    }
  });
}

// ---------- Editar transacción existente ----------
// Revierte el efecto original sobre cuentas/deuda y aplica el nuevo,
// todo en una sola operación atómica.
async function editTransaction(txId, newRecord) {
  const txRef = doc(db, 'users', uid, 'transactions', txId);

  await runTransaction(db, async (t) => {
    const txSnap = await t.get(txRef);
    if (!txSnap.exists()) throw new Error('La transacción ya no existe.');
    const oldRecord = txSnap.data();

    const oldEffects = computeEffects(oldRecord);
    const newEffects = computeEffects(newRecord);

    // Neto por cuenta: -viejo + nuevo
    const netAccounts = {};
    Object.entries(oldEffects.accounts).forEach(([id, delta]) => { netAccounts[id] = (netAccounts[id] || 0) - delta; });
    Object.entries(newEffects.accounts).forEach(([id, delta]) => { netAccounts[id] = (netAccounts[id] || 0) + delta; });

    const netDebtMap = {};
    addDebtEffect(netDebtMap, oldEffects.debt, -1);
    addDebtEffect(netDebtMap, newEffects.debt, +1);

    const accountRefs = {};
    Object.keys(netAccounts).forEach((id) => { accountRefs[id] = doc(db, 'users', uid, 'accounts', id); });
    const debtRefs = {};
    Object.keys(netDebtMap).forEach((id) => { debtRefs[id] = doc(db, 'users', uid, 'debts', id); });

    // --- Lecturas ---
    const accountSnaps = {};
    for (const id of Object.keys(accountRefs)) accountSnaps[id] = await t.get(accountRefs[id]);
    const debtSnaps = {};
    for (const id of Object.keys(debtRefs)) debtSnaps[id] = await t.get(debtRefs[id]);

    // --- Escrituras ---
    t.update(txRef, { ...newRecord });

    Object.entries(netAccounts).forEach(([id, delta]) => {
      if (delta === 0) return;
      const current = Number(accountSnaps[id].data()?.balance) || 0;
      t.update(accountRefs[id], { balance: current + delta });
    });

    Object.entries(netDebtMap).forEach(([id, effect]) => {
      const data = debtSnaps[id].data() || {};
      const newRemaining = Math.max(0, (Number(data.remainingBalance) || 0) + effect.balanceDelta);
      const update = { remainingBalance: newRemaining };
      if (data.remainingInstallments != null) {
        update.remainingInstallments = Math.max(0, Number(data.remainingInstallments) + effect.installmentDelta);
      }
      t.update(debtRefs[id], update);
    });
  });
}

// ---------- Eliminar transacción ----------
async function deleteTransaction() {
  if (!editingTxId) return;
  if (!confirm('¿Eliminar esta transacción? Se revertirá su efecto sobre el saldo de la cuenta (y la deuda, si aplica).')) return;

  const txRef = doc(db, 'users', uid, 'transactions', editingTxId);

  try {
    await runTransaction(db, async (t) => {
      const txSnap = await t.get(txRef);
      if (!txSnap.exists()) return;
      const oldRecord = txSnap.data();
      const effects = computeEffects(oldRecord);

      const accountRefs = {};
      Object.keys(effects.accounts).forEach((id) => { accountRefs[id] = doc(db, 'users', uid, 'accounts', id); });
      const debtRef = effects.debt ? doc(db, 'users', uid, 'debts', effects.debt.debtId) : null;

      const accountSnaps = {};
      for (const id of Object.keys(accountRefs)) accountSnaps[id] = await t.get(accountRefs[id]);
      const debtSnap = debtRef ? await t.get(debtRef) : null;

      t.delete(txRef);

      Object.entries(effects.accounts).forEach(([id, delta]) => {
        const current = Number(accountSnaps[id].data()?.balance) || 0;
        t.update(accountRefs[id], { balance: current - delta });
      });

      if (effects.debt && debtRef) {
        const data = debtSnap.data() || {};
        const newRemaining = Math.max(0, (Number(data.remainingBalance) || 0) - effects.debt.balanceDelta);
        const update = { remainingBalance: newRemaining };
        if (data.remainingInstallments != null) {
          update.remainingInstallments = Math.max(0, Number(data.remainingInstallments) - effects.debt.installmentDelta);
        }
        t.update(debtRef, update);
      }
    });
    closeDrawer();
  } catch (err) {
    console.error(err);
    alert('No se pudo eliminar la transacción.');
  }
}

// ---------- Render del listado con filtros ----------
function renderList() {
  const search = document.getElementById('filterSearch').value.toLowerCase();
  const typeFilter = document.getElementById('filterType').value;
  const catFilter = document.getElementById('filterCategory').value;
  const accFilter = document.getElementById('filterAccount').value;
  const from = document.getElementById('filterFrom').value;
  const to = document.getElementById('filterTo').value;

  const filtered = transactions.filter((tx) => {
    if (typeFilter && tx.type !== typeFilter) return false;
    if (catFilter && tx.categoryId !== catFilter) return false;
    if (accFilter && tx.accountId !== accFilter && tx.destinationAccountId !== accFilter) return false;
    if (from && tx.date < from) return false;
    if (to && tx.date > to) return false;
    if (search) {
      const haystack = (tx.notes + ' ' + (tx.hashtags || []).join(' ')).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const container = document.getElementById('transactionsList');
  container.innerHTML = '';

  updateKpis(filtered);

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay transacciones que coincidan con estos filtros.</div>';
    return;
  }

  filtered.forEach((tx) => container.appendChild(renderRow(tx)));
}

// ---------- KPIs (según los filtros activos) ----------
// Ingresos = tipo income · Egresos = expense + debt_payment
// (las transferencias no suman ni restan: es tu propio dinero moviéndose de cuenta)
function updateKpis(filtered) {
  const income = filtered.filter((tx) => tx.type === 'income').reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const expense = filtered.filter((tx) => tx.type === 'expense' || tx.type === 'debt_payment').reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
  const savings = income - expense;

  document.getElementById('kpiIncome').textContent = formatMoney(income);
  document.getElementById('kpiExpense').textContent = formatMoney(expense);
  const savingsEl = document.getElementById('kpiSavings');
  savingsEl.textContent = formatMoney(savings);
  savingsEl.classList.remove('kpi-sage', 'kpi-clay');
  savingsEl.classList.add(savings >= 0 ? 'kpi-sage' : 'kpi-clay');
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderRow(tx) {
  const account = accounts.find((a) => a.id === tx.accountId)?.name || '—';
  const category = tx.categoryId ? (categories.find((c) => c.id === tx.categoryId)?.name || '—') : 'Transferencia';
  const destination = tx.destinationAccountId ? accounts.find((a) => a.id === tx.destinationAccountId)?.name : null;
  const hashtags = tx.hashtags || [];

  const row = document.createElement('div');
  row.className = 'tx-row';
  row.addEventListener('click', () => openDrawer(tx));
  const sign = tx.type === 'income' ? '+' : (tx.type === 'transfer' ? '' : '−');

  row.innerHTML = `
    <span class="tx-folio mono">${String(tx.folio).padStart(3, '0')}</span>
    <span class="tx-date">${formatDate(tx.date)}</span>
    <div class="tx-desc">
      <div class="tx-category">${category}</div>
      <div class="tx-meta">${account}${destination ? ' → ' + destination : ''}${tx.notes ? ' · ' + escapeHtml(tx.notes) : ''}</div>
      ${hashtags.length ? `<div class="tx-tags">${hashtags.map((h) => `<span class="tag-chip">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
    </div>
    <span class="tx-type-badge ${tx.type}">${TYPE_LABELS[tx.type]}</span>
    <span class="tx-amount mono ${tx.type}">${sign} S/ ${tx.amount.toFixed(2)}</span>
  `;
  return row;
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Modo discreto ----------
function togglePrivacy() {
  document.querySelectorAll('.tx-amount').forEach((el) => el.classList.toggle('blurred'));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newTxBtn').addEventListener('click', () => openDrawer());
  document.getElementById('closeTxBtn').addEventListener('click', closeDrawer);
  document.getElementById('txOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'txOverlay') closeDrawer();
  });
  document.getElementById('deleteTxBtn').addEventListener('click', deleteTransaction);

  document.querySelectorAll('#typeToggle button').forEach((btn) => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  document.getElementById('txCategory').addEventListener('change', (e) => {
    document.getElementById('newCategoryRow').classList.toggle('hidden', e.target.value !== '__new__');
  });
  document.getElementById('addCategoryBtn').addEventListener('click', addNewCategory);

  document.getElementById('txAccount').addEventListener('change', (e) => {
    document.getElementById('newAccountRow').classList.toggle('hidden', e.target.value !== '__new__');
  });
  document.getElementById('addAccountBtn').addEventListener('click', () => addNewAccount('txAccount', 'newAccountInput', 'newAccountRow'));

  document.getElementById('txDestination').addEventListener('change', (e) => {
    document.getElementById('newDestinationRow').classList.toggle('hidden', e.target.value !== '__new__');
  });
  document.getElementById('addDestinationBtn').addEventListener('click', () => addNewAccount('txDestination', 'newDestinationInput', 'newDestinationRow'));

  document.getElementById('txForm').addEventListener('submit', handleSubmit);

  ['filterSearch', 'filterType', 'filterCategory', 'filterAccount', 'filterFrom', 'filterTo']
    .forEach((id) => document.getElementById(id).addEventListener('input', renderList));

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
