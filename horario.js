// ============================================
// MÓDULO 10 — Horario Personal (Time Blocking)
// La grilla es semanal recurrente (por día de la
// semana, no por fecha exacta) — se repite cada semana.
// ============================================

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i); // 6..22
const DAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

let uid = null;
let blocks = [];
let tasks = [];
let editingBlockId = null;

onAuthStateChanged(auth, (user) => {
  if (!user) { window.location.href = 'index.html'; return; }
  uid = user.uid;
  buildGridSkeleton();
  listenBlocks();
  listenTasks();
  attachEventListeners();
});

function buildGridSkeleton() {
  const grid = document.getElementById('scheduleGrid');
  grid.innerHTML = '';

  grid.appendChild(makeCell('div', 'grid-header', ''));
  DAYS.forEach((d) => grid.appendChild(makeCell('div', 'grid-header', d)));

  HOURS.forEach((h) => {
    grid.appendChild(makeCell('div', 'hour-label', `${h}:00`));
    DAYS.forEach((_, dayIndex) => {
      const cell = makeCell('div', 'grid-cell', '');
      cell.dataset.day = dayIndex;
      cell.dataset.hour = h;
      cell.addEventListener('click', () => openBlockDrawer(null, dayIndex, h));
      grid.appendChild(cell);
    });
  });
}
function makeCell(tag, cls, text) {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
}

function listenBlocks() {
  onSnapshot(collection(db, 'users', uid, 'scheduleBlocks'), (snap) => {
    blocks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderBlocks();
  });
}
function listenTasks() {
  onSnapshot(collection(db, 'users', uid, 'tasks'), (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAgenda();
  });
}

function renderBlocks() {
  document.querySelectorAll('.schedule-block').forEach((el) => el.remove());
  const grid = document.getElementById('scheduleGrid');

  blocks.forEach((b) => {
    const el = document.createElement('div');
    el.className = `schedule-block ${b.category}`;
    el.textContent = b.title;
    el.style.gridColumn = `${b.day + 2}`;
    el.style.gridRow = `${(b.startHour - 6) + 2} / ${(b.endHour - 6) + 2}`;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openBlockDrawer(b);
    });
    grid.appendChild(el);
  });
}

function renderAgenda() {
  const today = new Date();
  const in7days = new Date();
  in7days.setDate(today.getDate() + 7);
  const todayStr = today.toISOString().slice(0, 10);
  const limitStr = in7days.toISOString().slice(0, 10);

  const upcoming = tasks
    .filter((t) => !t.completed && t.dueDate && t.dueDate >= todayStr && t.dueDate <= limitStr)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));

  const container = document.getElementById('agendaList');
  container.innerHTML = '';

  if (upcoming.length === 0) {
    container.innerHTML = '<div class="widget-empty">Sin pendientes con fecha esta semana.</div>';
    return;
  }

  upcoming.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'agenda-row';
    row.innerHTML = `
      <div class="agenda-title">${escapeHtml(t.title)}</div>
      <div class="agenda-date">${formatDate(t.dueDate)}</div>
    `;
    container.appendChild(row);
  });
}

function formatDate(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-PE', { weekday: 'short', day: '2-digit', month: 'short' });
}
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ---------- Drawer ----------
function openBlockDrawer(block = null, prefillDay = 0, prefillHour = 8) {
  editingBlockId = block ? block.id : null;
  document.getElementById('blockDrawerTitle').textContent = block ? 'Editar bloque' : 'Nuevo bloque';
  document.getElementById('deleteBlockBtn').classList.toggle('hidden', !block);

  document.getElementById('blockTitle').value = block?.title || '';
  document.getElementById('blockCategory').value = block?.category || 'trabajo';
  document.getElementById('blockDay').value = block ? block.day : prefillDay;
  document.getElementById('blockStart').value = block?.startHour ?? prefillHour;
  document.getElementById('blockEnd').value = block?.endHour ?? (prefillHour + 1);

  document.getElementById('blockOverlay').classList.add('open');
}
function closeBlockDrawer() { document.getElementById('blockOverlay').classList.remove('open'); }

async function handleBlockSubmit(e) {
  e.preventDefault();
  const startHour = parseInt(document.getElementById('blockStart').value, 10);
  const endHour = parseInt(document.getElementById('blockEnd').value, 10);
  if (endHour <= startHour) { alert('La hora de fin debe ser después de la hora de inicio.'); return; }

  const data = {
    title: document.getElementById('blockTitle').value.trim(),
    category: document.getElementById('blockCategory').value,
    day: parseInt(document.getElementById('blockDay').value, 10),
    startHour,
    endHour,
  };

  if (editingBlockId) {
    await updateDoc(doc(db, 'users', uid, 'scheduleBlocks', editingBlockId), data);
  } else {
    await addDoc(collection(db, 'users', uid, 'scheduleBlocks'), data);
  }
  closeBlockDrawer();
}

async function handleDeleteBlock() {
  if (!editingBlockId) return;
  await deleteDoc(doc(db, 'users', uid, 'scheduleBlocks', editingBlockId));
  closeBlockDrawer();
}

// ---------- Listeners ----------
function attachEventListeners() {
  document.getElementById('closeBlockBtn').addEventListener('click', closeBlockDrawer);
  document.getElementById('blockOverlay').addEventListener('click', (e) => { if (e.target.id === 'blockOverlay') closeBlockDrawer(); });
  document.getElementById('blockForm').addEventListener('submit', handleBlockSubmit);
  document.getElementById('deleteBlockBtn').addEventListener('click', handleDeleteBlock);

  document.getElementById('privacyBtn').addEventListener('click', () => {});
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut(auth);
    window.location.href = 'index.html';
  });
}
