/* ============================================================
   VELORA — Swipe & Match System
   Touch/mouse drag cards, like/pass/super-like,
   Firebase match creation, real-time match listener,
   unmatch functionality
   ============================================================ */

import { db } from './firebase-config.js';
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, where, onSnapshot, deleteDoc,
  serverTimestamp, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { VeloraState } from './app.js';
import { showMatchPopup, showToast, defaultAvatar } from './ui.js';
import { t } from './i18n.js';

// ─── Swipe Card Engine ────────────────────────────────────
export class SwipeEngine {
  constructor(container, onSwipe) {
    this.container = container;
    this.onSwipe   = onSwipe;
    this.card      = null;
    this.startX    = 0;
    this.startY    = 0;
    this.currentX  = 0;
    this.currentY  = 0;
    this.isDragging = false;
    this.THRESHOLD  = 80;
  }

  attach(cardEl) {
    this.card = cardEl;
    this.card.addEventListener('mousedown',  this.onStart.bind(this));
    this.card.addEventListener('touchstart', this.onStart.bind(this), { passive: true });
    document.addEventListener('mousemove',   this.onMove.bind(this));
    document.addEventListener('touchmove',   this.onMove.bind(this), { passive: false });
    document.addEventListener('mouseup',     this.onEnd.bind(this));
    document.addEventListener('touchend',    this.onEnd.bind(this));
  }

  detach() {
    document.removeEventListener('mousemove', this.onMove.bind(this));
    document.removeEventListener('touchmove', this.onMove.bind(this));
    document.removeEventListener('mouseup',   this.onEnd.bind(this));
    document.removeEventListener('touchend',  this.onEnd.bind(this));
  }

  getCoords(e) {
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX, y: src.clientY };
  }

  onStart(e) {
    const { x, y } = this.getCoords(e);
    this.startX     = x;
    this.startY     = y;
    this.isDragging = true;
    this.card.style.transition = 'none';
  }

  onMove(e) {
    if (!this.isDragging || !this.card) return;
    if (e.cancelable) e.preventDefault();
    const { x, y } = this.getCoords(e);
    this.currentX = x - this.startX;
    this.currentY = y - this.startY;
    const rotate = this.currentX * 0.12;

    this.card.style.transform = `translateX(${this.currentX}px) translateY(${this.currentY}px) rotate(${rotate}deg)`;

    // Show overlays
    const likeEl  = this.card.querySelector('.swipe-like-overlay');
    const passEl  = this.card.querySelector('.swipe-pass-overlay');
    const superEl = this.card.querySelector('.swipe-superlike-overlay');

    const ratio = Math.abs(this.currentX) / this.THRESHOLD;
    if (this.currentX > 20 && likeEl) likeEl.style.opacity = Math.min(ratio, 1);
    else if (likeEl) likeEl.style.opacity = 0;

    if (this.currentX < -20 && passEl) passEl.style.opacity = Math.min(ratio, 1);
    else if (passEl) passEl.style.opacity = 0;

    if (this.currentY < -50 && superEl) superEl.style.opacity = Math.min(Math.abs(this.currentY) / this.THRESHOLD, 1);
    else if (superEl) superEl.style.opacity = 0;
  }

  onEnd() {
    if (!this.isDragging || !this.card) return;
    this.isDragging = false;
    this.card.style.transition = 'transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

    if (this.currentX > this.THRESHOLD) {
      this.flyOut('right');
      this.onSwipe?.('like');
    } else if (this.currentX < -this.THRESHOLD) {
      this.flyOut('left');
      this.onSwipe?.('pass');
    } else if (this.currentY < -this.THRESHOLD) {
      this.flyOut('up');
      this.onSwipe?.('superlike');
    } else {
      // Return to center
      this.card.style.transform = 'translateX(0) translateY(0) rotate(0deg)';
      this.currentX = 0;
      this.currentY = 0;
    }
  }

  flyOut(direction) {
    const tx = direction === 'right' ? '150vw' : direction === 'left' ? '-150vw' : '0';
    const ty = direction === 'up' ? '-150vh' : '0';
    const rot = direction === 'right' ? '30deg' : direction === 'left' ? '-30deg' : '0deg';
    this.card.style.transform = `translateX(${tx}) translateY(${ty}) rotate(${rot})`;
    this.card.style.opacity = '0';
    setTimeout(() => this.card?.remove(), 400);
  }

  // Programmatic swipe
  triggerLike()      { this.flyOut('right'); this.onSwipe?.('like'); }
  triggerPass()      { this.flyOut('left');  this.onSwipe?.('pass'); }
  triggerSuperLike() { this.flyOut('up');    this.onSwipe?.('superlike'); }
}

