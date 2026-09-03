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
  [document.getElementById('txAccount'), document.getElementById('txDestination'), document.getElementById('filterAccount')]
    .forEach((sel) => accounts.forEach((a) => sel.appendChild(new Option(a.name, a.id))));

  const debtSelect = document.getElementById('txDebt');
  debts.forEach((d) => debtSelect.appendChild(new Option(d.name, d.id)));

  const filterCat = document.getElementById('filterCategory');
  categories.forEach((c) => filterCat.appendChild(new Option(c.name, c.id)));
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

// ---------- Drawer ----------
function openDrawer() { document.getElementById('txOverlay').classList.add('open'); }
function closeDrawer() { document.getElementById('txOverlay').classList.remove('open'); }

// ---------- Guardar transacción ----------
// Además de crear el registro, esta función actualiza atómicamente:
//  - el saldo de la cuenta origen (y destino, si es transferencia)
//  - el pasivo pendiente de la deuda (si es pago de deuda)
// Todo dentro de la misma transacción de Firestore, para que nunca
// quede un movimiento a medias.
async function handleSubmit(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) return;

  const submitBtn = e.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  const userRef = doc(db, 'users', uid);
  const newTxRef = doc(collection(db, 'users', uid, 'transactions'));

  const accountId = document.getElementById('txAccount').value;
  const destinationId = currentType === 'transfer' ? document.getElementById('txDestination').value : null;
  const debtId = currentType === 'debt_payment' ? document.getElementById('txDebt').value : null;

  const accountRef = doc(db, 'users', uid, 'accounts', accountId);
  const destinationRef = destinationId ? doc(db, 'users', uid, 'accounts', destinationId) : null;
  const debtRef = debtId ? doc(db, 'users', uid, 'debts', debtId) : null;

  try {
    await runTransaction(db, async (t) => {
      // --- Lecturas primero (regla de Firestore: todas las lecturas antes de escribir) ---
      const userSnap = await t.get(userRef);
      const accountSnap = await t.get(accountRef);
      const destinationSnap = destinationRef ? await t.get(destinationRef) : null;
      const debtSnap = debtRef ? await t.get(debtRef) : null;

      const folio = userSnap.data()?.nextTransactionFolio || 1;

      // --- Crear el registro de la transacción ---
      t.set(newTxRef, {
        folio,
        date: document.getElementById('txDate').value || todayISO(),
        type: currentType,
        amount,
        categoryId: currentType === 'transfer' ? null : document.getElementById('txCategory').value,
        accountId,
        destinationAccountId: destinationId,
        debtId,
        notes: document.getElementById('txNotes').value.trim(),
        hashtags: document.getElementById('txHashtags').value.trim().split(/\s+/).filter((h) => h.startsWith('#')),
        createdAt: serverTimestamp(),
      });
      t.update(userRef, { nextTransactionFolio: folio + 1 });

      // --- Efectos sobre saldos y deudas, según el tipo ---
      const currentBalance = Number(accountSnap.data()?.balance) || 0;

      if (currentType === 'income') {
        t.update(accountRef, { balance: currentBalance + amount });
      } else if (currentType === 'expense') {
        t.update(accountRef, { balance: currentBalance - amount });
      } else if (currentType === 'transfer' && destinationRef) {
        const destBalance = Number(destinationSnap.data()?.balance) || 0;
        t.update(accountRef, { balance: currentBalance - amount });
        t.update(destinationRef, { balance: destBalance + amount });
      } else if (currentType === 'debt_payment') {
        t.update(accountRef, { balance: currentBalance - amount });
        if (debtRef) {
          const debtData = debtSnap.data() || {};
          const newRemaining = Math.max(0, (Number(debtData.remainingBalance) || 0) - amount);
          const newInstallments = debtData.remainingInstallments != null
            ? Math.max(0, Number(debtData.remainingInstallments) - 1)
            : null;
          const update = { remainingBalance: newRemaining };
          if (newInstallments !== null) update.remainingInstallments = newInstallments;
          t.update(debtRef, update);
        }
      }
    });

    e.target.reset();
    document.getElementById('txDate').value = todayISO();
    setType('income');
    closeDrawer();
  } catch (err) {
    console.error(err);
    alert('No se pudo guardar la transacción. Revisa tu conexión e intenta de nuevo.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Guardar transacción';
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

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay transacciones que coincidan con estos filtros.</div>';
    return;
  }

  filtered.forEach((tx) => container.appendChild(renderRow(tx)));
}

function renderRow(tx) {
  const account = accounts.find((a) => a.id === tx.accountId)?.name || '—';
  const category = tx.categoryId ? (categories.find((c) => c.id === tx.categoryId)?.name || '—') : 'Transferencia';
  const destination = tx.destinationAccountId ? accounts.find((a) => a.id === tx.destinationAccountId)?.name : null;
  const hashtags = tx.hashtags || [];

  const row = document.createElement('div');
  row.className = 'tx-row';
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
  document.getElementById('newTxBtn').addEventListener('click', openDrawer);
  document.getElementById('closeTxBtn').addEventListener('click', closeDrawer);
  document.getElementById('txOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'txOverlay') closeDrawer();
  });

  document.querySelectorAll('#typeToggle button').forEach((btn) => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  document.getElementById('txCategory').addEventListener('change', (e) => {
    document.getElementById('newCategoryRow').classList.toggle('hidden', e.target.value !== '__new__');
  });
  document.getElementById('addCategoryBtn').addEventListener('click', addNewCategory);

  document.getElementById('txForm').addEventListener('submit', handleSubmit);

  ['filterSearch', 'filterType', 'filterCategory', 'filterAccount', 'filterFrom', 'filterTo']
    .forEach((id) => document.getElementById(id).addEventListener('input', renderList));

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
