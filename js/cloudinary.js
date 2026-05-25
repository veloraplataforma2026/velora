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
  uploadPreset: 'velora_upload',
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
    xhr.timeout = 60000; // 60s hard limit

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      // Entire handler wrapped in try/catch — JSON.parse inside an async callback
      // does NOT propagate to the Promise constructor if it throws, causing the
      // promise to hang forever. This wrapper ensures reject() is always called.
      try {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          resolve(data.secure_url);
        } else {
          let msg = `Erro ${xhr.status}`;
          try {
            const errData = JSON.parse(xhr.responseText);
            msg = errData.error?.message || msg;
          } catch {
            msg = `Cloudinary retornou status ${xhr.status}. Verifique o upload preset.`;
          }
          reject(new Error(msg));
        }
      } catch (e) {
        reject(new Error('Resposta inválida do Cloudinary: ' + (e.message || 'erro desconhecido')));
      }
    });

    xhr.addEventListener('error',   () => reject(new Error('Erro de rede ao enviar para Cloudinary')));
    xhr.addEventListener('timeout', () => reject(new Error('Timeout ao enviar para Cloudinary (60s)')));
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
