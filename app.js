// ============================================
// MÓDULO 0 — Login (conectado a Firebase Auth)
// ============================================

import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');

// Si ya hay una sesión activa (ej. recargaste la página), salta directo.
onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = 'transacciones.html';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('Completa correo y contraseña.');
    return;
  }

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.href = 'transacciones.html';
  } catch (err) {
    showError(mapAuthError(err.code));
  }
});

document.getElementById('forgotBtn').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  if (!email) {
    showError('Escribe tu correo arriba y vuelve a intentar.');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showError('Te enviamos un correo para restablecer tu contraseña.');
    errorBox.style.color = 'var(--sage)';
    errorBox.style.borderLeftColor = 'var(--sage)';
  } catch {
    showError('No pudimos enviar el correo. Verifica que esté bien escrito.');
  }
});

function showError(message) {
  errorBox.style.color = '';
  errorBox.style.borderLeftColor = '';
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}

function mapAuthError(code) {
  const map = {
    'auth/invalid-credential': 'Correo o contraseña incorrectos.',
    'auth/invalid-email': 'El correo no es válido.',
    'auth/too-many-requests': 'Demasiados intentos. Espera un momento e intenta de nuevo.',
    'auth/user-disabled': 'Esta cuenta está deshabilitada.',
  };
  return map[code] || 'No pudimos iniciar sesión. Intenta de nuevo.';
}
