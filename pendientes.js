// ============================================
// MÓDULO 8 — Pendientes
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  query, orderBy, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CATEGORY_LABELS = { admin: 'Administrativo / Trabajo', social: 'Social / Personal' };
const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };

let uid = null;
let tasks = [];
let editingTaskId = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  listenTasks();
  attachEventListeners();

  if (new URLSearchParams(window.location.search).has('new')) openTaskDrawer();
});

function listenTasks() {
  const q = query(collection(db, 'users', uid, 'tasks'), orderBy('dueDate'));
  onSnapshot(q, (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderTasks();
  });
}

function renderTasks() {
  const catFilter = document.getElementById('filterCategory').value;
  const prioFilter = document.getElementById('filterPriority').value;
  const hideCompleted = document.getElementById('hideCompleted').checked;

  let filtered = tasks.filter((t) => {
    if (catFilter && t.category !== catFilter) return false;
    if (prioFilter && t.priority !== prioFilter) return false;
    if (hideCompleted && t.completed) return false;
    return true;
  });

  filtered = filtered.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
  });

  const list = document.getElementById('taskList');
  list.innerHTML = '';

  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty-state">No hay pendientes que coincidan con estos filtros.</div>';
    return;
  }

  filtered.forEach((t) => list.appendChild(renderRow(t)));
}

function renderRow(t) {
  const row = document.createElement('div');
  row.className = 'task-row';
  row.innerHTML = `
    <div class="task-check ${t.completed ? 'checked' : ''}" data-id="${t.id}">${t.completed ? '✓' : ''}</div>
    <div class="task-body">
      <div class="task-title ${t.completed ? 'done' : ''}">${escapeHtml(t.title)}</div>
      <div class="task-meta">${t.dueDate ? formatDate(t.dueDate) : 'Sin fecha'}</div>
    </div>
    <span class="category-chip">${CATEGORY_LABELS[t.category] || t.category}</span>
    <span class="priority-chip ${t.priority}">${(t.priority || '').toUpperCase()}</span>
  `;

  row.querySelector('.task-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleComplete(t);
  });
  row.addEventListener('click', (e) => {
    if (e.target.classList.contains('task-check')) return;
    openTaskDrawer(t);
  });
  return row;
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { day: '2-digit', month: 'short' });
}

async function toggleComplete(t) {
  await updateDoc(doc(db, 'users', uid, 'tasks', t.id), { completed: !t.completed });
}

// ---------- Drawer ----------
function openTaskDrawer(t = null) {
  editingTaskId = t ? t.id : null;
  document.getElementById('taskDrawerTitle').textContent = t ? 'Editar pendiente' : 'Nuevo pendiente';
  document.getElementById('deleteTaskBtn').classList.toggle('hidden', !t);

  document.getElementById('taskTitle').value = t?.title || '';
  document.getElementById('taskCategory').value = t?.category || 'admin';
  document.getElementById('taskPriority').value = t?.priority || 'media';
  document.getElementById('taskDate').value = t?.dueDate || '';

  document.getElementById('taskOverlay').classList.add('open');
}
function closeTaskDrawer() { document.getElementById('taskOverlay').classList.remove('open'); }

async function handleTaskSubmit(e) {
  e.preventDefault();
  const data = {
    title: document.getElementById('taskTitle').value.trim(),
    category: document.getElementById('taskCategory').value,
    priority: document.getElementById('taskPriority').value,
    dueDate: document.getElementById('taskDate').value || null,
    completed: false,
  };
  if (!data.title) return;

  if (editingTaskId) {
    const { completed, ...rest } = data; // no pisar el estado "completado" al editar
    await updateDoc(doc(db, 'users', uid, 'tasks', editingTaskId), rest);
  } else {
    await addDoc(collection(db, 'users', uid, 'tasks'), data);
  }
  closeTaskDrawer();
}

async function handleDeleteTask() {
  if (!editingTaskId) return;
  if (!confirm('¿Eliminar este pendiente?')) return;
  await deleteDoc(doc(db, 'users', uid, 'tasks', editingTaskId));
  closeTaskDrawer();
}

// ---------- Utilidades ----------
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('newTaskBtn').addEventListener('click', () => openTaskDrawer());
  document.getElementById('closeTaskBtn').addEventListener('click', closeTaskDrawer);
  document.getElementById('taskOverlay').addEventListener('click', (e) => { if (e.target.id === 'taskOverlay') closeTaskDrawer(); });
  document.getElementById('taskForm').addEventListener('submit', handleTaskSubmit);
  document.getElementById('deleteTaskBtn').addEventListener('click', handleDeleteTask);

  ['filterCategory', 'filterPriority', 'hideCompleted'].forEach((id) => {
    document.getElementById(id).addEventListener('change', renderTasks);
  });

  document.getElementById('privacyBtn').addEventListener('click', () => {}); // sin montos sensibles en este módulo
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
