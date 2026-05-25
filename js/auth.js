/* ============================================================
   VELORA — Auth Module
   Firebase Authentication: Login, Register, Google OAuth,
   Logout, and route protection
   ============================================================ */

import { auth, db } from './firebase-config.js?v=7';
import { uploadProfilePhoto, isCloudinaryConfigured } from './cloudinary.js?v=7';
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
import { t } from './i18n.js?v=7';
import { VeloraState } from './app.js?v=7';

const googleProvider = new GoogleAuthProvider();

// ─── Auth State Observer ─────────────────────────────────
export function initAuthObserver(onLoggedIn, onLoggedOut) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Navigate immediately — don't block on Firestore profile fetch
      onLoggedIn(user, null);
      // Load profile in background and notify when ready
      try {
        const profile = await getUserProfile(user.uid);
        if (VeloraState.currentUser?.uid === user.uid) {
          VeloraState.currentUser = { ...VeloraState.currentUser, profile };
          document.dispatchEvent(new CustomEvent('velora:profileLoaded'));
        }
      } catch (err) {
        console.warn('[VELORA] Profile fetch failed (offline?):', err.message);
      }
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
    sparks:        50,
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
  const timeout = new Promise((_, r) => setTimeout(() => r(new Error('Timeout ao criar perfil.')), 12000));
  await Promise.race([setDoc(ref, profile), timeout]);
  return profile;
}

// ─── Update User Profile ──────────────────────────────────
export async function updateUserProfile(uid, data) {
  const ref = doc(db, 'users', uid);
  const timeout = new Promise((_, r) => setTimeout(() => r(new Error('Tempo limite esgotado. Verifique sua conexão.')), 10000));
  await Promise.race([
    setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }),
    timeout,
  ]);
}

// ─── Email/Password Login ─────────────────────────────────
export async function loginWithEmail(email, password) {
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej({ code: 'auth/timeout' }), 12000)
    );
    const cred = await Promise.race([
      signInWithEmailAndPassword(auth, email, password),
      timeout,
    ]);
    return { success: true, user: cred.user };
  } catch (err) {
    console.error('[VELORA] Login error:', err.code, err.message);
    return { success: false, error: getAuthError(err.code) };
  }
}

// ─── Email/Password Register ──────────────────────────────
export async function registerWithEmail(email, password, profileData, photoFile = null) {
  let cred;
  try {
    cred = await createUserWithEmailAndPassword(auth, email, password);
  } catch (err) {
    console.error('[VELORA] Auth register error:', err.code, err.message);
    return { success: false, error: getAuthError(err.code) };
  }

  const uid = cred.user.uid;

  let photoURL = profileData.photoURL;
  if (photoFile && isCloudinaryConfigured()) {
    try {
      photoURL = await uploadProfilePhoto(uid, photoFile);
    } catch { /* keep base64 preview */ }
  }

  try {
    await createUserProfile(uid, { ...profileData, photoURL, email: cred.user.email });
  } catch (firestoreErr) {
    console.warn('[VELORA] Profile creation failed (non-fatal):', firestoreErr.code, firestoreErr.message);
    // Auth succeeded — user exists, profile can be created on next login
  }

  return { success: true, user: cred.user };
}

// ─── Google OAuth ─────────────────────────────────────────
export async function loginWithGoogle() {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    let profile = null;
    try {
      profile = await getUserProfile(cred.user.uid);
      if (!profile) {
        await createUserProfile(cred.user.uid, {
          displayName: cred.user.displayName,
          email:       cred.user.email,
          photoURL:    cred.user.photoURL,
        });
      }
    } catch (firestoreErr) {
      console.warn('[VELORA] Firestore unavailable on Google login:', firestoreErr.message);
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
    'auth/email-already-in-use':    'Este e-mail já está em uso.',
    'auth/invalid-email':            t('errorEmail'),
    'auth/weak-password':            t('errorPassword'),
    'auth/user-not-found':           'Usuário não encontrado.',
    'auth/wrong-password':           'Senha incorreta.',
    'auth/invalid-credential':       'E-mail ou senha incorretos.',
    'auth/too-many-requests':        'Muitas tentativas. Tente mais tarde.',
    'auth/network-request-failed':   'Erro de conexão. Verifique sua internet.',
    'auth/popup-closed-by-user':     'Login cancelado.',
    'auth/operation-not-allowed':    'Cadastro por e-mail não habilitado. Verifique as configurações do Firebase.',
    'auth/configuration-not-found':  'Firebase não configurado corretamente.',
    'auth/timeout':                  'Tempo limite esgotado. Verifique sua conexão e tente novamente.',
  };
  return errors[code] || `Erro (${code || 'desconhecido'}). Tente novamente.`;
}
