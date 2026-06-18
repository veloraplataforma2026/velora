/* ============================================================
   VELORA — Stories Module
   24h photo stories (Instagram-style)
   ============================================================ */

import { db } from './firebase-config.js?v=7';
import {
  collection, doc, addDoc, getDocs, updateDoc,
  query, where, orderBy, serverTimestamp, deleteDoc, arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { uploadToCloudinary } from './cloudinary.js?v=7';
import { VeloraState } from './app.js?v=7';
import { showToast } from './ui.js?v=7';

const fsTimeout = (ms = 10000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), ms));

// ─── Add Story ────────────────────────────────────────────
export async function addStory(uid, file) {
  const photoURL = await uploadToCloudinary(file, `velora/stories/${uid}`);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const profile = VeloraState.currentUser?.profile;

  const storyRef = await Promise.race([
    addDoc(collection(db, 'stories'), {
      uid,
      authorName:  profile?.displayName || 'Usuário',
      authorPhoto: profile?.photoURL    || '',
      photoURL,
      expiresAt,
      createdAt:   serverTimestamp(),
      views:       [],
      reactions:   {},
    }),
    fsTimeout(),
  ]);

  showToast('Story publicado! Expira em 24h ✨', 'success');
  return storyRef.id;
}

// ─── Get Active Stories ───────────────────────────────────
export async function getActiveStories() {
  try {
    const now = new Date();
    const snap = await Promise.race([
      getDocs(query(collection(db, 'stories'), orderBy('createdAt', 'desc'))),
      fsTimeout(),
    ]);

    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => {
        const exp = s.expiresAt?.toDate?.() || (s.expiresAt instanceof Date ? s.expiresAt : null);
        return exp && exp > now;
      });
  } catch { return []; }
}

// ─── View Story ───────────────────────────────────────────
export async function viewStory(storyId, viewerUid) {
  try {
    await updateDoc(doc(db, 'stories', storyId), { views: arrayUnion(viewerUid) });
  } catch { /* non-fatal */ }
}

// ─── React to Story ───────────────────────────────────────
export async function reactToStory(storyId, viewerUid, emoji) {
  try {
    await updateDoc(doc(db, 'stories', storyId), { [`reactions.${viewerUid}`]: emoji });
    showToast(`Reação ${emoji} enviada!`, 'success');
  } catch { /* non-fatal */ }
}

// ─── Delete Own Story ─────────────────────────────────────
export async function deleteStory(storyId) {
  await Promise.race([deleteDoc(doc(db, 'stories', storyId)), fsTimeout()]);
  showToast('Story removido.', 'info');
}

// ─── Stories Bar HTML ─────────────────────────────────────
export function renderStoriesBar(stories, currentUid) {
  const myStory = stories.find(s => s.uid === currentUid);
  const others  = stories.filter(s => s.uid !== currentUid);

  const addBtn = `
    <div class="story-bubble story-bubble-add" onclick="window._addStory()" title="Adicionar story">
      <div class="story-bubble-inner story-bubble-add-inner">
        <span style="font-size:1.5rem">+</span>
      </div>
      <div class="story-bubble-name">Seu story</div>
    </div>
  `;

  const myBubble = myStory ? `
    <div class="story-bubble story-bubble-mine" onclick="window._viewStory('${myStory.id}')" title="Ver seu story">
      <div class="story-bubble-ring story-bubble-ring-mine">
        <div class="story-bubble-inner">
          <img src="${myStory.photoURL}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">
        </div>
      </div>
      <div class="story-bubble-name">Você</div>
    </div>
  ` : addBtn;

  const otherBubbles = others.map(s => {
    const seen = (s.views || []).includes(currentUid);
    return `
      <div class="story-bubble ${seen ? 'story-bubble-seen' : ''}" onclick="window._viewStory('${s.id}')" title="${s.authorName}">
        <div class="story-bubble-ring ${seen ? '' : 'story-bubble-ring-active'}">
          <div class="story-bubble-inner">
            <img src="${s.authorPhoto || ''}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;background:var(--bg-surface)"
              onerror="this.style.display='none';this.parentElement.innerHTML='<span style=font-size:1.4rem>👤</span>'">
          </div>
        </div>
        <div class="story-bubble-name">${(s.authorName || 'Usuário').split(' ')[0]}</div>
      </div>
    `;
  }).join('');

  return `
    <div class="stories-bar" id="stories-bar">
      ${myBubble}
      ${otherBubbles}
    </div>
  `;
}

// ─── Story Viewer Modal ───────────────────────────────────
export function renderStoryViewer(story, currentUid) {
  const reactions = ['❤️', '😍', '🔥', '👏', '😂', '😮'];
  const viewCount = (story.views || []).length;

  return `
    <div style="width:100%;max-width:400px;background:#000;border-radius:var(--radius-xl);overflow:hidden;position:relative">
      <div style="position:absolute;top:0;left:0;right:0;z-index:10;padding:12px 16px;display:flex;align-items:center;gap:10px;background:linear-gradient(to bottom,rgba(0,0,0,0.7),transparent)">
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;flex-shrink:0;border:2px solid var(--primary)">
          <img src="${story.authorPhoto}" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div style="flex:1">
          <div style="font-family:var(--font-display);font-weight:700;font-size:0.9rem;color:#fff">${story.authorName}</div>
          <div style="font-size:0.72rem;color:rgba(255,255,255,0.6)">${viewCount} visualizaç${viewCount !== 1 ? 'ões' : 'ão'}</div>
        </div>
        <button onclick="document.querySelector('.modal-overlay')?.remove()"
          style="width:32px;height:32px;border-radius:50%;background:rgba(0,0,0,0.5);border:none;cursor:pointer;color:#fff;font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>

      <div style="height:72vh;max-height:600px;position:relative;background:#111">
        <img src="${story.photoURL}" style="width:100%;height:100%;object-fit:cover">
        <div style="position:absolute;bottom:0;left:0;right:0;padding:60px 16px 16px;background:linear-gradient(transparent,rgba(0,0,0,0.8))">
          <div style="display:flex;justify-content:center;gap:10px;margin-bottom:8px">
            ${reactions.map(r => `
              <button onclick="window._reactStory('${story.id}','${r}')"
                style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,0.12);border:none;cursor:pointer;font-size:1.3rem;display:flex;align-items:center;justify-content:center;transition:transform 0.15s"
                onmouseenter="this.style.transform='scale(1.2)'" onmouseleave="this.style.transform='scale(1)'">${r}</button>
            `).join('')}
          </div>
          ${story.uid === currentUid ? `
            <button onclick="window._deleteStory('${story.id}')" class="btn btn-ghost btn-w-full" style="color:var(--danger);font-size:0.85rem;margin-top:8px">
              🗑️ Excluir story
            </button>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}
