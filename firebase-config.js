// ============================================
// Conexión a Firebase
// Usamos el SDK vía CDN (módulos ES) para que
// funcione directo en GitHub Pages sin necesidad
// de un paso de build/npm.
// ============================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDwJ_1qEuUYTCGLvjHMO19WutMySZw2Apo",
  authDomain: "finanzas-personales-bacf2.firebaseapp.com",
  projectId: "finanzas-personales-bacf2",
  storageBucket: "finanzas-personales-bacf2.firebasestorage.app",
  messagingSenderId: "524269033590",
  appId: "1:524269033590:web:4e43a01001044ace7a6757",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
