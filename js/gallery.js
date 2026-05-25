/* ============================================================
   VELORA — Gallery Module
   Cloudinary upload + Firestore metadata
   Sistema de fotos bloqueadas por SPARKS
   ============================================================ */

import { db } from './firebase-config.js?v=7';
import {
  doc, collection, addDoc, getDocs, deleteDoc,
  updateDoc, getDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './ui.js?v=7';
import { t } from './i18n.js?v=7';
import { deductSparks, hasSparks } from './currency.js?v=7';
import { uploadGalleryPhoto, isCloudinaryConfigured } from './cloudinary.js?v=7';

const LOCKED_PHOTO_COST = 5;

// ─── Upload Photo ─────────────────────────────────────────
export async function uploadPhoto(uid, file, isLocked = false, onProgress = null) {
  if (!isCloudinaryConfigured()) {
    showToast('Configure o Cloudinary em js/cloudinary.js primeiro!', 'error');
    throw new Error('Cloudinary não configurado');
  }

  const url = await uploadGalleryPhoto(uid, file, onProgress);

  const saveTimeout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error('Tempo limite ao salvar foto. Verifique sua conexão.')), 12000)
  );
  const photoRef = await Promise.race([
    addDoc(
      collection(db, 'gallery', uid, 'photos'),
      {
        url,
        isLocked,
        unlockCost: isLocked ? LOCKED_PHOTO_COST : 0,
        unlockedBy: [],
        createdAt:  serverTimestamp(),
        uid,
      }
    ),
    saveTimeout,
  ]);

  return { id: photoRef.id, url, isLocked };
}

// ─── Get User Gallery ─────────────────────────────────────
export async function getUserGallery(uid) {
  const photosRef = collection(db, 'gallery', uid, 'photos');
  const snap = await getDocs(photosRef);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

const galTimeout = (ms = 10000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout na operação.')), ms));

// ─── Toggle Photo Lock ────────────────────────────────────
export async function togglePhotoLock(uid, photoId, isLocked) {
  await Promise.race([updateDoc(doc(db, 'gallery', uid, 'photos', photoId), { isLocked }), galTimeout()]);
  showToast(isLocked ? 'Foto bloqueada 🔒' : 'Foto tornada pública 🌐', 'info');
}

// ─── Unlock Photo with SPARKS ─────────────────────────────
export async function unlockPhoto(viewerUid, ownerUid, photoId) {
  const photoRef  = doc(db, 'gallery', ownerUid, 'photos', photoId);
  const photoSnap = await Promise.race([getDoc(photoRef), galTimeout()]);
  if (!photoSnap.exists()) return false;

  const photo = photoSnap.data();
  if (photo.unlockedBy?.includes(viewerUid)) return true;

  const cost   = photo.unlockCost || LOCKED_PHOTO_COST;
  const enough = await hasSparks(viewerUid, cost);
  if (!enough) { showToast(t('noSparks'), 'error'); return false; }

  await deductSparks(viewerUid, cost, `Desbloqueio de foto de ${ownerUid}`);
  await Promise.race([
    updateDoc(photoRef, { unlockedBy: [...(photo.unlockedBy || []), viewerUid] }),
    galTimeout(),
  ]);
  showToast(t('photoUnlocked'), 'gold');
  return true;
}

// ─── Delete Photo ─────────────────────────────────────────
export async function deletePhoto(uid, photoId) {
  await Promise.race([deleteDoc(doc(db, 'gallery', uid, 'photos', photoId)), galTimeout()]);
  showToast('Foto excluída', 'info');
}

// ─── Render Gallery ───────────────────────────────────────
export function renderGalleryGrid(photos, viewerUid, ownerUid) {
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
        const isOwner  = viewerUid === ownerUid;
        const unlocked = isOwner || !photo.isLocked || photo.unlockedBy?.includes(viewerUid);
        return `
          <div class="gallery-item" data-photo-id="${photo.id}" onclick="window._galleryPhotoClick('${photo.id}')">
            <img
              src="${photo.url}"
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