// ─── Load Potential Matches ───────────────────────────────
export async function loadProfiles(currentUid) {
  // Get profiles user already swiped
  const swipedRef = collection(db, 'swipes', currentUid, 'actions');
  const swipedSnap = await getDocs(swipedRef);
  const swipedIds = new Set(swipedSnap.docs.map(d => d.id));
  swipedIds.add(currentUid); // exclude self

  // Get all users (in production: add geo-query + filters)
  const usersRef = collection(db, 'users');
  const snap = await getDocs(query(usersRef, limit(50)));

  return snap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => !swipedIds.has(u.uid));
}

// ─── Record Swipe & Check Match ───────────────────────────
export async function recordSwipe(currentUid, targetUid, action) {
  // Save swipe
  const swipeRef = doc(db, 'swipes', currentUid, 'actions', targetUid);
  await setDoc(swipeRef, {
    action,
    timestamp: serverTimestamp(),
  });

  if (action === 'pass') return { matched: false };

  // Check if target already liked current user
  const reverseRef = doc(db, 'swipes', targetUid, 'actions', currentUid);
  const reverseSnap = await getDoc(reverseRef);

  if (reverseSnap.exists() && ['like', 'superlike'].includes(reverseSnap.data().action)) {
    // It's a match!
    const matchId = [currentUid, targetUid].sort().join('_');
    const matchRef = doc(db, 'matches', matchId);
    await setDoc(matchRef, {
      user1:     currentUid,
      user2:     targetUid,
      users:     [currentUid, targetUid],
      action1:   action,
      action2:   reverseSnap.data().action,
      createdAt: serverTimestamp(),
      active:    true,
    });

    // Create conversation
    const convRef = doc(db, 'conversations', matchId);
    await setDoc(convRef, {
      participants: [currentUid, targetUid],
      matchId,
      lastMessage:  null,
      lastAt:       serverTimestamp(),
      createdAt:    serverTimestamp(),
    });

    return { matched: true, matchId };
  }

  return { matched: false };
}

// ─── Get My Matches ───────────────────────────────────────
export function subscribeToMatches(uid, callback) {
  const q = query(
    collection(db, 'matches'),
    where('users', 'array-contains', uid),
    where('active', '==', true),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q, (snap) => {
    const matches = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(matches);
  });
}

// ─── Unmatch ──────────────────────────────────────────────
export async function unmatch(matchId) {
  // Soft delete - set active to false
  const matchRef = doc(db, 'matches', matchId);
  await setDoc(matchRef, { active: false, unmatchedAt: serverTimestamp() }, { merge: true });
  showToast('Match desfeito.', 'info');
}

// ─── Mock profiles for demo ───────────────────────────────
export const MOCK_PROFILES = [
  {
    uid:       'mock1',
    displayName: 'Sofia Martins',
    age:        26,
    bio:        'Apaixonada por viagens, café e música ao vivo 🎵✈️',
    photoURL:   'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=400&q=80',
    interests:  ['Música', 'Viagens', 'Café', 'Arte'],
    kmAway:     2,
    veloraScore: 87,
    verified:   true,
    lookingFor: ['dating', 'friendship'],
  },
  {
    uid:       'mock2',
    displayName: 'Isabela Costa',
    age:        24,
    bio:        'Fotógrafa de natureza, yogi nas horas vagas 🌿📸',
    photoURL:   'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=400&q=80',
    interests:  ['Fotografia', 'Yoga', 'Natureza', 'Livros'],
    kmAway:     5,
    veloraScore: 92,
    verified:   true,
    lookingFor: ['dating'],
  },
  {
    uid:       'mock3',
    displayName: 'Valentina Rocha',
    age:        28,
    bio:        'Chef de cuisine, aventureira e colecionadora de histórias 🍳🌎',
    photoURL:   'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=400&q=80',
    interests:  ['Gastronomia', 'Aventura', 'Cinema', 'Dança'],
    kmAway:     8,
    veloraScore: 78,
    verified:   false,
    lookingFor: ['casual', 'friendship'],
  },
  {
    uid:       'mock4',
    displayName: 'Luna Ferreira',
    age:        23,
    bio:        'Estudante de astronomia. Procuro alguém para observar estrelas 🌟',
    photoURL:   'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=400&q=80',
    interests:  ['Astronomia', 'Ciência', 'Gaming', 'Anime'],
    kmAway:     3,
    veloraScore: 95,
    verified:   true,
    lookingFor: ['dating', 'friendship'],
  },
  {
    uid:       'mock5',
    displayName: 'Ana Lima',
    age:        30,
    bio:        'Empresária, mãe de dois gatinhos e apaixonada por surfar 🏄‍♀️🐱',
    photoURL:   'https://images.unsplash.com/photo-1488716820095-cbe80883c496?w=400&q=80',
    interests:  ['Surf', 'Negócios', 'Animais', 'Praia'],
    kmAway:     12,
    veloraScore: 83,
    verified:   true,
    lookingFor: ['dating'],
  },
];
