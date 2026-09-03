// ============================================
// MÓDULO 2 — Transacciones
// Datos guardados en localStorage por ahora.
// TODO (fase Firebase): reemplazar getAll/save por
// llamadas a Firestore (colección users/{uid}/transactions,
// /accounts, /categories) manteniendo la misma forma de datos.
// ============================================

const STORAGE_KEYS = {
  transactions: 'libro_transactions',
  categories: 'libro_categories',
  accounts: 'libro_accounts',
  debts: 'libro_debts',
  folio: 'libro_next_folio',
};

const TYPE_LABELS = {
  income: 'Ingreso',
  expense: 'Gasto',
  transfer: 'Transferencia',
  debt_payment: 'Pago de Deuda',
};

// ---------- Datos semilla (solo si no existe nada aún) ----------
function seedIfEmpty() {
  if (!localStorage.getItem(STORAGE_KEYS.accounts)) {
    save(STORAGE_KEYS.accounts, [
      { id: 'acc_efectivo', name: 'Efectivo' },
      { id: 'acc_bcp', name: 'BCP Ahorros' },
      { id: 'acc_yape', name: 'Yape' },
    ]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.categories)) {
    save(STORAGE_KEYS.categories, [
      { id: 'cat_sueldo', name: 'Sueldo', type: 'income' },
      { id: 'cat_freelance', name: 'Freelance', type: 'income' },
      { id: 'cat_alimentacion', name: 'Alimentación', type: 'expense' },
      { id: 'cat_transporte', name: 'Transporte', type: 'expense' },
      { id: 'cat_gym', name: 'Gimnasio', type: 'expense' },
      { id: 'cat_servicio_deuda', name: 'Servicio de Deuda', type: 'expense' },
    ]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.debts)) {
    save(STORAGE_KEYS.debts, [
      { id: 'debt_prestamo1', name: 'Préstamo 1' },
      { id: 'debt_prestamo2', name: 'Préstamo 2' },
      { id: 'debt_terreno', name: 'Financiamiento Terreno' },
    ]);
  }
  if (!localStorage.getItem(STORAGE_KEYS.transactions)) {
    save(STORAGE_KEYS.transactions, [
      { id: cryptoId(), folio: 1, date: todayISO(), type: 'income', amount: 3200, categoryId: 'cat_sueldo', accountId: 'acc_bcp', notes: 'Pago mensual', hashtags: [] },
      { id: cryptoId(), folio: 2, date: todayISO(), type: 'expense', amount: 85.5, categoryId: 'cat_alimentacion', accountId: 'acc_yape', notes: 'Mercado semanal', hashtags: ['#Casa'] },
      { id: cryptoId(), folio: 3, date: todayISO(), type: 'debt_payment', amount: 450, categoryId: 'cat_servicio_deuda', accountId: 'acc_bcp', debtId: 'debt_terreno', notes: 'Cuota terreno', hashtags: ['#Terreno'] },
    ]);
    localStorage.setItem(STORAGE_KEYS.folio, '4');
  }
}

function load(key) { return JSON.parse(localStorage.getItem(key) || '[]'); }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function cryptoId() { return 'id_' + Math.random().toString(36).slice(2, 10); }

// ---------- Estado en memoria ----------
let accounts = [];
let categories = [];
let debts = [];
let transactions = [];
let currentType = 'income';

// ---------- Inicialización ----------
document.addEventListener('DOMContentLoaded', () => {
  seedIfEmpty();
  accounts = load(STORAGE_KEYS.accounts);
  categories = load(STORAGE_KEYS.categories);
  debts = load(STORAGE_KEYS.debts);
  transactions = load(STORAGE_KEYS.transactions);

  populateStaticSelects();
  populateCategoryOptions('income');
  renderList();

  document.getElementById('txDate').value = todayISO();

  // Abrir / cerrar panel
  document.getElementById('newTxBtn').addEventListener('click', openDrawer);
  document.getElementById('closeTxBtn').addEventListener('click', closeDrawer);
  document.getElementById('txOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'txOverlay') closeDrawer();
  });

  // Selector de tipo
  document.querySelectorAll('#typeToggle button').forEach((btn) => {
    btn.addEventListener('click', () => setType(btn.dataset.type));
  });

  // Categoría dinámica
  document.getElementById('txCategory').addEventListener('change', (e) => {
    document.getElementById('newCategoryRow').classList.toggle('hidden', e.target.value !== '__new__');
  });
  document.getElementById('addCategoryBtn').addEventListener('click', addNewCategory);

  // Envío del formulario
  document.getElementById('txForm').addEventListener('submit', handleSubmit);

  // Filtros
  ['filterSearch', 'filterType', 'filterCategory', 'filterAccount', 'filterFrom', 'filterTo']
    .forEach((id) => document.getElementById(id).addEventListener('input', renderList));

  // Modo discreto (oculta montos)
  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
});

