/* ============================================================
   VELORA — Firebase Configuration
   Project: velora-social
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey:            "AIzaSyCQydyNV0-acBPGOGAPmVgAlh72BLHFeBA",
  authDomain:        "velora-social.firebaseapp.com",
  projectId:         "velora-social",
  storageBucket:     "velora-social.firebasestorage.app",
  messagingSenderId: "399456865430",
  appId:             "1:399456865430:web:bccc3faebeaf93b4d686b7",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);

export default app;
