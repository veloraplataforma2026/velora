/* ============================================================
   VELORA — Gallery Module
   Firebase Storage uploads, locked/public photos,
   SPARKS unlock system
   ============================================================ */

import { db, storage } from './firebase-config.js';
import {
  ref, uploadBytesResumable, getDownloadURL, deleteObject,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import {
  doc, collection, addDoc, getDocs, deleteDoc,
  updateDoc, setDoc, getDoc, serverTimestamp, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { VeloraState } from './app.js';
import { showToast } from './ui.js';
import { t } from './i18n.js';
import { deductSparks, hasSparks } from './currency.js';

const LOCKED_PHOTO_COST = 5;

// ─── Upload Photo ─────────────────────────────────────────
export async function uploadPhoto(uid, file, isLocked = false, onProgress = null) {
  const ext       = file.name.split('.').pop().toLowerCase();
  const filename  = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const storageRef = ref(storage, `users/${uid}/photos/${filename}`);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, file);

    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress?.(progress);
      },
      (error) => {
        showToast('Erro ao enviar foto: ' + error.message, 'error');
        reject(error);
      },
      async () => {
        const url = await getDownloadURL(uploadTask.snapshot.ref);
        // Save metadata to Firestore
        const photoRef = await addDoc(
          collection(db, 'gallery', uid, 'photos'),
          {
            url,
            storagePath: `users/${uid}/photos/${filename}`,
            isLocked,
            unlockCost:  isLocked ? LOCKED_PHOTO_COST : 0,
            unlockedBy:  [],
            createdAt:   serverTimestamp(),
            uid,
          }
        );
        resolve({ id: photoRef.id, url, isLocked });
      }
    );
  });
}

// ─── Get User Gallery ─────────────────────────────────────
export async function getUserGallery(uid) {
  const photosRef = collection(db, 'gallery', uid, 'photos');
  const q = query(photosRef, orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ─── Toggle Photo Lock ────────────────────────────────────
export async function togglePhotoLock(uid, photoId, isLocked) {
  const photoRef = doc(db, 'gallery', uid, 'photos', photoId);
  await updateDoc(photoRef, { isLocked });
  showToast(isLocked ? 'Foto bloqueada 🔒' : 'Foto tornada pública 🌐', 'info');
}

// ─── Unlock Photo with SPARKS ─────────────────────────────
export async function unlockPhoto(viewerUid, ownerUid, photoId) {
  const photoRef = doc(db, 'gallery', ownerUid, 'photos', photoId);
  const photoSnap = await getDoc(photoRef);
  if (!photoSnap.exists()) return false;

  const photo = photoSnap.data();

  // Already unlocked?
  if (photo.unlockedBy?.includes(viewerUid)) return true;

  // Check balance
  const cost = photo.unlockCost || LOCKED_PHOTO_COST;
  const enough = await hasSparks(viewerUid, cost);
  if (!enough) {
    showToast(t('noSparks'), 'error');
    return false;
  }

  // Deduct sparks
  await deductSparks(viewerUid, cost, `Desbloqueio de foto de ${ownerUid}`);

  // Mark as unlocked for this user
  await updateDoc(photoRef, {
    unlockedBy: [...(photo.unlockedBy || []), viewerUid],
  });

  showToast(t('photoUnlocked'), 'gold');
  return true;
}

// ─── Delete Photo ─────────────────────────────────────────
export async function deletePhoto(uid, photoId, storagePath) {
  // Delete from Storage
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef).catch(() => {});

  // Delete from Firestore
  await deleteDoc(doc(db, 'gallery', uid, 'photos', photoId));
  showToast('Foto excluída', 'info');
}

// ─── Render Gallery ───────────────────────────────────────
export function renderGalleryGrid(photos, viewerUid, ownerUid, onPhotoClick) {
  if (!photos.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">📷</div>
        <p class="empty-state-title">Galeria vazia</p>
        <p class="empty-state-desc">Adicione suas primeiras fotos!</p>
      </div>
    `;
  }

  return `
    <div class="gallery-grid">
      ${photos.map(photo => {
        const isOwner   = viewerUid === ownerUid;
        const unlocked  = isOwner || !photo.isLocked || photo.unlockedBy?.includes(viewerUid);
        return `
          <div class="gallery-item" data-photo-id="${photo.id}" onclick="window._galleryPhotoClick('${photo.id}')">
            <img
              src="${unlocked ? photo.url : photo.url}"
              alt="Photo"
              style="${!unlocked ? 'filter:blur(20px) brightness(0.5);' : ''}"
              loading="lazy"
            >
            ${!unlocked ? `
              <div class="gallery-lock">
                <div class="gallery-lock-icon">🔒</div>
                <div class="gallery-lock-price">✨ ${photo.unlockCost || LOCKED_PHOTO_COST}</div>
              </div>
            ` : ''}
            ${isOwner ? `
              <div style="position:absolute;top:6px;right:6px;">
                <div class="badge ${photo.isLocked ? 'badge-gold' : 'badge-primary'}" style="font-size:0.65rem;">
                  ${photo.isLocked ? '🔒' : '🌐'}
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}
