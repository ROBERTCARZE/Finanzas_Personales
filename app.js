// ============================================
// MÓDULO 0 — Login
// Por ahora sin Firebase conectado (solo UI).
// Cuando integremos Firebase Auth, este archivo
// reemplazará el bloque "TODO" de abajo por
// signInWithEmailAndPassword(auth, email, password).
// ============================================

const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const statusDot = document.getElementById('statusDot');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  errorBox.classList.remove('visible');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showError('Completa correo y contraseña.');
    return;
  }

  // TODO (fase Firebase): reemplazar este bloque por autenticación real.
  console.log('Intento de login (placeholder):', { email });
  showError('Firebase todavía no está conectado — esto es solo el diseño.');
});

document.getElementById('forgotBtn').addEventListener('click', () => {
  // TODO (fase Firebase): sendPasswordResetEmail(auth, email)
  alert('Recuperación de contraseña — pendiente de conectar con Firebase.');
});

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.add('visible');
}
