/* ============================================================
   VELORA — Swipe & Match System
   Touch/mouse drag cards, like/pass/super-like,
   Firebase match creation, real-time match listener,
   unmatch functionality
   ============================================================ */

import { db } from './firebase-config.js?v=7';
import {
  collection, doc, setDoc, getDoc, getDocs,
  query, where, onSnapshot,
  serverTimestamp, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './ui.js?v=7';

// ─── Swipe Card Engine ────────────────────────────────────
export class SwipeEngine {
  constructor(container, onSwipe) {
    this.container  = container;
    this.onSwipe    = onSwipe;
    this.card       = null;
    this.startX     = 0;
    this.startY     = 0;
    this.currentX   = 0;
    this.currentY   = 0;
    this.isDragging = false;
    this.THRESHOLD  = 80;
    // Store bound references so detach() removes the correct listeners
    this._boundStart = this.onStart.bind(this);
    this._boundMove  = this.onMove.bind(this);
    this._boundEnd   = this.onEnd.bind(this);
  }

  attach(cardEl) {
    this.card = cardEl;
    this.card.addEventListener('mousedown',  this._boundStart);
    this.card.addEventListener('touchstart', this._boundStart, { passive: true });
    document.addEventListener('mousemove',   this._boundMove);
    document.addEventListener('touchmove',   this._boundMove, { passive: false });
    document.addEventListener('mouseup',     this._boundEnd);
    document.addEventListener('touchend',    this._boundEnd);
  }

  detach() {
    document.removeEventListener('mousemove', this._boundMove);
    document.removeEventListener('touchmove', this._boundMove);
    document.removeEventListener('mouseup',   this._boundEnd);
    document.removeEventListener('touchend',  this._boundEnd);
    if (this.card) {
      this.card.removeEventListener('mousedown',  this._boundStart);
      this.card.removeEventListener('touchstart', this._boundStart);
    }
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

const swipeTimeout = (ms = 10000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout na operação.')), ms));

// ─── Load Potential Matches ───────────────────────────────
export async function loadProfiles(currentUid) {
  const [swipedSnap, blockedSnap, usersSnap] = await Promise.all([
    Promise.race([getDocs(collection(db, 'swipes', currentUid, 'actions')), swipeTimeout()]),
    Promise.race([getDocs(collection(db, 'blocks', currentUid, 'blocked')), swipeTimeout()]).catch(() => ({ docs: [] })),
    Promise.race([getDocs(query(collection(db, 'users'), limit(50))), swipeTimeout()]),
  ]);

  const swipedIds  = new Set(swipedSnap.docs.map(d => d.id));
  const blockedIds = new Set(blockedSnap.docs.map(d => d.id));
  swipedIds.add(currentUid);

  const now = Date.now();
  const profiles = usersSnap.docs
    .map(d => ({ uid: d.id, ...d.data() }))
    .filter(u => !swipedIds.has(u.uid) && !blockedIds.has(u.uid));

  // Boosted profiles float to the top
  return profiles.sort((a, b) => {
    const aBoost = a.boostedUntil?.toDate?.()?.getTime?.() || a.boostedUntil?.getTime?.() || 0;
    const bBoost = b.boostedUntil?.toDate?.()?.getTime?.() || b.boostedUntil?.getTime?.() || 0;
    const aActive = aBoost > now ? 1 : 0;
    const bActive = bBoost > now ? 1 : 0;
    return bActive - aActive;
  });
}

// ─── Record Swipe & Check Match ───────────────────────────
export async function recordSwipe(currentUid, targetUid, action) {
  const swipeRef = doc(db, 'swipes', currentUid, 'actions', targetUid);
  await Promise.race([setDoc(swipeRef, { action, timestamp: serverTimestamp() }), swipeTimeout()]);

  if (action === 'pass') return { matched: false };

  const reverseRef = doc(db, 'swipes', targetUid, 'actions', currentUid);
  const reverseSnap = await Promise.race([getDoc(reverseRef), swipeTimeout()]);

  if (reverseSnap.exists() && ['like', 'superlike'].includes(reverseSnap.data().action)) {
    const matchId = [currentUid, targetUid].sort().join('_');
    await Promise.race([
      setDoc(doc(db, 'matches', matchId), {
        user1: currentUid, user2: targetUid,
        users: [currentUid, targetUid],
        action1: action, action2: reverseSnap.data().action,
        createdAt: serverTimestamp(), active: true,
      }),
      swipeTimeout(),
    ]);
    await Promise.race([
      setDoc(doc(db, 'conversations', matchId), {
        participants: [currentUid, targetUid],
        matchId, lastMessage: null,
        lastAt: serverTimestamp(), createdAt: serverTimestamp(),
      }),
      swipeTimeout(),
    ]);
    return { matched: true, matchId };
  }

  return { matched: false };
}

// ─── Get My Matches ───────────────────────────────────────
// Uses only array-contains to avoid composite index requirement — filters in JS
export function subscribeToMatches(uid, callback) {
  const q = query(collection(db, 'matches'), where('users', 'array-contains', uid));
  return onSnapshot(
    q,
    (snap) => {
      const matches = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(m => m.active !== false)
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      callback(matches);
    },
    () => callback([]),
  );
}

// ─── Unmatch ──────────────────────────────────────────────
export async function unmatch(matchId) {
  const matchRef = doc(db, 'matches', matchId);
  await Promise.race([
    setDoc(matchRef, { active: false, unmatchedAt: serverTimestamp() }, { merge: true }),
    swipeTimeout(),
  ]);
  showToast('Match desfeito.', 'info');
}

// Mock profiles removed — platform ready for real users
export const MOCK_PROFILES = [];
