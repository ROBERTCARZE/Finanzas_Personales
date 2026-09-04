// ============================================
// MÓDULO 5 — Objetivos de Ahorro
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, increment,
  query, orderBy, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let uid = null;
let accounts = [];
let goals = [];
let editingGoalId = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = 'index.html';
    return;
  }
  uid = user.uid;
  listenAccounts();
  listenGoals();
  attachEventListeners();

  if (new URLSearchParams(window.location.search).has('new')) openGoalDrawer();
});

// ---------- Escuchas en tiempo real ----------
function listenAccounts() {
  onSnapshot(collection(db, 'users', uid, 'accounts'), (snap) => {
    accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    populateAccountSelect();
  });
}

function listenGoals() {
  const q = query(collection(db, 'users', uid, 'goals'), orderBy('targetDate'));
  onSnapshot(q, (snap) => {
    goals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderGoals();
  });
}

function populateAccountSelect() {
  const sel = document.getElementById('goalAccount');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Sin vincular (meta virtual)</option>';
  accounts.forEach((a) => sel.appendChild(new Option(a.name, a.id)));
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function formatMoney(n) {
  return 'S/ ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- Meses restantes hasta la fecha límite ----------
function monthsRemaining(targetDate) {
  if (!targetDate) return 1;
  const target = new Date(targetDate + 'T00:00:00');
  const today = new Date();
  let months = (target.getFullYear() - today.getFullYear()) * 12 + (target.getMonth() - today.getMonth());
  if (target.getDate() < today.getDate()) months -= 1;
  return months;
}

// ---------- Render ----------
function renderGoals() {
  const grid = document.getElementById('goalsGrid');
  grid.innerHTML = '';

  let totalSaved = 0;
  let totalTarget = 0;
  let completedCount = 0;

  if (goals.length === 0) {
    grid.innerHTML = '<div class="empty-cell">Todavía no tienes objetivos de ahorro. Crea el primero — un fondo de emergencia es un buen punto de partida.</div>';
  }

  goals.forEach((g) => {
    const target = Number(g.targetAmount) || 0;
    const current = Number(g.currentAmount) || 0;
    const isCompleted = current >= target && target > 0;
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;

    totalSaved += current;
    totalTarget += target;
    if (isCompleted) completedCount += 1;

    const months = monthsRemaining(g.targetDate);
    let footerText;
    if (isCompleted) {
      footerText = '¡Meta cumplida! 🎉';
    } else if (months <= 0) {
      footerText = 'Fecha límite vencida';
    } else {
      const monthly = (target - current) / months;
      footerText = `${formatMoney(monthly)} / mes para lograrlo`;
    }

    const linkedAccount = g.linkedAccountId ? accounts.find((a) => a.id === g.linkedAccountId) : null;

    const card = document.createElement('div');
    card.className = `goal-card ${isCompleted ? 'completed' : ''}`;
    card.innerHTML = `
      <div class="card-top">
        <div class="goal-icon">${escapeHtml(g.icon || '🎯')}</div>
        <div>
          <div class="card-name">${escapeHtml(g.name || 'Sin nombre')}</div>
          <div class="card-sub">${g.targetDate ? 'Meta: ' + formatDate(g.targetDate) : ''}${linkedAccount ? ' · ' + escapeHtml(linkedAccount.name) : ''}</div>
        </div>
        ${isCompleted ? '<span class="completed-badge">Completado</span>' : ''}
      </div>

      <div class="goal-amounts">
        <span class="goal-current">${formatMoney(current)}</span>
        <span class="goal-target">de ${formatMoney(target)}</span>
      </div>

      <div class="progress-track"><div class="progress-fill ${isCompleted ? 'completed' : ''}" style="width:${pct}%"></div></div>

      <div class="card-footer-row">
        <span>${footerText}</span>
        ${!isCompleted ? '<button type="button" class="add-contribution-btn" data-id="' + g.id + '">+ Aporte</button>' : ''}
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('add-contribution-btn')) return; // el botón maneja su propio click
      openGoalDrawer(g);
    });

    const contribBtn = card.querySelector('.add-contribution-btn');
    if (contribBtn) {
      contribBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addContribution(g);
      });
    }

    grid.appendChild(card);
  });

  document.getElementById('kpiSaved').textContent = formatMoney(totalSaved);
  document.getElementById('kpiTarget').textContent = formatMoney(totalTarget);
  document.getElementById('kpiCompleted').textContent = `${completedCount} / ${goals.length}`;
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ---------- Aporte rápido (incremento atómico) ----------
async function addContribution(goal) {
  const input = prompt(`¿Cuánto quieres aportar a "${goal.name}"?`, '');
  if (input === null) return;
  const amount = parseFloat(input);
  if (!amount || amount <= 0) return;

  await updateDoc(doc(db, 'users', uid, 'goals', goal.id), {
    currentAmount: increment(amount),
  });
}

// ---------- Drawer ----------
function openGoalDrawer(goal = null) {
  editingGoalId = goal ? goal.id : null;
  document.getElementById('goalDrawerTitle').textContent = goal ? 'Editar objetivo' : 'Nuevo objetivo';
  document.getElementById('deleteGoalBtn').classList.toggle('hidden', !goal);

  document.getElementById('goalIcon').value = goal?.icon || '';
  document.getElementById('goalName').value = goal?.name || '';
  document.getElementById('goalTarget').value = goal?.targetAmount ?? '';
  document.getElementById('goalCurrent').value = goal?.currentAmount ?? 0;
  document.getElementById('goalDate').value = goal?.targetDate || '';
  populateAccountSelect();
  document.getElementById('goalAccount').value = goal?.linkedAccountId || '';

  document.getElementById('goalOverlay').classList.add('open');
}
function closeGoalDrawer() { document.getElementById('goalOverlay').classList.remove('open'); }

async function handleGoalSubmit(e) {
  e.preventDefault();
  const data = {
    icon: document.getElementById('goalIcon').value.trim() || '🎯',
    name: document.getElementById('goalName').value.trim(),
    targetAmount: parseFloat(document.getElementById('goalTarget').value) || 0,
    currentAmount: parseFloat(document.getElementById('goalCurrent').value) || 0,
    targetDate: document.getElementById('goalDate').value,
    linkedAccountId: document.getElementById('goalAccount').value || null,
  };

  if (editingGoalId) {
    await updateDoc(doc(db, 'users', uid, 'goals', editingGoalId), data);
  } else {
    await addDoc(collection(db, 'users', uid, 'goals'), data);
  }
  closeGoalDrawer();
}

async function handleDeleteGoal() {
  if (!editingGoalId) return;
  if (!confirm('¿Eliminar este objetivo de ahorro?')) return;
  await deleteDoc(doc(db, 'users', uid, 'goals', editingGoalId));
  closeGoalDrawer();
}

// ---------- Utilidades ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function togglePrivacy() {
  document.querySelectorAll('.goal-current, .kpi-value').forEach((el) => el.classList.toggle('blurred'));
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newGoalBtn').addEventListener('click', () => openGoalDrawer());
  document.getElementById('closeGoalBtn').addEventListener('click', closeGoalDrawer);
  document.getElementById('goalOverlay').addEventListener('click', (e) => { if (e.target.id === 'goalOverlay') closeGoalDrawer(); });
  document.getElementById('goalForm').addEventListener('submit', handleGoalSubmit);
  document.getElementById('deleteGoalBtn').addEventListener('click', handleDeleteGoal);

  document.getElementById('privacyBtn').addEventListener('click', togglePrivacy);
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
