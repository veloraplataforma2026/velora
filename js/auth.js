/* ============================================================
   VELORA — Auth Module
   Firebase Authentication: Login, Register, Google OAuth,
   Logout, and route protection
   ============================================================ */

import { auth, db } from './firebase-config.js';
import { uploadProfilePhoto, isCloudinaryConfigured } from './cloudinary.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { t } from './i18n.js';
import { showToast, showPage } from './ui.js';
import { VeloraState } from './app.js';

const googleProvider = new GoogleAuthProvider();

// ─── Auth State Observer ─────────────────────────────────
export function initAuthObserver(onLoggedIn, onLoggedOut) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      const profile = await getUserProfile(user.uid);
      VeloraState.currentUser = { ...user, profile };
      onLoggedIn(user, profile);
    } else {
      VeloraState.currentUser = null;
      onLoggedOut();
    }
  });
}

// ─── Get User Profile ─────────────────────────────────────
export async function getUserProfile(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// ─── Create User Profile in Firestore ────────────────────
export async function createUserProfile(uid, data) {
  const ref = doc(db, 'users', uid);
  const profile = {
    uid,
    displayName:   data.displayName || '',
    email:         data.email || '',
    photoURL:      data.photoURL || '',
    bio:           data.bio || '',
    age:           data.age || null,
    gender:        data.gender || '',
    lookingFor:    data.lookingFor || ['dating'],
    interests:     data.interests || [],
    isAdult:       data.isAdult || false,
    sparks:        50, // Welcome bonus
    level:         1,
    xp:            0,
    streak:        0,
    lastSeen:      serverTimestamp(),
    createdAt:     serverTimestamp(),
    verified:      false,
    location:      null,
    photos:        [],
    veloraScore:   Math.floor(Math.random() * 30) + 60,
  };
  await setDoc(ref, profile);
  return profile;
}

// ─── Update User Profile ──────────────────────────────────
export async function updateUserProfile(uid, data) {
  const ref = doc(db, 'users', uid);
  await setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true });
}

// ─── Email/Password Login ─────────────────────────────────
export async function loginWithEmail(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    return { success: true, user: cred.user };
  } catch (err) {
    return { success: false, error: getAuthError(err.code) };
  }
}

// ─── Email/Password Register ──────────────────────────────
export async function registerWithEmail(email, password, profileData, photoFile = null) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid  = cred.user.uid;

    let photoURL = profileData.photoURL;
    if (photoFile && isCloudinaryConfigured()) {
      try {
        photoURL = await uploadProfilePhoto(uid, photoFile);
      } catch {
        // keep the base64 preview if upload fails
      }
    }

    await createUserProfile(uid, { ...profileData, photoURL, email: cred.user.email });
    return { success: true, user: cred.user };
  } catch (err) {
    return { success: false, error: getAuthError(err.code) };
  }
}

// ─── Google OAuth ─────────────────────────────────────────
export async function loginWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const profile = await getUserProfile(cred.user.uid);
    if (!profile) {
      await createUserProfile(cred.user.uid, {
        displayName: cred.user.displayName,
        email:       cred.user.email,
        photoURL:    cred.user.photoURL,
      });
    }
    return { success: true, user: cred.user, isNew: !profile };
  } catch (err) {
    return { success: false, error: getAuthError(err.code) };
  }
}

// ─── Sign Out ─────────────────────────────────────────────
export async function logoutUser() {
  await signOut(auth);
}

// ─── Password Reset ───────────────────────────────────────
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return { success: true };
  } catch (err) {
    return { success: false, error: getAuthError(err.code) };
  }
}

// ─── Error Messages ───────────────────────────────────────
function getAuthError(code) {
  const errors = {
    'auth/email-already-in-use':   'Este e-mail já está em uso.',
    'auth/invalid-email':           t('errorEmail'),
    'auth/weak-password':           t('errorPassword'),
    'auth/user-not-found':          'Usuário não encontrado.',
    'auth/wrong-password':          'Senha incorreta.',
    'auth/too-many-requests':       'Muitas tentativas. Tente mais tarde.',
    'auth/network-request-failed':  'Erro de conexão. Verifique sua internet.',
    'auth/popup-closed-by-user':    'Login cancelado.',
  };
  return errors[code] || t('errorGeneric');
}