// ---------- Selects estáticos ----------
function populateStaticSelects() {
  const accSelects = [document.getElementById('txAccount'), document.getElementById('txDestination'), document.getElementById('filterAccount')];
  accSelects.forEach((sel, i) => {
    accounts.forEach((a) => {
      const opt = document.createElement('option');
      opt.value = a.id; opt.textContent = a.name;
      sel.appendChild(opt);
    });
  });

  const debtSelect = document.getElementById('txDebt');
  debts.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d.id; opt.textContent = d.name;
    debtSelect.appendChild(opt);
  });

  const filterCat = document.getElementById('filterCategory');
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.name;
    filterCat.appendChild(opt);
  });
}

function populateCategoryOptions(type) {
  const sel = document.getElementById('txCategory');
  sel.innerHTML = '';
  categories.filter((c) => c.type === (type === 'expense' || type === 'debt_payment' ? 'expense' : 'income'))
    .forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id; opt.textContent = c.name;
      sel.appendChild(opt);
    });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__'; newOpt.textContent = '+ Nueva categoría...';
  sel.appendChild(newOpt);
}

// ---------- Tipo de transacción (toggle) ----------
function setType(type) {
  currentType = type;
  document.querySelectorAll('#typeToggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));

  const categoryField = document.getElementById('categoryField');
  const destinationField = document.getElementById('destinationField');
  const debtField = document.getElementById('debtField');
  const accountLabel = document.getElementById('txAccountLabel');

  categoryField.classList.toggle('hidden', type === 'transfer');
  destinationField.classList.toggle('hidden', type !== 'transfer');
  debtField.classList.toggle('hidden', type !== 'debt_payment');
  accountLabel.textContent = type === 'transfer' ? 'Cuenta origen' : 'Cuenta';

  if (type !== 'transfer') populateCategoryOptions(type);
}

// ---------- Nueva categoría sobre la marcha ----------
function addNewCategory() {
  const input = document.getElementById('newCategoryInput');
  const name = input.value.trim();
  if (!name) return;

  const type = (currentType === 'expense' || currentType === 'debt_payment') ? 'expense' : 'income';
  const newCat = { id: cryptoId(), name, type };
  categories.push(newCat);
  save(STORAGE_KEYS.categories, categories);

  populateCategoryOptions(currentType);
  document.getElementById('txCategory').value = newCat.id;
  document.getElementById('newCategoryRow').classList.add('hidden');
  input.value = '';

  // también refresca el filtro
  const filterCat = document.getElementById('filterCategory');
  const opt = document.createElement('option');
  opt.value = newCat.id; opt.textContent = newCat.name;
  filterCat.appendChild(opt);
}

// ---------- Drawer ----------
function openDrawer() {
  document.getElementById('txOverlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('txOverlay').classList.remove('open');
}

// ---------- Guardar transacción ----------
function handleSubmit(e) {
  e.preventDefault();

  const amount = parseFloat(document.getElementById('txAmount').value);
  if (!amount || amount <= 0) return;

  const nextFolio = parseInt(localStorage.getItem(STORAGE_KEYS.folio) || '1', 10);

  const tx = {
    id: cryptoId(),
    folio: nextFolio,
    date: document.getElementById('txDate').value || todayISO(),
    type: currentType,
    amount,
    categoryId: currentType === 'transfer' ? null : document.getElementById('txCategory').value,
    accountId: document.getElementById('txAccount').value,
    destinationAccountId: currentType === 'transfer' ? document.getElementById('txDestination').value : null,
    debtId: currentType === 'debt_payment' ? document.getElementById('txDebt').value : null,
    notes: document.getElementById('txNotes').value.trim(),
    hashtags: document.getElementById('txHashtags').value.trim().split(/\s+/).filter((h) => h.startsWith('#')),
  };

  transactions.unshift(tx);
  save(STORAGE_KEYS.transactions, transactions);
  localStorage.setItem(STORAGE_KEYS.folio, String(nextFolio + 1));

  e.target.reset();
  document.getElementById('txDate').value = todayISO();
  setType('income');
  closeDrawer();
  renderList();
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
      const haystack = (tx.notes + ' ' + tx.hashtags.join(' ')).toLowerCase();
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

  const row = document.createElement('div');
  row.className = 'tx-row';

  const sign = tx.type === 'income' ? '+' : (tx.type === 'transfer' ? '' : '−');

  row.innerHTML = `
    <span class="tx-folio mono">${String(tx.folio).padStart(3, '0')}</span>
    <span class="tx-date">${formatDate(tx.date)}</span>
    <div class="tx-desc">
      <div class="tx-category">${category}</div>
      <div class="tx-meta">${account}${destination ? ' → ' + destination : ''}${tx.notes ? ' · ' + escapeHtml(tx.notes) : ''}</div>
      ${tx.hashtags.length ? `<div class="tx-tags">${tx.hashtags.map((h) => `<span class="tag-chip">${escapeHtml(h)}</span>`).join('')}</div>` : ''}
    </div>
    <span class="tx-type-badge ${tx.type}">${TYPE_LABELS[tx.type]}</span>
    <span class="tx-amount mono ${tx.type}">${sign} S/ ${tx.amount.toFixed(2)}</span>
  `;
  return row;
}

function formatDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Modo discreto ----------
function togglePrivacy() {
  document.body.classList.toggle('privacy-mode');
  document.querySelectorAll('.tx-amount').forEach((el) => {
    el.classList.toggle('blurred');
  });
}
