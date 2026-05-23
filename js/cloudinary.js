/* ============================================================
   VELORA — Cloudinary Upload Module
   Upload gratuito sem backend, usando unsigned preset.

   CONFIGURAÇÃO:
   1. Crie conta grátis em cloudinary.com
   2. No Dashboard copie o "Cloud Name"
   3. Vá em Settings → Upload → Add upload preset
      → Signing Mode: Unsigned → nome: velora_unsigned
   4. Substitua YOUR_CLOUD_NAME abaixo
   ============================================================ */

export const CLOUDINARY_CONFIG = {
  cloudName:    'di27wnki0',
  uploadPreset: 'velora_unsigned',
};

export function isCloudinaryConfigured() {
  return CLOUDINARY_CONFIG.cloudName !== 'YOUR_CLOUD_NAME';
}

// ─── Upload de imagem para Cloudinary ────────────────────
export function uploadToCloudinary(file, folder = 'velora/photos', onProgress = null) {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
    formData.append('folder', folder);

    const xhr = new XMLHttpRequest();
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;
    xhr.open('POST', url);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        resolve(data.secure_url);
      } else {
        const err = JSON.parse(xhr.responseText || '{}');
        reject(new Error(err.error?.message || 'Upload falhou'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Erro de rede ao fazer upload')));
    xhr.send(formData);
  });
}

// ─── Upload de foto de perfil ─────────────────────────────
export async function uploadProfilePhoto(uid, file, onProgress = null) {
  return uploadToCloudinary(file, `velora/profiles/${uid}`, onProgress);
}

// ─── Upload de foto da galeria ────────────────────────────
export async function uploadGalleryPhoto(uid, file, onProgress = null) {
  return uploadToCloudinary(file, `velora/gallery/${uid}`, onProgress);
}
