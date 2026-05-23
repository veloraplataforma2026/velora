/* ============================================================
   VELORA — Firebase Configuration
   Project: velora-social-b1cf3
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCGHzyt9bi9toVrv-8qihqQE9MLjMLJ6Ng",
  authDomain:        "velora-social-b1cf3.firebaseapp.com",
  projectId:         "velora-social-b1cf3",
  storageBucket:     "velora-social-b1cf3.firebasestorage.app",
  messagingSenderId: "792467404292",
  appId:             "1:792467404292:web:2262346b9a06083efde751",
  measurementId:     "G-VR32HH4BXW",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

export default app;
