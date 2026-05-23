/* ============================================================
   VELORA — Currency (SPARKS) Module
   Balance management, purchase packages, transaction history
   ============================================================ */

import { db } from './firebase-config.js';
import {
  doc, getDoc, updateDoc, addDoc, collection,
  serverTimestamp, query, where, orderBy, getDocs, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { VeloraState } from './app.js';
import { showToast } from './ui.js';
import { t } from './i18n.js';

// ─── Packages ─────────────────────────────────────────────
export const SPARKS_PACKAGES = [
  { id: 'starter', sparks: 100,  priceReal: 9.90,  priceUSD: 1.99,  label: 'Starter',  emoji: '✨' },
  { id: 'popular', sparks: 500,  priceReal: 39.90, priceUSD: 7.99,  label: 'Popular',  emoji: '⚡', popular: true },
  { id: 'vip',     sparks: 1500, priceReal: 99.90, priceUSD: 19.99, label: 'VIP',       emoji: '💎', bestValue: true },
];

// Costs for actions
export const SPARKS_COSTS = {
  unlockPhoto:  5,
  superLike:    10,
  boost1h:      50,
  feedHighlight: 20,
  rewind:       3,
};

// ─── Get Balance ──────────────────────────────────────────
export async function getBalance(uid) {
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  return snap.exists() ? (snap.data().sparks || 0) : 0;
}

// ─── Check Balance ────────────────────────────────────────
export async function hasSparks(uid, amount) {
  const balance = await getBalance(uid);
  return balance >= amount;
}

// ─── Deduct Sparks ────────────────────────────────────────
export async function deductSparks(uid, amount, description = '') {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { sparks: increment(-amount) });

  // Log transaction
  await addDoc(collection(db, 'transactions'), {
    userId:      uid,
    type:        'debit',
    amount:      -amount,
    description,
    timestamp:   serverTimestamp(),
  });

  // Update local state
  if (VeloraState.currentUser?.profile) {
    VeloraState.currentUser.profile.sparks -= amount;
  }
  updateSparksDisplay();
}

// ─── Add Sparks ───────────────────────────────────────────
export async function addSparks(uid, amount, description = '') {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { sparks: increment(amount) });

  await addDoc(collection(db, 'transactions'), {
    userId:      uid,
    type:        'credit',
    amount,
    description,
    timestamp:   serverTimestamp(),
  });

  if (VeloraState.currentUser?.profile) {
    VeloraState.currentUser.profile.sparks += amount;
  }
  updateSparksDisplay();
  showToast(`+${amount} Sparks adicionados! ✨`, 'gold');
}

// ─── Simulate Purchase (mock — integrate Stripe later) ────
export async function purchaseSparks(uid, packageId) {
  const pkg = SPARKS_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return;

  // In production: trigger Stripe payment here
  // For now, simulate success
  await addSparks(uid, pkg.sparks, `Compra: Pacote ${pkg.label}`);
  showToast(`${pkg.sparks} ✨ Sparks adicionados!`, 'gold');
}

// ─── Get Transaction History ──────────────────────────────
export async function getTransactions(uid, limitCount = 20) {
  const q = query(
    collection(db, 'transactions'),
    where('userId', '==', uid),
    orderBy('timestamp', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, limitCount);
}

// ─── Update UI Display ────────────────────────────────────
export function updateSparksDisplay() {
  const balance = VeloraState.currentUser?.profile?.sparks || 0;
  const elements = document.querySelectorAll('[data-sparks-balance]');
  elements.forEach(el => { el.textContent = balance.toLocaleString(); });
}

// ─── Render Store Page ────────────────────────────────────
export function renderStoreHTML(balance) {
  return `
    <div class="top-header">
      <button class="btn-icon btn-ghost" onclick="window._navBack()">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="logo-text" style="font-size:1.2rem">${t('storeTitle')}</span>
      <div></div>
    </div>
    <div class="page-content">
      <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);margin-bottom:var(--space-xl);text-align:center;">
        <div style="font-size:2.5rem;margin-bottom:8px">✨</div>
        <div style="font-family:var(--font-display);font-size:0.8rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.1em;">${t('yourBalance')}</div>
        <div style="font-family:var(--font-display);font-size:3rem;font-weight:900;color:var(--gold);" data-sparks-balance>${balance.toLocaleString()}</div>
        <div style="font-size:0.85rem;color:var(--text-muted);">Sparks</div>
      </div>

      <p class="text-muted text-sm mb-lg" style="text-align:center">${t('storeDesc')}</p>

      <div class="flex-col gap-md mb-xl">
        ${SPARKS_PACKAGES.map(pkg => `
          <div class="sparks-package ${pkg.popular ? 'popular' : ''}" onclick="window._purchaseSparks('${pkg.id}')">
            <div style="font-size:2rem">${pkg.emoji}</div>
            <div style="flex:1">
              <div class="sparks-amount">${pkg.sparks.toLocaleString()} ✨</div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">${pkg.label}</div>
            </div>
            <div>
              <div class="sparks-price">R$ ${pkg.priceReal.toFixed(2)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);text-align:right">US$ ${pkg.priceUSD}</div>
            </div>
            ${pkg.popular ? `<div class="sparks-package-badge"><span class="badge badge-gold">${t('popular')}</span></div>` : ''}
            ${pkg.bestValue ? `<div class="sparks-package-badge"><span class="badge badge-primary">${t('bestValue')}</span></div>` : ''}
          </div>
        `).join('')}
      </div>

      <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);">
        <div class="section-title mb-md">Como usar Sparks ✨</div>
        <div class="flex-col gap-sm">
          ${Object.entries(SPARKS_COSTS).map(([action, cost]) => `
            <div class="flex-between" style="padding:8px 0;border-bottom:1px solid var(--glass-border)">
              <span style="color:var(--text-secondary);font-size:0.9rem">${getActionLabel(action)}</span>
              <span style="color:var(--gold);font-weight:700;font-family:var(--font-display)">${cost} ✨</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

function getActionLabel(action) {
  const labels = {
    unlockPhoto:   '🔓 Desbloquear foto',
    superLike:     '⭐ Super Like',
    boost1h:       '🚀 Boost de perfil (1h)',
    feedHighlight: '📌 Destaque no Feed',
    rewind:        '↩️ Desfazer swipe',
  };
  return labels[action] || action;
}
