/* ============================================================
   VELORA — Profile Module
   View/edit profile, update Firestore, photo management
   ============================================================ */

import { db, storage } from './firebase-config.js?v=7';
import {
  doc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  ref, uploadBytesResumable, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { VeloraState } from './app.js?v=7';
import { showToast } from './ui.js?v=7';
import { t } from './i18n.js?v=7';

// ─── Update Profile ───────────────────────────────────────
export async function saveProfile(uid, data) {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, {
    ...data,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  // Update local state
  if (VeloraState.currentUser) {
    VeloraState.currentUser.profile = {
      ...VeloraState.currentUser.profile,
      ...data,
    };
  }
  showToast(t('profileSaved'), 'success');
}

// ─── Upload Profile Photo ─────────────────────────────────
export async function uploadProfilePhoto(uid, file, onProgress) {
  const ext      = file.name.split('.').pop().toLowerCase();
  const filename = `profile_${Date.now()}.${ext}`;
  const storageRef = ref(storage, `users/${uid}/photos/${filename}`);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file);
    task.on('state_changed',
      (snap) => {
        const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
        onProgress?.(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        // Update user document
        await saveProfile(uid, { photoURL: url });
        resolve(url);
      }
    );
  });
}

// ─── Add XP ──────────────────────────────────────────────
export async function addXP(uid, amount) {
  const profile = VeloraState.currentUser?.profile;
  if (!profile) return;
  const newXP    = (profile.xp || 0) + amount;
  const newLevel = Math.floor(newXP / 100) + 1;
  const levelUp  = newLevel > (profile.level || 1);

  await saveProfile(uid, { xp: newXP, level: newLevel });

  if (levelUp) {
    showToast(`🎉 Subiu para Nível ${newLevel}!`, 'gold');
  }
}

// ─── Update Last Seen ─────────────────────────────────────
export async function updateLastSeen(uid) {
  const userRef = doc(db, 'users', uid);
  await setDoc(userRef, { lastSeen: serverTimestamp() }, { merge: true });
}
