/* ============================================================
   VELORA — Currency (SPARKS) Module
   Balance management, purchase packages, transaction history
   ============================================================ */

import { db } from './firebase-config.js?v=7';
import {
  doc, getDoc, updateDoc, addDoc, collection,
  serverTimestamp, query, where, getDocs, increment, limit,
  runTransaction,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const fsTimeout = (ms = 10000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout na operação.')), ms));
import { VeloraState } from './app.js?v=7';
import { showToast } from './ui.js?v=7';
import { t } from './i18n.js?v=7';

// ─── Packages ─────────────────────────────────────────────
// stripeLink: Cole o URL do Payment Link gerado no painel do Stripe.
//   Stripe Dashboard → Payment Links → Create Link
//   Em "After payment", configure a URL de confirmação de cada pacote:
//     starter → https://velora-social.web.app?payment=success&pkg=starter
//     popular → https://velora-social.web.app?payment=success&pkg=popular
//     vip     → https://velora-social.web.app?payment=success&pkg=vip
export const SPARKS_PACKAGES = [
  { id: 'starter', sparks: 100,  priceReal: 9.90,  priceUSD: 1.99,  label: 'Starter',  emoji: '✨', stripeLink: 'https://buy.stripe.com/test_8x2eVedungki0XSeJed7q02' },
  { id: 'popular', sparks: 500,  priceReal: 39.90, priceUSD: 7.99,  label: 'Popular',  emoji: '⚡', popular: true,   stripeLink: 'https://buy.stripe.com/test_eVqbJ2bmfd869uoasYd7q01' },
  { id: 'vip',     sparks: 1500, priceReal: 99.90, priceUSD: 19.99, label: 'VIP',       emoji: '💎', bestValue: true, stripeLink: 'https://buy.stripe.com/test_bJeaEYgGzecagWQ7gMd7q00' },
];

export function isStripeConfigured() {
  return SPARKS_PACKAGES.some(p => p.stripeLink);
}

// ─── Build Stripe Checkout URL ────────────────────────────
// Anexa client_reference_id=<uid> ao Payment Link para que a Cloud
// Function `stripeWebhook` saiba quem creditar quando o pagamento
// for confirmado (ver functions/index.js). Sem isso o webhook não
// tem como saber a quem os Sparks pertencem.
export function buildStripeCheckoutUrl(pkg, uid) {
  const url = new URL(pkg.stripeLink);
  url.searchParams.set('client_reference_id', uid);
  return url.toString();
}

// Costs for actions
export const SPARKS_COSTS = {
  unlockPhoto:    5,
  superLike:      10,
  boost1h:        50,
  feedHighlight:  20,
  rewind:         3,
  directMessage:  15,
};

// ─── Get Balance ──────────────────────────────────────────
export async function getBalance(uid) {
  const snap = await Promise.race([getDoc(doc(db, 'users', uid)), fsTimeout()]);
  return snap.exists() ? (snap.data().sparks || 0) : 0;
}

// ─── Check Balance ────────────────────────────────────────
export async function hasSparks(uid, amount) {
  const balance = await getBalance(uid);
  return balance >= amount;
}

// ─── Deduct Sparks (transação atômica — previne saldo negativo) ───
export async function deductSparks(uid, amount, description = '') {
  const userRef = doc(db, 'users', uid);

  const newBalance = await Promise.race([
    runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('Usuário não encontrado.');
      const current = snap.data().sparks || 0;
      if (current < amount) {
        showToast(`Sparks insuficientes. Você tem ${current} ✨`, 'error');
        throw new Error('Saldo insuficiente');
      }
      tx.update(userRef, { sparks: increment(-amount) });
      return current - amount;
    }),
    fsTimeout(),
  ]);

  addDoc(collection(db, 'transactions'), {
    userId: uid, type: 'debit', amount: -amount, description, timestamp: serverTimestamp(),
  }).catch(() => {});

  if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.sparks = newBalance;
  updateSparksDisplay();
}

// ─── Add Sparks ───────────────────────────────────────────
// ATENÇÃO: desde o reforço de firestore.rules, o cliente NUNCA pode
// aumentar o próprio saldo de `sparks` — apenas a Cloud Function
// `stripeWebhook` (Admin SDK) pode. Esta função e `purchaseSparks()`
// abaixo agora só têm efeito real quando chamadas com privilégios de
// admin (ex.: console do Firebase / scripts internos); chamadas pelo
// app do usuário final vão falhar com "permission-denied" por design.
export async function addSparks(uid, amount, description = '') {
  await Promise.race([updateDoc(doc(db, 'users', uid), { sparks: increment(amount) }), fsTimeout()]);
  addDoc(collection(db, 'transactions'), {
    userId: uid, type: 'credit', amount, description, timestamp: serverTimestamp(),
  }).catch(() => {});
  if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.sparks += amount;
  updateSparksDisplay();
  showToast(`+${amount} Sparks adicionados! ✨`, 'gold');
}

// ─── Crédito direto (apenas privilegiado — ver nota acima) ─
// O fluxo real de compra do usuário final é: app.js redireciona para
// buildStripeCheckoutUrl() → Stripe Checkout → stripeWebhook credita.
// Esta função não é mais chamada nesse caminho.
export async function purchaseSparks(uid, packageId) {
  const pkg = SPARKS_PACKAGES.find(p => p.id === packageId);
  if (!pkg) return;
  await addSparks(uid, pkg.sparks, `Compra: Pacote ${pkg.label}`);
  showToast(`${pkg.sparks} ✨ Sparks adicionados!`, 'gold');
}

// ─── Get Transaction History ──────────────────────────────
// orderBy removed — sorts in JS to avoid composite index requirement
export async function getTransactions(uid, limitCount = 20) {
  const q = query(collection(db, 'transactions'), where('userId', '==', uid), limit(limitCount));
  const snap = await Promise.race([getDocs(q), fsTimeout()]);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
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
    <div class="top-header" style="justify-content:space-between">
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
      ${!isStripeConfigured() ? `
        <div style="background:rgba(247,201,72,0.08);border:1px solid rgba(247,201,72,0.3);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-lg);text-align:center;font-size:0.82rem;color:var(--gold)">
          ⚡ Modo demonstração — pagamentos simulados. Configure os links do Stripe para ativar pagamentos reais.
        </div>` : ''}

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
              <div style="font-size:0.75rem;color:${pkg.stripeLink ? 'var(--success)' : 'var(--text-muted)'};text-align:right">${pkg.stripeLink ? '💳 Stripe' : 'Demo'}</div>
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
    unlockPhoto:    '🔓 Desbloquear foto',
    superLike:      '⭐ Super Like',
    boost1h:        '🚀 Boost de perfil (1h)',
    feedHighlight:  '📌 Destaque no Feed',
    rewind:         '↩️ Desfazer swipe',
    directMessage:  '💬 Mensagem direta (sem match)',
  };
  return labels[action] || action;
}
