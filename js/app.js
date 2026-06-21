/* ============================================================
   VELORA — Main Application Router & State
   SPA routing, global state, page orchestration
   ============================================================ */

import { i18n, t, LANGUAGES } from './i18n.js?v=8';
import { auth, db } from './firebase-config.js?v=8';
import {
  initAuthObserver, logoutUser, getUserProfile, updateUserProfile,
  loginWithEmail, loginWithGoogle, registerWithEmail, resendEmailVerification,
} from './auth.js?v=8';
import {
  showPage, showToast, showModal, showConfirm,
  showMatchPopup, launchConfetti, initParticles,
  svgIcon, defaultAvatar, veloraScoreRing, registerPage, getAge, formatTime,
} from './ui.js?v=8';
import {
  SwipeEngine, loadProfiles, recordSwipe,
  subscribeToMatches, unmatch,
} from './swipe.js?v=8';
import { subscribeToChat, sendMessage, renderMessages, typingIndicatorHTML, MESSAGE_SUGGESTIONS } from './chat.js?v=8';
import { uploadPhoto, getUserGallery, togglePhotoLock, unlockPhoto, deletePhoto, renderGalleryGrid } from './gallery.js?v=8';
import { getBalance, updateSparksDisplay, renderStoreHTML, SPARKS_PACKAGES, hasSparks, deductSparks, SPARKS_COSTS, buildStripeCheckoutUrl } from './currency.js?v=8';
import { analytics } from './analytics.js?v=8';
import { blockUser, reportUser, getBlockedUids, renderReportModal } from './moderation.js?v=8';
import { addStory, getActiveStories, viewStory, reactToStory, deleteStory, renderStoriesBar, renderStoryViewer } from './stories.js?v=8';
import { requestNotificationPermission, initForegroundMessages, getNotificationStatus } from './notifications.js?v=8';
import {
  collection, doc, addDoc, getDocs, onSnapshot, setDoc, updateDoc,
  query, where, orderBy, serverTimestamp, getDoc, limit,
  increment, arrayUnion, arrayRemove,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { deleteUser } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ─── Global State ─────────────────────────────────────────
export const VeloraState = {
  currentUser:    null,
  matchesUnsub:   null,
  chatUnsub:      null,
  _feedUnsub:     null,
  activeConvId:   null,
  profiles:       [],
  currentCardIdx: 0,
  swipeEngine:    null,
  matchCount:     0,
  currentPage:    'splash',
  navStack:       [],
};

// ─── Online Presence ──────────────────────────────────────
let _presenceInterval = null;
let _presenceOfflineFn = null;

function startPresence(uid) {
  stopPresence();
  const userRef = doc(db, 'users', uid);
  const markOnline  = () => updateDoc(userRef, { isOnline: true,  lastSeen: serverTimestamp() }).catch(() => {});
  const markOffline = () => updateDoc(userRef, { isOnline: false, lastSeen: serverTimestamp() }).catch(() => {});
  markOnline();
  _presenceInterval  = setInterval(markOnline, 120000);
  _presenceOfflineFn = markOffline;
  window.addEventListener('beforeunload', markOffline);
  window.addEventListener('pagehide',     markOffline);
}

function stopPresence() {
  if (_presenceInterval)  { clearInterval(_presenceInterval); _presenceInterval = null; }
  if (_presenceOfflineFn) {
    _presenceOfflineFn();
    window.removeEventListener('beforeunload', _presenceOfflineFn);
    window.removeEventListener('pagehide',     _presenceOfflineFn);
    _presenceOfflineFn = null;
  }
}

function isUserOnline(profile) {
  if (!profile || !profile.isOnline) return false;
  const secs = profile.lastSeen?.seconds || 0;
  return (Date.now() / 1000 - secs) < 600;
}

function getGreeting() {
  const h = new Date().getHours();
  const lang = i18n.getCurrentLang();
  if (lang === 'en') return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  if (lang === 'es') return h < 12 ? 'Buenos días' : h < 18 ? 'Buenas tardes' : 'Buenas noches';
  if (lang === 'fr') return h < 12 ? 'Bonjour' : h < 18 ? 'Bonjour' : 'Bonsoir';
  if (lang === 'de') return h < 12 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

// ─── Stripe Payment Return Detection ─────────────────────
// Detecta ?payment=success&pkg=X ao voltar do checkout do Stripe
const _stripeParams = new URLSearchParams(window.location.search);
let _pendingStripePkg = (_stripeParams.get('payment') === 'success') ? _stripeParams.get('pkg') : null;
if (_pendingStripePkg) {
  // Limpa a URL imediatamente para evitar crédito duplo em refresh
  window.history.replaceState({}, '', window.location.pathname);
}

// ─── Bottom Nav ───────────────────────────────────────────
function renderBottomNav(active = 'home') {
  const items = [
    { id: 'home',     icon: 'home',     label: t('home') },
    { id: 'discover', icon: 'discover', label: t('discover') },
    { id: 'feed',     icon: 'feed',     label: t('feed') },
    { id: 'matches',  icon: 'heart',    label: t('matches'), badge: VeloraState.matchCount || '' },
    { id: 'profile',  icon: 'user',     label: t('profile') },
  ];
  return `
    <nav class="bottom-nav" id="bottom-nav">
      ${items.map(item => `
        <div class="nav-item ${active === item.id ? 'active' : ''}" onclick="window._navigate('${item.id}')" id="nav-${item.id}">
          ${svgIcon(item.icon, 22)}
          <span>${item.label}</span>
          ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
        </div>
      `).join('')}
    </nav>
  `;
}

function renderTopHeader(sparks = 0) {
  const langInfo = i18n.getLangInfo();
  return `
    <header class="top-header">
      <div class="logo-text">VELORA</div>
      <div style="display:flex;align-items:center;gap:10px">
        <button class="lang-btn" onclick="window._showLangPicker()">
          ${langInfo?.flag || '🌐'} ${langInfo?.name?.split(' ')[0] || 'PT'}
        </button>
        <div class="sparks-badge" onclick="window._navigate('store')">
          <span class="sparks-icon">✨</span>
          <span data-sparks-balance>${sparks}</span>
        </div>
      </div>
    </header>
  `;
}

// ─── SPLASH SCREEN ────────────────────────────────────────
function renderSplash() {
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;overflow:hidden;background:var(--bg-deep)">
      <div class="splash-ring-1" style="width:300px;height:300px"></div>
      <div class="splash-ring-2" style="width:450px;height:450px"></div>
      <div class="splash-ring-3" style="width:600px;height:600px"></div>
      <div style="z-index:1;text-align:center">
        <h1 class="splash-logo" style="font-family:var(--font-display);font-size:5rem;font-weight:900;background:var(--grad-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;letter-spacing:-0.03em">
          VELORA
        </h1>
        <p class="splash-subtitle" style="color:var(--text-secondary);font-family:var(--font-display);font-size:1rem;letter-spacing:0.2em;text-transform:uppercase;margin-top:8px">
          ${t('tagline')}
        </p>
      </div>
    </div>
  `;
}

// ─── ONBOARDING ───────────────────────────────────────────
function renderOnboarding() {
  const slides = [
    {
      emoji: '💫',
      color: 'var(--primary)',
      glow:  'var(--glow-primary)',
      title: 'Conexões Reais',
      desc:  'Encontre pessoas incríveis ao seu redor com o nosso algoritmo VeloraScore™',
    },
    {
      emoji: '🔒',
      color: 'var(--gold)',
      glow:  'var(--glow-gold)',
      title: 'Sua Privacidade',
      desc:  'Controle quem vê suas fotos. Desbloqueie conteúdo exclusivo com Sparks ✨',
    },
    {
      emoji: '⚡',
      color: 'var(--secondary)',
      glow:  'var(--glow-secondary)',
      title: 'Match Instantâneo',
      desc:  'Swipe, conecte e converse em tempo real. Sua próxima história começa aqui!',
    },
  ];
  let current = 0;

  function renderSlide(i) {
    const s = slides[i];
    return `
      <div class="onboarding-slide" id="onboarding-slide">
        <div class="onboarding-icon animate-popIn" style="background:${s.color}20;box-shadow:${s.glow}">
          ${s.emoji}
        </div>
        <div>
          <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;text-align:center;margin-bottom:12px">${s.title}</h2>
          <p style="color:var(--text-secondary);text-align:center;font-size:1rem;line-height:1.6">${s.desc}</p>
        </div>
      </div>
    `;
  }

  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
      <div id="onboarding-content" style="flex:1;display:flex;flex-direction:column">
        ${renderSlide(0)}
      </div>
      <div style="padding:var(--space-xl)">
        <div class="steps-indicator" id="steps-indicator">
          ${slides.map((_, i) => `<div class="step-dot ${i === 0 ? 'active' : ''}"></div>`).join('')}
        </div>
        <button class="btn btn-primary btn-lg btn-w-full" id="onboarding-next">
          ${t('next')}
        </button>
        <button class="btn btn-ghost btn-w-full mt-sm" id="onboarding-skip" style="font-size:0.9rem;color:var(--text-muted)">
          Pular
        </button>
      </div>
    </div>
  `;
}

// ─── Auth Hero Panel (shared) ─────────────────────────────
function renderAuthHero() {
  return `
    <div class="auth-hero">
      <div class="auth-hero-rings">
        <div class="auth-hero-ring animate-pulseBig" style="width:500px;height:500px;border-color:rgba(0,245,212,0.08)"></div>
        <div class="auth-hero-ring animate-pulseBig" style="width:350px;height:350px;border-color:rgba(124,60,255,0.12);animation-delay:0.5s"></div>
        <div class="auth-hero-ring animate-pulseBig" style="width:200px;height:200px;border-color:rgba(255,43,214,0.15);animation-delay:1s"></div>
      </div>
      <div style="position:relative;z-index:1;text-align:center;max-width:480px">
        <h1 class="logo-text" style="font-size:4rem;display:block;margin-bottom:12px;letter-spacing:-0.04em">VELORA</h1>
        <p style="font-size:1.15rem;color:var(--text-secondary);margin-bottom:56px;font-family:var(--font-display);letter-spacing:0.15em;text-transform:uppercase">${t('tagline')}</p>
        <div style="display:flex;flex-direction:column;gap:20px;text-align:left">
          ${[
            { emoji:'💫', title:'Conexões Reais', desc:'Algoritmo VeloraScore™ para matches mais precisos' },
            { emoji:'🔒', title:'Privacidade Total', desc:'Controle quem vê suas fotos. Desbloqueie com Sparks' },
            { emoji:'⚡', title:'Match Instantâneo', desc:'Swipe, conecte e converse em tempo real' },
          ].map(f => `
            <div style="display:flex;align-items:center;gap:18px;padding:16px 20px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:var(--radius-lg);backdrop-filter:blur(10px)">
              <div style="width:44px;height:44px;border-radius:var(--radius-md);background:rgba(0,245,212,0.1);border:1px solid rgba(0,245,212,0.2);display:flex;align-items:center;justify-content:center;font-size:1.4rem;flex-shrink:0">${f.emoji}</div>
              <div>
                <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem;margin-bottom:2px">${f.title}</div>
                <div style="font-size:0.82rem;color:var(--text-muted)">${f.desc}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
}

// ─── LOGIN PAGE ───────────────────────────────────────────
function renderLogin() {
  return `
    <div class="auth-layout">
      ${renderAuthHero()}
      <div class="auth-form-panel">
        <div style="text-align:center;margin-bottom:var(--space-2xl)">
          <h1 class="logo-text" style="font-size:2rem;display:block;margin-bottom:8px">VELORA</h1>
          <p style="color:var(--text-muted);font-size:0.9rem">${t('tagline')}</p>
        </div>

        <div class="flex-col gap-md">
          <div class="input-group">
            <label class="input-label">${t('email')}</label>
            <div class="input-wrapper">
              <span class="input-icon">${svgIcon('discover', 18)}</span>
              <input type="email" id="login-email" class="input-field has-icon" placeholder="seu@email.com">
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">${t('password')}</label>
            <div class="input-wrapper">
              <span class="input-icon">${svgIcon('lock', 18)}</span>
              <input type="password" id="login-password" class="input-field has-icon has-icon-right" placeholder="••••••••">
              <span class="input-toggle" id="toggle-pw">${svgIcon('eye', 18)}</span>
            </div>
          </div>

          <div style="text-align:right">
            <button class="text-primary" style="font-size:0.85rem;font-weight:600;background:none;border:none;cursor:pointer" onclick="window._showForgotPassword()">
              ${t('forgotPassword')}
            </button>
          </div>

          <button class="btn btn-primary btn-lg btn-w-full" id="login-btn">
            <span class="btn-text">${t('login')}</span>
          </button>

          <div class="divider">${t('orWith')}</div>

          <button class="btn btn-ghost btn-w-full" id="google-login-btn" style="gap:10px;border:1px solid var(--glass-border)">
            <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            ${t('continueGoogle')}
          </button>
        </div>

        <p style="text-align:center;margin-top:var(--space-xl);color:var(--text-muted);font-size:0.9rem">
          ${t('noAccount')}
          <button class="text-primary" style="background:none;border:none;cursor:pointer;font-weight:700" onclick="window._navigate('register')">
            ${t('register')}
          </button>
        </p>
      </div>
    </div>
  `;
}

// ─── REGISTER (Multi-step) ────────────────────────────────
function renderRegister() {
  const interests = ['Música 🎵','Viagens ✈️','Esportes ⚽','Arte 🎨','Cinema 🎬','Livros 📚','Gastronomia 🍕','Gaming 🎮','Yoga 🧘','Natureza 🌿','Dança 💃','Fotografia 📸','Tecnologia 💻','Moda 👗','Pets 🐾','Astronomia 🌟'];

  return `
    <div class="auth-layout">
      ${renderAuthHero()}
      <div class="auth-form-panel">
      <div style="margin-bottom:var(--space-lg)">
        <button class="btn-icon btn-ghost" onclick="window._navigate('login')">
          ${svgIcon('back', 20)}
        </button>
      </div>

      <div id="register-content">
        <!-- Step 1 -->
        <div id="step-1" class="register-step">
          <div class="steps-indicator mb-lg">
            <div class="step-dot active"></div>
            <div class="step-dot"></div>
            <div class="step-dot"></div>
          </div>
          <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;margin-bottom:8px">${t('step')} 1 ${t('of')} 3</h2>
          <p style="color:var(--text-muted);margin-bottom:var(--space-xl)">Informações básicas</p>
          <div class="flex-col gap-md">
            <div class="input-group">
              <label class="input-label">${t('yourName')}</label>
              <div class="input-wrapper">
                <span class="input-icon">${svgIcon('user', 18)}</span>
                <input type="text" id="reg-name" class="input-field has-icon" placeholder="Seu nome completo">
              </div>
            </div>
            <div class="input-group">
              <label class="input-label">${t('email')}</label>
              <div class="input-wrapper">
                <span class="input-icon">${svgIcon('discover', 18)}</span>
                <input type="email" id="reg-email" class="input-field has-icon" placeholder="seu@email.com">
              </div>
            </div>
            <div class="input-group">
              <label class="input-label">${t('yourAge')}</label>
              <div class="input-wrapper">
                <span class="input-icon">🎂</span>
                <input type="date" id="reg-birth" class="input-field has-icon">
              </div>
            </div>
            <div class="input-group">
              <label class="input-label">${t('password')}</label>
              <div class="input-wrapper">
                <span class="input-icon">${svgIcon('lock', 18)}</span>
                <input type="password" id="reg-password" class="input-field has-icon" placeholder="Mínimo 6 caracteres">
              </div>
            </div>
            <div class="input-group">
              <label class="input-label">${t('confirmPassword')}</label>
              <div class="input-wrapper">
                <span class="input-icon">${svgIcon('lock', 18)}</span>
                <input type="password" id="reg-password2" class="input-field has-icon" placeholder="Confirme a senha">
              </div>
            </div>
          </div>
        </div>

        <!-- Step 2 -->
        <div id="step-2" class="register-step" style="display:none">
          <div class="steps-indicator mb-lg">
            <div class="step-dot completed"></div>
            <div class="step-dot active"></div>
            <div class="step-dot"></div>
          </div>
          <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;margin-bottom:8px">${t('step')} 2 ${t('of')} 3</h2>
          <p style="color:var(--text-muted);margin-bottom:var(--space-xl)">Foto e bio</p>

          <div style="text-align:center;margin-bottom:var(--space-lg)">
            <div id="photo-preview" style="width:120px;height:120px;border-radius:50%;background:var(--bg-surface);border:3px solid var(--primary);margin:0 auto var(--space-md);display:flex;align-items:center;justify-content:center;font-size:3rem;cursor:pointer;overflow:hidden;box-shadow:var(--glow-primary)" onclick="document.getElementById('photo-upload').click()">
              📷
            </div>
            <input type="file" id="photo-upload" accept="image/*" style="display:none">
            <button class="btn btn-outline btn-sm" onclick="document.getElementById('photo-upload').click()">
              ${t('addPhoto')}
            </button>
          </div>

          <div class="input-group">
            <label class="input-label">${t('yourBio')}</label>
            <textarea id="reg-bio" class="input-field input-textarea" placeholder="${t('bioPlaceholder')}"></textarea>
          </div>

          <div class="input-group mt-md">
            <label class="input-label">Gênero</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
              ${['Mulher','Homem','Não-binário','Outro'].map(g => `
                <div class="tag" data-gender="${g}" onclick="window._selectGender(this, '${g}')">${g}</div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Step 3 -->
        <div id="step-3" class="register-step" style="display:none">
          <div class="steps-indicator mb-lg">
            <div class="step-dot completed"></div>
            <div class="step-dot completed"></div>
            <div class="step-dot active"></div>
          </div>
          <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;margin-bottom:8px">${t('step')} 3 ${t('of')} 3</h2>
          <p style="color:var(--text-muted);margin-bottom:var(--space-lg)">Seus interesses e preferências</p>

          <div class="input-group mb-lg">
            <label class="input-label">${t('lookingFor')}</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
              ${[
                { id: 'dating',     label: `💕 ${t('dating')}` },
                { id: 'friendship', label: `🤝 ${t('friendship')}` },
                { id: 'casual',     label: `🔥 ${t('casual')}` },
              ].map(opt => `
                <div class="tag" data-intent="${opt.id}" onclick="window._toggleIntent(this, '${opt.id}')">${opt.label}</div>
              `).join('')}
            </div>
          </div>

          <div class="input-group mb-lg">
            <label class="input-label">${t('yourInterests')}</label>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px" id="interests-container">
              ${interests.map(int => `
                <div class="tag" onclick="this.classList.toggle('active')" data-interest="${int}">${int}</div>
              `).join('')}
            </div>
          </div>

          <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);border-color:rgba(255,43,214,0.3)">
            <div class="flex-between mb-sm">
              <div>
                <div style="font-family:var(--font-display);font-weight:700">🔞 ${t('adultContent')}</div>
                <div style="font-size:0.8rem;color:var(--text-muted);margin-top:4px">${t('adultWarning')}</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="adult-toggle">
                <div class="toggle-track"></div>
                <div class="toggle-thumb"></div>
              </label>
            </div>
            <label class="checkbox-group" id="age-confirm-group" style="display:none">
              <input type="checkbox" id="age-confirm" style="display:none">
              <div class="checkbox-box" id="age-checkbox"></div>
              <span style="font-size:0.85rem;color:var(--text-secondary)">${t('iAm18')}</span>
            </label>
          </div>
        </div>

        <div style="margin-top:40px;display:flex;flex-direction:column;gap:var(--space-sm)" id="register-actions">
          <button class="btn btn-primary btn-lg btn-w-full" id="register-next-btn">
            <span class="btn-text">${t('next')}</span>
          </button>
          <button class="btn btn-ghost btn-sm btn-w-full" id="register-back-btn" style="display:none">
            ${t('back')}
          </button>
        </div>
      </div>
      </div>
    </div>
  `;
}

// ─── TIKTOK SLIDE ─────────────────────────────────────────
function renderTikTokSlide(p, idx, total) {
  const online    = isUserOnline(p);
  const interests = (p.interests || []).slice(0, 4);
  return `
    <div class="tiktok-slide" data-idx="${idx}" data-uid="${p.uid || ''}">
      <img class="tiktok-bg" src="${p.photoURL || defaultAvatar(p.displayName)}" alt="${p.displayName}" loading="${idx === 0 ? 'eager' : 'lazy'}">
      <div class="tiktok-grad"></div>

      <!-- Score badge -->
      <div class="tiktok-score-badge">${veloraScoreRing(p.veloraScore || 75, 48)}</div>

      ${online ? `
      <div class="tiktok-online-badge">
        <div style="width:7px;height:7px;border-radius:50%;background:var(--success);box-shadow:0 0 8px var(--success)"></div>
        <span style="font-size:0.72rem;color:var(--success);font-weight:700;font-family:var(--font-display)">Online</span>
      </div>` : ''}

      <!-- Info área inferior -->
      <div class="tiktok-info">
        <h2 class="tiktok-name">
          ${p.displayName}${p.age ? `, ${p.age}` : ''}${p.verified ? ' <span style="color:var(--primary)">✓</span>' : ''}
        </h2>
        <div class="tiktok-loc">
          ${svgIcon('location', 13)} ${p.kmAway || '?'} km ${p.city ? '· ' + p.city : ''}
        </div>
        ${p.bio ? `<p class="tiktok-bio">${p.bio.slice(0, 110)}${p.bio.length > 110 ? '...' : ''}</p>` : ''}
        <div class="tiktok-chips">
          ${interests.map(i => `<span class="tiktok-chip">${i}</span>`).join('')}
          ${p.lookingFor?.includes('casual') ? `<span class="tiktok-chip" style="color:var(--secondary);border-color:rgba(255,149,0,0.35);background:rgba(255,149,0,0.12)">🔥 Casual</span>` : ''}
        </div>
        <button class="tiktok-profile-link" onclick="window._viewProfile('${p.uid || ''}')">
          Ver perfil completo ${svgIcon('back', 12)}
        </button>
      </div>
    </div>
  `;
}

// ─── HOME (Swipe) PAGE — TikTok Vertical ─────────────────
function renderHome() {
  const user = VeloraState.currentUser;
  const sparks = user?.profile?.sparks || 0;
  const profiles = VeloraState.profiles;
  const total = profiles.length;

  // Se sem perfis, mostra tela de espera
  if (!total) {
    return `
      <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
        ${renderTopHeader(sparks)}
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:var(--space-xl);text-align:center;gap:var(--space-lg)">
          ${renderNoMoreCards()}
        </div>
        ${renderBottomNav('home')}
      </div>
    `;
  }

  // Dots de progresso lateral
  const maxDots = Math.min(total, 7);
  const dots = Array.from({length: maxDots}, (_, i) =>
    `<div class="tiktok-dot${i === 0 ? ' active' : ''}" data-dot="${i}"></div>`
  ).join('');

  return `
    <div class="tiktok-shell" id="tiktok-shell">

      <!-- HUD topo -->
      <div class="tiktok-hud" id="tiktok-hud">
        <span class="tiktok-logo">VELORA</span>
        <div class="tiktok-progress-pill" id="tiktok-progress">1 / ${total}</div>
        <button class="tiktok-sparks-pill" onclick="window._navigate('store')">✨ ${sparks}</button>
      </div>

      <!-- Feed vertical scroll-snap -->
      <div class="tiktok-feed" id="tiktok-feed">
        ${profiles.map((p, i) => renderTikTokSlide(p, i, total)).join('')}
        <!-- Slide final -->
        <div class="tiktok-slide tiktok-slide-end">
          <div style="font-size:4rem;margin-bottom:var(--space-lg)">🎉</div>
          <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:900;margin-bottom:var(--space-sm)">${t('noMoreProfiles') || 'Fim por hoje!'}</h2>
          <p style="color:var(--text-muted);margin-bottom:var(--space-xl)">Volte mais tarde para mais perfis incríveis</p>
          <button class="btn btn-primary btn-lg" onclick="window._navigate('discover')">
            ${svgIcon('discover', 18)} Explorar
          </button>
        </div>
      </div>

      <!-- Botões de ação — direita (TikTok style) -->
      <div class="tiktok-actions" id="tiktok-actions">
        <div class="tiktok-action-item">
          <button class="tiktok-action-btn tiktok-btn-pass" onclick="window._tiktokAction('pass')" title="${t('pass')}">
            ${svgIcon('x', 22)}
          </button>
          <span class="tiktok-action-label">Passar</span>
        </div>
        <div class="tiktok-action-item">
          <button class="tiktok-action-btn tiktok-btn-super" onclick="window._tiktokAction('superlike')" title="${t('superLike')}">
            ${svgIcon('star', 20)}
          </button>
          <span class="tiktok-action-label">Super</span>
        </div>
        <div class="tiktok-action-item">
          <button class="tiktok-action-btn tiktok-btn-like" onclick="window._tiktokAction('like')" title="${t('like')}">
            ${svgIcon('heart', 24)}
          </button>
          <span class="tiktok-action-label">Curtir</span>
        </div>
      </div>

      <!-- Dots laterais de progresso -->
      <div class="tiktok-dots" id="tiktok-dots">${dots}</div>

      ${renderBottomNav('home')}
    </div>
  `;
}


function renderProfileCard(profile, idx, isBackground = false) {
  const interests = (profile.interests || []).slice(0, 3);
  const online    = isUserOnline(profile);
  return `
    <div class="profile-card ${isBackground ? '' : 'animate-scaleIn'}" id="top-card" style="${isBackground ? 'pointer-events:none' : ''}">
      <img class="profile-card-image" src="${profile.photoURL || defaultAvatar(profile.displayName)}" alt="${profile.displayName}" draggable="false">
      <div class="profile-card-gradient"></div>
      <div style="position:absolute;top:12px;left:12px;width:10px;height:10px;border-radius:50%;background:${online ? 'var(--success)' : 'rgba(255,255,255,0.2)'};box-shadow:${online ? '0 0 10px var(--success)' : 'none'};border:${online ? 'none' : '1.5px solid rgba(255,255,255,0.3)'}"></div>
      <div class="swipe-like-overlay">${t('like')}</div>
      <div class="swipe-pass-overlay">${t('pass')}</div>
      <div class="swipe-superlike-overlay">⭐ ${t('superLike')}</div>
      <div class="profile-card-info">
        <div style="display:flex;align-items:flex-end;justify-content:space-between">
          <div>
            <div class="profile-card-name">
              ${profile.displayName}, ${profile.age}
              ${profile.verified ? ' ✓' : ''}
            </div>
            <div class="profile-card-meta">
              ${svgIcon('location', 14)} ${profile.kmAway || '?'} ${t('kmAway')}
            </div>
          </div>
          ${veloraScoreRing(profile.veloraScore || 75, 60)}
        </div>
        ${profile.bio ? `<p style="color:rgba(255,255,255,0.8);font-size:0.85rem;margin-top:8px;line-height:1.4">${profile.bio.slice(0, 80)}${profile.bio.length > 80 ? '...' : ''}</p>` : ''}
        <div class="profile-card-tags">
          ${interests.map(i => `<span class="badge badge-primary" style="background:rgba(0,0,0,0.3);backdrop-filter:blur(10px)">${i}</span>`).join('')}
          ${profile.lookingFor?.includes('casual') ? `<span class="badge badge-secondary" style="background:rgba(0,0,0,0.3)">🔥 Casual</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderNoMoreCards() {
  return `
    <div class="empty-state" style="padding:60px 20px">
      <div class="empty-state-icon">🌊</div>
      <p class="empty-state-title">${t('noMoreProfiles')}</p>
      <p class="empty-state-desc">${t('checkBackLater')}</p>
      <button class="btn btn-primary mt-lg" onclick="window._navigate('discover')">
        ${svgIcon('discover', 18)} Explorar
      </button>
    </div>
  `;
}

// ─── MATCHES PAGE ─────────────────────────────────────────
function renderMatchesPage(matches = []) {
  const sparks = VeloraState.currentUser?.profile?.sparks || 0;
  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding:0 0 100px">

      <!-- ── Hero ── -->
      <div class="page-hero">
        <div class="page-hero-eyebrow">💬 Conversas</div>
        <h1 class="page-hero-title">${t('myMatches')}</h1>
        <div class="page-hero-stats">
          <div class="page-hero-stat">
            <div class="page-hero-stat-value">${matches.length}</div>
            <div class="page-hero-stat-label">Matches</div>
          </div>
          ${matches.length > 0 ? `
          <div class="page-hero-stat-divider"></div>
          <div class="page-hero-stat">
            <div class="page-hero-stat-value" style="color:var(--success)">●</div>
            <div class="page-hero-stat-label">Online agora</div>
          </div>` : ''}
        </div>
        ${matches.length === 0 ? `<p class="page-hero-sub" style="margin-top:var(--space-sm)">Explore perfis para encontrar seu match!</p>` : ''}
      </div>

      <div style="padding:var(--space-sm) 0">

      ${!matches.length ? `
        <div class="empty-state">
          <div class="empty-state-icon">💔</div>
          <p class="empty-state-title">${t('noMatches')}</p>
          <p class="empty-state-desc">${t('noMatchesDesc')}</p>
          <button class="btn btn-primary mt-lg" onclick="window._navigate('home')">
            ${svgIcon('heart', 18)} Começar a Explorar
          </button>
        </div>
      ` : matches.map(match => {
        const uid = VeloraState.currentUser?.uid;
        const otherId = match.user1 === uid ? match.user2 : match.user1;
        return `
          <div class="match-item" onclick="window._openChat('${match.id}', '${otherId}')">
            <div class="avatar avatar-md avatar-online" style="background:var(--bg-surface);overflow:hidden">
              <img src="${defaultAvatar(otherId)}" style="width:100%;height:100%;object-fit:cover" alt="Match">
            </div>
            <div class="match-item-info">
              <div class="match-item-name">${otherId.replace('mock', 'Match ')}</div>
              <div class="match-item-preview">Toque para iniciar a conversa 💬</div>
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
              <div class="match-item-time">agora</div>
              <button class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:4px 8px;color:var(--danger)" onclick="event.stopPropagation();window._unmatch('${match.id}', 'Match')">
                ${svgIcon('x', 12)} ${t('unmatch')}
              </button>
            </div>
          </div>
        `;
      }).join('')}
      </div>
    </div>
    ${renderBottomNav('matches')}
  `;
}

// ─── CHAT PAGE ────────────────────────────────────────────
function renderChatPage(convId, otherId) {
  const myUid = VeloraState.currentUser?.uid;
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
      <div class="top-header" style="justify-content:space-between">
        <button class="btn-icon btn-ghost" onclick="window._navigate('matches')">
          ${svgIcon('back', 20)}
        </button>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="avatar avatar-sm avatar-online" style="background:var(--bg-surface);overflow:hidden">
            <img src="${defaultAvatar(otherId || '?')}" style="width:100%;height:100%;object-fit:cover" alt="User">
          </div>
          <div>
            <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">${otherId ? otherId.replace(/^mock\d*/, 'Match') : 'Usuário'}</div>
            <div style="font-size:0.75rem;color:var(--primary)">${t('online')}</div>
          </div>
        </div>
        <button class="btn-icon btn-ghost" onclick="window._unmatch('${convId}', 'este usuário')">
          ${svgIcon('x', 18)}
        </button>
      </div>

      <div id="chat-messages" class="chat-container" style="flex:1;overflow-y:auto;padding-bottom:120px">
        <!-- Messages rendered here -->
        <div style="text-align:center;padding:20px">
          <span class="badge badge-primary">Novo match! Diga olá 👋</span>
        </div>
      </div>

      <!-- Suggestions -->
      <div id="chat-suggestions" style="display:flex;gap:8px;padding:8px 16px;overflow-x:auto;scrollbar-width:none">
        ${(MESSAGE_SUGGESTIONS[i18n.getCurrentLang()] || MESSAGE_SUGGESTIONS['pt-BR'] || []).map(s => `
          <button class="tag" style="white-space:nowrap;font-size:0.82rem" onclick="window._sendSuggestion('${s}')">${s}</button>
        `).join('')}
      </div>

      <div class="chat-input-bar">
        <button class="btn-icon btn-ghost btn-icon-sm">
          ${svgIcon('image', 20)}
        </button>
        <input type="text" id="chat-input" class="chat-input" placeholder="${t('typeMessage')}">
        <button class="btn btn-primary btn-icon" id="chat-send-btn">
          ${svgIcon('send', 18)}
        </button>
      </div>
    </div>
  `;
}

// ─── POST CARD ────────────────────────────────────────────
function renderPostCard(post, uid) {
  const isLiked = (post.likedBy || []).includes(uid);
  const timeStr = post.createdAt?.toDate ? formatTime(post.createdAt.toDate()) : t('timeNow');
  return `
    <div class="post-card">
      <div class="post-card-header">
        <div class="avatar avatar-md" style="background:var(--bg-surface);overflow:hidden">
          <img src="${post.authorPhoto || defaultAvatar(post.authorName)}" style="width:100%;height:100%;object-fit:cover" alt="${post.authorName}">
        </div>
        <div style="flex:1">
          <div style="font-family:var(--font-display);font-weight:700">${post.authorName}${post.authorAge ? `, ${post.authorAge}` : ''}</div>
          <div style="font-size:0.78rem;color:var(--text-muted)">${timeStr}</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
          <button class="btn btn-primary btn-sm" style="padding:6px 14px;font-size:0.8rem" onclick="window._quickLike('${post.id}')">
            ${svgIcon('heart', 14)} Like
          </button>
          <button class="btn btn-ghost btn-sm" style="padding:6px 14px;font-size:0.8rem" onclick="window._quickPass('${post.id}')">
            ${svgIcon('x', 14)} Pass
          </button>
        </div>
      </div>
      <div class="post-card-body">
        <p style="font-size:0.95rem;line-height:1.5;color:var(--text-secondary)">${post.text}</p>
      </div>
      ${post.image ? `<img class="post-card-image" src="${post.image}" alt="Post image" loading="lazy">` : ''}
      <div class="post-card-actions">
        <button class="post-action-btn ${isLiked ? 'liked' : ''}" onclick="window._likePost('${post.id}', this)">
          ${svgIcon('heart', 16)} <span>${post.likes || 0}</span>
        </button>
        <button class="post-action-btn" onclick="window._commentPost('${post.id}')">
          ${svgIcon('chat', 16)} Comentar
        </button>
        <button class="post-action-btn" onclick="window._sharePost('${post.id}')">
          ${svgIcon('send', 16)} Compartilhar
        </button>
      </div>
    </div>
  `;
}

// ─── FEED PAGE ────────────────────────────────────────────
function renderFeed() {
  const sparks = VeloraState.currentUser?.profile?.sparks || 0;
  const user   = VeloraState.currentUser;
  const photo  = user?.profile?.photoURL || defaultAvatar(user?.displayName || '?');
  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding:0 0 100px">

      <!-- ── Hero com create post ── -->
      <div class="page-hero">
        <div class="page-hero-eyebrow">📣 Comunidade</div>
        <h1 class="page-hero-title">Feed</h1>
        <p class="page-hero-sub">Compartilhe com quem faz parte da sua vida</p>
        <div class="feed-hero-create">
          <div class="avatar avatar-sm" style="background:var(--bg-surface);overflow:hidden;flex-shrink:0">
            <img src="${photo}" style="width:100%;height:100%;object-fit:cover" alt="">
          </div>
          <button class="feed-hero-prompt" onclick="window._createPost()">
            ${t('whatsOnYourMind')}...
          </button>
          <button class="btn btn-primary btn-sm" onclick="window._createPost()">
            ${svgIcon('plus', 16)}
          </button>
        </div>
      </div>

      <!-- Posts — preenchidos pelo handler pageReady via Firestore -->
      <div id="feed-posts" style="padding:var(--space-md) var(--space-lg)">
        <div class="flex-center" style="height:200px;color:var(--text-muted);font-size:0.9rem">
          <div class="loading-dots">
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
            <div class="loading-dot"></div>
          </div>
        </div>
      </div>
    </div>
    ${renderBottomNav('feed')}
  `;
}

// ─── PROFILE PAGE ─────────────────────────────────────────
function renderProfilePage() {
  const user = VeloraState.currentUser;
  const profile = user?.profile;
  const sparks = profile?.sparks || 0;

  return `
    ${renderTopHeader(sparks)}
    <div class="profile-page">
    <div class="profile-page-inner">

      <!-- Cover + avatar (avatar positioned absolute hanging below cover) -->
      <div class="profile-cover">
        <div class="profile-avatar-hero">
          <img src="${profile?.photoURL || defaultAvatar(user?.displayName || '?')}" style="width:100%;height:100%;object-fit:cover" alt="Profile">
        </div>
        <button class="btn btn-ghost btn-sm profile-edit-btn" onclick="window._editProfile()">
          ${svgIcon('settings', 16)} ${t('editProfile')}
        </button>
      </div>

      <!-- Identity row: name + score (sits below cover, opaque bg) -->
      <div class="profile-hero">
        <div class="profile-hero-info">
          <h2 class="profile-name">
            ${profile?.displayName || user?.displayName || 'Usuário'}
            ${profile?.verified ? '<span class="badge badge-verified" style="font-size:0.7rem;vertical-align:middle;margin-left:6px"> ✓</span>' : ''}
          </h2>
          <p class="profile-sub">
            ${profile?.age ? `${profile.age} anos` : ''}
            ${profile?.bio ? (profile.age ? ' · ' : '') + profile.bio.slice(0, 60) : ''}
          </p>
        </div>
        <div class="profile-hero-score">${veloraScoreRing(profile?.veloraScore || 75, 72)}</div>
      </div>

      <!-- Match notification banner -->
      <div id="profile-match-notify" style="display:none;margin:0 var(--space-lg) var(--space-md);"></div>

      <!-- Two-column body -->
      <div class="profile-grid">

        <!-- Left column -->
        <div class="profile-left-col">
          <!-- Level & XP -->
          <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);margin-bottom:var(--space-md)">
            <div class="flex-between mb-sm">
              <div style="font-family:var(--font-display);font-weight:700;font-size:0.9rem">${t('level')} ${profile?.level || 1} — ${getLevelName(profile?.level || 1)}</div>
              <div style="font-size:0.8rem;color:var(--text-muted)">${profile?.xp || 0} XP</div>
            </div>
            <div class="xp-bar"><div class="xp-fill" style="width:${Math.min((profile?.xp || 0) % 100, 100)}%"></div></div>
          </div>

          <!-- Sparks -->
          <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);text-align:center;cursor:pointer" onclick="window._navigate('store')">
            <div style="font-size:1.8rem;margin-bottom:4px">✨</div>
            <div style="font-family:var(--font-display);font-weight:900;font-size:1.8rem;color:var(--gold)" data-sparks-balance>${sparks}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:4px">Sparks · ${t('buySparks')}</div>
          </div>
        </div>

        <!-- Right column -->
        <div class="profile-right-col">
          ${profile?.interests?.length ? `
            <div style="margin-bottom:var(--space-lg)">
              <div class="section-title" style="margin-bottom:var(--space-sm)">${t('yourInterests')}</div>
              <div style="display:flex;flex-wrap:wrap;gap:8px">
                ${(profile.interests || []).map(i => `<span class="tag active">${i}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          <!-- Gallery preview -->
          <div style="margin-bottom:var(--space-lg)">
            <div class="section-header">
              <div class="section-title">${t('gallery')}</div>
              <div class="section-link" onclick="window._navigate('gallery')">${svgIcon('plus', 14)} Adicionar</div>
            </div>
            <div id="profile-gallery-preview" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;border-radius:var(--radius-md);overflow:hidden;margin-top:var(--space-sm)">
              <div style="aspect-ratio:1;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.5rem" onclick="window._navigate('gallery')">📷</div>
            </div>
          </div>

          <!-- Actions -->
          <div style="display:flex;flex-direction:column;gap:var(--space-sm)">
            <button class="btn btn-ghost" onclick="window._boostProfile()" style="justify-content:flex-start;border:1px solid rgba(124,60,255,0.3)">
              🚀 Boost de perfil — ${SPARKS_COSTS.boost1h} ✨ (1h)
              ${profile?.boostedUntil && new Date(profile.boostedUntil?.toDate?.() || profile.boostedUntil) > new Date() ? `<span style="margin-left:auto;font-size:0.75rem;color:var(--accent)">Ativo</span>` : ''}
            </button>
            <button class="btn btn-ghost" onclick="window._enableNotifications()" style="justify-content:flex-start">
              🔔 Ativar notificações
            </button>
            <button class="btn btn-ghost" onclick="window._navigate('settings')" style="justify-content:flex-start">
              ${svgIcon('settings', 18)} ${t('settings')}
            </button>
            <button class="btn btn-ghost" style="color:var(--danger);justify-content:flex-start" onclick="window._logout()">
              🚪 ${t('logout')}
            </button>
          </div>
        </div>

      </div>
    </div>
    </div>
    ${renderBottomNav('profile')}
  `;
}

// ─── DISCOVER PAGE ────────────────────────────────────────
function renderDiscoverPage() {
  const sparks = VeloraState.currentUser?.profile?.sparks || 0;
  const profiles = VeloraState.profiles;
  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding:0 0 100px">

      <!-- ── Hero com search ── -->
      <div class="page-hero">
        <div class="page-hero-eyebrow">🔍 Explorar</div>
        <h1 class="page-hero-title">${t('discover')}</h1>
        <p class="page-hero-sub" id="presence-count">Buscando pessoas próximas...</p>
        <div class="discover-hero-search">
          ${svgIcon('discover', 18)}
          <input id="discover-search-input" type="text" placeholder="Nome, interesse, cidade...">
          <button class="btn btn-ghost btn-sm" style="padding:4px 10px;border-radius:var(--radius-md)" onclick="window._openFilters()">
            ${svgIcon('filter', 16)}
          </button>
        </div>
      </div>

      <!-- Radar de presença -->
      <div id="presence-radar" style="height:4px;background:linear-gradient(90deg,var(--primary),var(--accent));opacity:0.4;margin:0"></div>

      <!-- Profile grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:var(--space-md) var(--space-lg)">
        ${profiles.map(p => {
          const online = isUserOnline(p);
          return `
          <div class="card card-hover" style="cursor:pointer;position:relative;overflow:hidden" onclick="window._viewProfile('${p.uid}')">
            <img src="${p.photoURL || defaultAvatar(p.displayName)}" style="width:100%;aspect-ratio:3/4;object-fit:cover" alt="${p.displayName}" loading="lazy">
            <div style="position:absolute;bottom:0;left:0;right:0;padding:var(--space-sm);background:linear-gradient(transparent,rgba(5,5,16,0.95))">
              <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">${p.displayName?.split(' ')[0]}, ${p.age}</div>
              <div style="font-size:0.75rem;color:var(--primary)">${svgIcon('location', 12)} ${p.kmAway} km</div>
            </div>
            ${p.verified ? `<div style="position:absolute;top:8px;right:8px"><span class="badge badge-verified">✓</span></div>` : ''}
            <div style="position:absolute;top:8px;left:8px">
              <div style="width:9px;height:9px;background:${online ? 'var(--success)' : 'rgba(255,255,255,0.25)'};border-radius:50%;box-shadow:${online ? '0 0 8px var(--success)' : 'none'};border:${online ? 'none' : '1.5px solid rgba(255,255,255,0.3)'}"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    ${renderBottomNav('discover')}
  `;
}

// ─── EDIT PROFILE MODAL ───────────────────────────────────
function renderEditProfileModal() {
  const user    = VeloraState.currentUser;
  const profile = user?.profile || {};
  const selectedGender = window._editSelectedGender || profile.gender || '';
  const savedLangs     = window._editSelectedLanguages || profile.languages || [];
  const savedLooking   = profile.lookingFor || [];
  const bioLen         = (profile.bio || '').length;

  const INTERESTS = [
    'Música','Viagens','Esportes','Filmes','Culinária','Arte',
    'Tecnologia','Leitura','Fotografia','Dança','Gaming','Natureza',
    'Fitness','Yoga','Meditação','Cinema','Gastronomia','Idiomas',
  ];
  const LANG_OPTIONS = [
    { code: 'pt-BR', flag: '🇧🇷', name: 'Português' },
    { code: 'en',    flag: '🇺🇸', name: 'Inglês' },
    { code: 'es',    flag: '🇪🇸', name: 'Espanhol' },
    { code: 'fr',    flag: '🇫🇷', name: 'Francês' },
    { code: 'de',    flag: '🇩🇪', name: 'Alemão' },
    { code: 'it',    flag: '🇮🇹', name: 'Italiano' },
  ];

  const completionFields = [
    !!profile.displayName, !!profile.bio, !!profile.photoURL,
    !!profile.age, !!profile.gender, !!(profile.interests?.length >= 3),
    !!profile.city, !!(profile.languages?.length),
  ];
  const completionPct = Math.round(completionFields.filter(Boolean).length / completionFields.length * 100);

  return `
    <div style="display:flex;flex-direction:column;width:100%;min-height:0;flex:1;background:var(--bg-deep);overflow:hidden">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid rgba(247,201,72,0.14);flex-shrink:0;background:var(--bg-card)">
        <button onclick="document.querySelector('.modal-overlay')?.remove()"
          style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);cursor:pointer;color:var(--text-secondary);font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
        <div style="display:flex;align-items:center;gap:10px">
          <h3 style="font-family:var(--font-display);font-size:1.1rem;font-weight:800;margin:0">Editar Perfil</h3>
          <span style="font-size:0.7rem;font-weight:700;padding:3px 8px;border-radius:20px;background:rgba(247,201,72,0.12);color:var(--primary);border:1px solid rgba(247,201,72,0.25)">${completionPct}% completo</span>
        </div>
        <button class="btn btn-primary btn-sm" id="edit-save-btn" onclick="window._saveEditProfile()">
          <span class="btn-text">Salvar</span>
        </button>
      </div>

      <!-- Body -->
      <div style="flex:1;min-height:0;display:flex;overflow:hidden">

        <!-- LEFT: Preview panel (desktop) -->
        <div class="edit-profile-left" style="width:290px;flex-shrink:0;flex-direction:column;align-items:center;padding:24px 18px;gap:14px;background:linear-gradient(160deg,rgba(247,201,72,0.07) 0%,rgba(99,102,241,0.05) 100%);border-right:1px solid rgba(247,201,72,0.12);overflow-y:auto">

          <!-- Avatar + upload -->
          <div style="position:relative;flex-shrink:0">
            <div style="width:120px;height:120px;border-radius:50%;overflow:hidden;border:3px solid var(--primary);background:var(--bg-surface);box-shadow:0 0 0 6px rgba(247,201,72,0.08),0 8px 32px rgba(0,0,0,0.4)">
              <img id="edit-avatar-img" src="${profile.photoURL || defaultAvatar(profile.displayName || '?')}" style="width:100%;height:100%;object-fit:cover" alt="">
            </div>
            <label for="edit-photo-input" style="position:absolute;bottom:2px;right:2px;width:36px;height:36px;border-radius:50%;background:var(--grad-primary);display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 12px rgba(247,201,72,0.5);border:2.5px solid var(--bg-deep)" title="Alterar foto de perfil">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
              <input type="file" id="edit-photo-input" accept="image/*" style="display:none" onchange="window._editPhotoPreview(event)">
            </label>
          </div>
          <p style="font-size:0.7rem;color:var(--text-muted);margin:0;text-align:center">Toque no ícone para alterar foto</p>

          <!-- Name/info preview -->
          <div style="text-align:center">
            <div style="font-family:var(--font-display);font-weight:800;font-size:1.05rem;color:var(--text-primary)">${profile.displayName || 'Seu nome'}</div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:3px;line-height:1.5">
              ${[profile.age ? profile.age + ' anos' : '', profile.gender, profile.city ? '📍 ' + profile.city : ''].filter(Boolean).join(' · ')}
            </div>
          </div>

          ${profile.bio ? `<div style="font-size:0.76rem;color:var(--text-muted);text-align:center;line-height:1.55;max-width:230px;font-style:italic">"${profile.bio.replace(/</g,'&lt;')}"</div>` : ''}

          <!-- Completion bar -->
          <div style="width:100%">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
              <span style="font-size:0.68rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Perfil</span>
              <span style="font-size:0.78rem;color:var(--primary);font-weight:800">${completionPct}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${completionPct}%"></div></div>
            <p style="font-size:0.68rem;color:${completionPct === 100 ? 'var(--primary)' : 'var(--text-muted)'};margin:5px 0 0;text-align:center">
              ${completionPct === 100 ? '✓ Perfil completo!' : 'Complete para mais matches'}
            </p>
          </div>

          <!-- Velora Score -->
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:rgba(247,201,72,0.06);border:1px solid rgba(247,201,72,0.15);border-radius:12px;width:100%;box-sizing:border-box">
            ${veloraScoreRing(profile.veloraScore || 75, 38)}
            <div>
              <div style="font-size:0.68rem;color:var(--text-muted);font-weight:700;text-transform:uppercase;letter-spacing:0.06em">Velora Score</div>
              <div style="font-size:1.05rem;font-weight:900;color:var(--primary)">${profile.veloraScore || 75} pts</div>
            </div>
          </div>

          <!-- Gallery -->
          <div style="width:100%">
            <div style="font-size:0.68rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">📸 Galeria de fotos</div>
            <div id="edit-gallery-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:5px">
              <label style="aspect-ratio:1;border:2px dashed rgba(247,201,72,0.28);border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(247,201,72,0.04)" title="Adicionar foto">
                <input type="file" accept="image/*" style="display:none" onchange="window._uploadGalleryPhotoInEdit(event)">
                <span style="font-size:1.3rem;color:var(--primary)">+</span>
              </label>
            </div>
            <p style="font-size:0.68rem;color:var(--text-muted);margin:5px 0 0;text-align:center">Mais fotos = mais matches</p>
          </div>
        </div>

        <!-- RIGHT: Form fields -->
        <div style="flex:1;overflow-y:auto;padding:20px 24px 48px" class="edit-profile-right">

          <!-- § Informações Básicas -->
          <div style="font-size:0.7rem;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:0.1em;margin-bottom:14px;display:flex;align-items:center;gap:8px">
            Informações Básicas
            <div style="flex:1;height:1px;background:rgba(247,201,72,0.18)"></div>
          </div>

          <div class="input-group">
            <label class="input-label">Nome completo</label>
            <input class="input-field" id="edit-name" value="${(profile.displayName || '').replace(/"/g,'&quot;')}" placeholder="Seu nome" maxlength="40">
          </div>

          <div class="input-group">
            <label class="input-label" style="display:flex;justify-content:space-between;align-items:center">
              <span>Bio</span>
              <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem"><span id="bio-counter">${bioLen}</span>/150</span>
            </label>
            <textarea class="input-field" id="edit-bio" rows="3" maxlength="150"
              placeholder="Fale sobre você de forma autêntica..."
              style="resize:none;height:84px;font-family:inherit;line-height:1.5"
              oninput="document.getElementById('bio-counter').textContent=this.value.length">${(profile.bio || '').replace(/</g,'&lt;')}</textarea>
            <p style="font-size:0.7rem;color:var(--text-muted);margin:3px 0 0">Perfis com bio recebem 3× mais conexões</p>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="input-group" style="margin-bottom:0">
              <label class="input-label">Idade</label>
              <input class="input-field" id="edit-age" type="number" min="18" max="99" value="${profile.age || ''}" placeholder="Ex: 25">
            </div>
            <div class="input-group" style="margin-bottom:0">
              <label class="input-label">Cidade</label>
              <input class="input-field" id="edit-city" value="${(profile.city || '').replace(/"/g,'&quot;')}" placeholder="Ex: São Paulo">
            </div>
          </div>

          <!-- § O que você procura -->
          <div style="font-size:0.7rem;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:0.1em;margin:20px 0 14px;display:flex;align-items:center;gap:8px">
            O que você procura
            <div style="flex:1;height:1px;background:rgba(247,201,72,0.18)"></div>
          </div>

          <div class="input-group">
            <label class="input-label">Tipo de conexão <span style="font-weight:400;color:var(--text-muted);text-transform:none;letter-spacing:0">(selecione quantos quiser)</span></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              ${[
                { v: 'dating',     label: '💕 Relacionamento' },
                { v: 'friendship', label: '🤝 Amizade' },
                { v: 'casual',     label: '🌊 Casual' },
                { v: 'networking', label: '💼 Networking' },
              ].map(opt => `
                <button type="button" class="btn btn-sm ${savedLooking.includes(opt.v) ? 'btn-primary' : 'btn-ghost'}"
                  data-looking="${opt.v}" onclick="window._editToggleLooking('${opt.v}',this)"
                  style="justify-content:flex-start;gap:6px;font-size:0.82rem">${opt.label}</button>
              `).join('')}
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
            <div class="input-group" style="margin-bottom:0">
              <label class="input-label">Idade mínima</label>
              <input class="input-field" id="edit-age-min" type="number" min="18" max="99" value="${profile.ageMin || 18}">
            </div>
            <div class="input-group" style="margin-bottom:0">
              <label class="input-label">Idade máxima</label>
              <input class="input-field" id="edit-age-max" type="number" min="18" max="99" value="${profile.ageMax || 50}">
            </div>
          </div>

          <!-- § Identidade -->
          <div style="font-size:0.7rem;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:0.1em;margin:20px 0 14px;display:flex;align-items:center;gap:8px">
            Identidade
            <div style="flex:1;height:1px;background:rgba(247,201,72,0.18)"></div>
          </div>

          <div class="input-group">
            <label class="input-label">Gênero</label>
            <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px" id="edit-gender-grid">
              ${[
                { g: 'Homem',       icon: '♂' },
                { g: 'Mulher',      icon: '♀' },
                { g: 'Não-binário', icon: '⚧' },
                { g: 'Outro',       icon: '◎' },
              ].map(({ g, icon }) => `
                <button type="button" class="btn btn-sm ${selectedGender === g ? 'btn-primary' : 'btn-ghost'}"
                  data-gender="${g}" onclick="window._editSelectGender('${g}')"
                  style="justify-content:center;gap:5px">${icon} ${g}</button>
              `).join('')}
            </div>
          </div>

          <!-- § Interesses -->
          <div style="font-size:0.7rem;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:0.1em;margin:20px 0 14px;display:flex;align-items:center;gap:8px">
            Interesses
            <div style="flex:1;height:1px;background:rgba(247,201,72,0.18)"></div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:8px" id="edit-interests-wrap">
            ${INTERESTS.map(i => `
              <span class="chip ${(profile.interests || []).includes(i) ? 'active' : ''}"
                data-interest="${i}" onclick="this.classList.toggle('active')">${i}</span>
            `).join('')}
          </div>
          <p style="font-size:0.7rem;color:var(--text-muted);margin:8px 0 0">Selecione ao menos 3 para melhores matches</p>

          <!-- § Idiomas -->
          <div style="font-size:0.7rem;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:0.1em;margin:20px 0 14px;display:flex;align-items:center;gap:8px">
            Idiomas que você fala
            <div style="flex:1;height:1px;background:rgba(247,201,72,0.18)"></div>
          </div>

          <div style="display:flex;flex-wrap:wrap;gap:8px" id="edit-langs-wrap">
            ${LANG_OPTIONS.map(l => `
              <span class="chip ${savedLangs.includes(l.code) ? 'active' : ''}"
                data-lang="${l.code}" onclick="this.classList.toggle('active')">${l.flag} ${l.name}</span>
            `).join('')}
          </div>

        </div>
      </div>
    </div>
  `;
}

// ─── SETTINGS PAGE ────────────────────────────────────────
function renderSettings() {
  const profile = VeloraState.currentUser?.profile;
  const notifOn = profile?.notifications !== false;
  return `
    <div style="min-height:100vh;background:var(--bg-deep);padding-bottom:40px">
      <div class="top-header" style="justify-content:space-between">
        <button class="btn-icon btn-ghost" onclick="window._navigate('profile')">${svgIcon('back', 20)}</button>
        <span style="font-family:var(--font-display);font-weight:700">${t('settings')}</span>
        <div></div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Conta</div>
        <div class="settings-item" onclick="window._editProfile()">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(0,245,212,0.1)">👤</div>
            <div>
              <div class="settings-item-title">${t('editProfile')}</div>
              <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">${profile?.displayName || 'Usuário'}</div>
            </div>
          </div>
          <span style="color:var(--text-muted)">›</span>
        </div>
        <div class="settings-item" onclick="window._navigate('store')">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(247,201,72,0.1)">✨</div>
            <div class="settings-item-title">Loja de Sparks</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge badge-gold">${profile?.sparks || 0} ✨</span>
            <span style="color:var(--text-muted)">›</span>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Preferências</div>
        <div class="settings-item">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(255,43,214,0.1)">🔞</div>
            <div>
              <div class="settings-item-title">${t('adultMode')}</div>
              <div class="settings-item-sub">Ver conteúdo adulto</div>
            </div>
          </div>
          <label class="toggle-switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="settings-adult" ${profile?.isAdult ? 'checked' : ''}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
        <div class="settings-item">
          <div class="settings-item-left">
            <div class="settings-icon" style="background:rgba(0,245,212,0.1)">🔔</div>
            <div class="settings-item-title">${t('notifications')}</div>
          </div>
          <label class="toggle-switch" onclick="event.stopPropagation()">
            <input type="checkbox" id="settings-notifications" ${notifOn ? 'checked' : ''}>
            <div class="toggle-track"></div>
            <div class="toggle-thumb"></div>
          </label>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section-title">Idioma</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 var(--space-lg)">
          ${Object.entries(LANGUAGES).map(([code, info]) => `
            <button class="btn ${i18n.getCurrentLang() === code ? 'btn-primary' : 'btn-ghost'}"
              style="justify-content:flex-start;gap:8px;font-size:0.85rem"
              onclick="window._setLanguage('${code}')">
              ${info.flag} ${info.name}
            </button>
          `).join('')}
        </div>
      </div>

      <div style="padding:var(--space-lg)">
        <button class="btn btn-ghost btn-w-full" style="color:var(--danger);margin-bottom:var(--space-sm)" onclick="window._confirmDeleteAccount()">
          ${svgIcon('trash', 18)} ${t('deleteAccount')}
        </button>
        <button class="btn btn-ghost btn-w-full" onclick="window._logout()">
          🚪 ${t('logout')}
        </button>
      </div>
    </div>
  `;
}

function getLevelName(level) {
  const names = { 1: 'Novo Membro', 2: 'Explorador', 3: 'Conectado', 4: 'Popular', 5: 'Estrela', 6: 'VIP', 7: 'Lendário' };
  return names[Math.min(level, 7)] || 'Lendário';
}

// ─── EVENT HANDLERS (Global) ──────────────────────────────
function setupGlobalHandlers() {

  // Páginas principais do bottom nav — não entram no stack de voltar
  const ROOT_PAGES = new Set(['home', 'discover', 'feed', 'matches', 'profile', 'login', 'register', 'splash', 'onboarding']);

  window._navigate = async (page, data = {}) => {
    // Empurra a página atual no stack apenas se for sub-página (não raiz)
    if (!ROOT_PAGES.has(page) && VeloraState.currentPage && !ROOT_PAGES.has(VeloraState.currentPage)) {
      VeloraState.navStack.push(VeloraState.currentPage);
    } else if (!ROOT_PAGES.has(page)) {
      VeloraState.navStack = [VeloraState.currentPage];
    } else {
      VeloraState.navStack = [];
    }
    VeloraState.currentPage = page;

    // Limpa subscriptions ao navegar
    if (VeloraState.chatUnsub) {
      VeloraState.chatUnsub();
      VeloraState.chatUnsub = null;
    }
    if (page !== 'matches' && VeloraState.matchesUnsub) {
      VeloraState.matchesUnsub();
      VeloraState.matchesUnsub = null;
    }
    if (page !== 'feed' && VeloraState._feedUnsub) {
      VeloraState._feedUnsub();
      VeloraState._feedUnsub = null;
    }
    switch (page) {
      case 'splash':    showPage('splash', data); break;
      case 'onboarding': showPage('onboarding', data); break;
      case 'login':     showPage('login', data); break;
      case 'register':  showPage('register', data); break;
      case 'home':      VeloraState.currentCardIdx = 0; await loadAndShowHome(); break;
      case 'discover':  showPage('discover', data); break;
      case 'feed':      showPage('feed', data); break;
      case 'matches':   showPage('matches', data); break;
      case 'profile':   showPage('profile', data); break;
      case 'settings':  showPage('settings', data); break;
      case 'store':     showPage('store', data); break;
      case 'gallery':   showPage('gallery', data); break;
      default: break;
    }
  };

  window._navBack = () => {
    const prev = VeloraState.navStack.pop();
    if (prev) {
      VeloraState.currentPage = prev;
      window._navigate(prev);
    } else {
      // Fallback: sub-páginas voltam para o perfil
      window._navigate('profile');
    }
  };

  window._logout = async () => {
    await logoutUser();
    VeloraState.currentUser = null;
    VeloraState.matchCount = 0;
    showPage('splash');
    setTimeout(() => showPage('login'), 1500);
  };

  window._showLangPicker = () => {
    const modal = showModal(`
      <div class="modal-body">
        <h3 class="text-xl font-bold mb-lg">${t('language')}</h3>
        <div class="flex-col gap-sm">
          ${Object.entries(LANGUAGES).map(([code, info]) => `
            <button class="settings-item glass-hover" style="border-radius:var(--radius-md);padding:14px 16px;text-align:left" onclick="window._setLanguage('${code}');document.querySelector('.modal-overlay')?.remove()">
              <div style="display:flex;align-items:center;gap:12px">
                <span style="font-size:1.4rem">${info.flag}</span>
                <span style="font-family:var(--font-display);font-weight:600">${info.name}</span>
                ${i18n.getCurrentLang() === code ? `<span class="badge badge-primary" style="margin-left:auto">✓</span>` : ''}
              </div>
            </button>
          `).join('')}
        </div>
      </div>
    `);
  };

  window._setLanguage = (lang) => {
    i18n.setLanguage(lang);
    const current = document.querySelector('.page');
    if (current) {
      const pageId = current.id.replace('page-', '');
      window._navigate(pageId);
    }
  };

  window._showForgotPassword = () => {
    showModal(`
      <div class="modal-body">
        <h3 class="text-xl font-bold mb-md">Recuperar senha</h3>
        <div class="input-group mb-lg">
          <label class="input-label">E-mail</label>
          <input type="email" id="forgot-email" class="input-field" placeholder="seu@email.com">
        </div>
        <button class="btn btn-primary btn-w-full" onclick="window._sendReset()">Enviar link</button>
      </div>
    `, { centered: true });
  };

  window._sendReset = async () => {
    const email = document.getElementById('forgot-email')?.value;
    if (!email) return;
    const { resetPassword } = await import('./auth.js');
    const res = await resetPassword(email);
    if (res.success) showToast('Link de recuperação enviado! Verifique seu e-mail.', 'success');
    else showToast(res.error, 'error');
    document.querySelector('.modal-overlay')?.remove();
  };

  // ── TikTok action handler ────────────────────────────────
  window._tiktokAction = async (action) => {
    const feed = document.getElementById('tiktok-feed');
    if (!feed) return;
    const slides = [...feed.querySelectorAll('.tiktok-slide:not(.tiktok-slide-end)')];
    const idx = VeloraState.currentCardIdx;
    const profile = VeloraState.profiles[idx];
    if (!profile) return;

    const uid = VeloraState.currentUser?.uid;
    const btn = document.querySelector(`.tiktok-btn-${action === 'like' ? 'like' : action === 'pass' ? 'pass' : 'super'}`);

    // Feedback visual no botão
    if (btn) {
      btn.style.transform = 'scale(0.82)';
      setTimeout(() => { if (btn) btn.style.transform = ''; }, 200);
    }

    // Avança idx
    VeloraState.currentCardIdx = Math.min(idx + 1, VeloraState.profiles.length);

    // Atualiza HUD e dots
    const prog = document.getElementById('tiktok-progress');
    if (prog) prog.textContent = `${VeloraState.currentCardIdx + 1} / ${VeloraState.profiles.length}`;
    document.querySelectorAll('.tiktok-dot').forEach((d, i) => d.classList.toggle('active', i === VeloraState.currentCardIdx));

    // Rola para o próximo slide
    const nextSlide = slides[idx + 1] || feed.querySelector('.tiktok-slide-end');
    if (nextSlide) nextSlide.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Registra o swipe no Firestore
    if (uid && action !== 'pass') {
      try {
        const result = await recordSwipe(uid, profile.uid, action === 'superlike' ? 'superlike' : 'like');
        if (result?.matched) {
          analytics.logMatch(result.matchId);
          const myPhoto = VeloraState.currentUser?.profile?.photoURL;
          setTimeout(() => {
            showMatchPopup(myPhoto, profile.photoURL, profile.displayName,
              () => window._openChat(result.matchId, profile.uid),
              () => {}
            );
          }, 500);
        }
      } catch { /* demo / sem conexão */ }
    } else if (uid && action === 'pass') {
      try { await recordSwipe(uid, profile.uid, 'pass'); } catch { }
    }

    analytics.logSwipe(action, profile.uid);
  };

  window._triggerLike = () => {
    VeloraState.swipeEngine?.triggerLike();
  };
  window._triggerPass = () => {
    VeloraState.swipeEngine?.triggerPass();
  };
  window._triggerSuperlike = async () => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) { VeloraState.swipeEngine?.triggerSuperLike(); return; }
    const cost = SPARKS_COSTS.superLike;
    try {
      await deductSparks(uid, cost, 'Super Like');
      analytics.logSuperLike(VeloraState.profiles[VeloraState.currentCardIdx]?.uid || '');
      VeloraState.swipeEngine?.triggerSuperLike();
    } catch {
      showModal(`
        <div style="padding:24px;text-align:center;max-width:320px">
          <div style="font-size:2.5rem;margin-bottom:12px">⭐</div>
          <h3 style="font-family:var(--font-display);font-weight:800;margin-bottom:8px">Super Like</h3>
          <p style="color:var(--text-muted);font-size:0.9rem;margin-bottom:20px">Você precisa de ${cost} ✨ Sparks para enviar um Super Like.</p>
          <button class="btn btn-primary btn-w-full" onclick="document.querySelector('.modal-overlay')?.remove();window._navigate('store')">Comprar Sparks ✨</button>
          <button class="btn btn-ghost btn-w-full mt-sm" onclick="document.querySelector('.modal-overlay')?.remove()">Cancelar</button>
        </div>
      `, { centered: true });
    }
  };

  window._rewindSwipe = async () => {
    const uid = VeloraState.currentUser?.uid;
    const cost = SPARKS_COSTS.rewind;
    if (!uid) { showToast(`Desfazer requer ${cost} ✨ Sparks`, 'gold'); return; }
    try {
      await deductSparks(uid, cost, 'Desfazer swipe');
      if (VeloraState.currentCardIdx > 0) {
        VeloraState.currentCardIdx--;
        loadAndShowHome();
      }
      showToast('Swipe desfeito! ↩️', 'success');
    } catch { /* insufficient sparks — already shows toast */ }
  };

  // ─── Boost de perfil ──────────────────────────────────────
  window._boostProfile = async () => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const cost = SPARKS_COSTS.boost1h;
    try {
      await deductSparks(uid, cost, 'Boost de perfil 1h');
      const boostedUntil = new Date(Date.now() + 60 * 60 * 1000);
      await updateDoc(doc(db, 'users', uid), { boostedUntil });
      if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.boostedUntil = boostedUntil;
      analytics.logBoost(1);
      showToast('🚀 Perfil impulsionado por 1 hora!', 'gold');
      showPage('profile');
    } catch { /* insufficient sparks */ }
  };

  // ─── Stories ──────────────────────────────────────────────
  window._addStory = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const uid = VeloraState.currentUser?.uid;
      if (!uid) { showToast('Faça login para publicar um story', 'error'); return; }
      try {
        showToast('Publicando story...', 'info');
        await addStory(uid, file);
        analytics.logStoryPost();
        loadAndShowHome();
      } catch (err) {
        showToast('Erro ao publicar story: ' + (err.message || 'tente novamente'), 'error');
      }
    };
    input.click();
  };

  window._viewStory = async (storyId) => {
    const uid = VeloraState.currentUser?.uid;
    const stories = await getActiveStories();
    const story = stories.find(s => s.id === storyId);
    if (!story) return;
    showModal(renderStoryViewer(story, uid || ''), { centered: true });
    if (uid) viewStory(storyId, uid).catch(() => {});
    analytics.logStoryView(storyId, story.uid);
  };

  window._reactStory = async (storyId, emoji) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    await reactToStory(storyId, uid, emoji);
    document.querySelector('.modal-overlay')?.remove();
  };

  window._deleteStory = async (storyId) => {
    const confirmed = await showConfirm('Excluir story', 'Tem certeza que deseja excluir este story?', 'Excluir');
    if (confirmed) { await deleteStory(storyId); document.querySelector('.modal-overlay')?.remove(); loadAndShowHome(); }
  };

  // ─── Moderação ────────────────────────────────────────────
  window._blockUser = async (targetUid, targetName) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const confirmed = await showConfirm('Bloquear usuário', `Bloquear ${targetName}? Ele não aparecerá mais para você.`, 'Bloquear');
    if (!confirmed) return;
    await blockUser(uid, targetUid);
    analytics.logBlock();
    document.querySelector('.modal-overlay')?.remove();
  };

  window._reportUser = (targetUid, targetName) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    showModal(renderReportModal(uid, targetUid, targetName), { centered: true });
  };

  window._submitReport = async () => {
    const btn = document.getElementById('report-submit-btn');
    const currentUid = btn?.dataset.current;
    const targetUid  = btn?.dataset.target;
    if (!currentUid || !targetUid) return;
    const reason = document.querySelector('input[name="report-reason"]:checked')?.value || 'other';
    await reportUser(currentUid, targetUid, reason);
    analytics.logReport(reason);
    document.querySelector('.modal-overlay')?.remove();
    await blockUser(currentUid, targetUid);
  };

  // Wire up report submit button after modal renders
  document.addEventListener('click', (e) => {
    if (e.target?.id === 'report-submit-btn') window._submitReport();
  });

  // ─── Verificação de e-mail ────────────────────────────────
  window._resendVerification = async () => {
    const res = await resendEmailVerification();
    if (res.success) showToast('E-mail de verificação reenviado! Verifique sua caixa de entrada.', 'success');
    else showToast(res.error, 'error');
  };

  // ─── Notificações ─────────────────────────────────────────
  window._enableNotifications = async () => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const granted = await requestNotificationPermission(uid);
    if (granted) showToast('Notificações ativadas! 🔔', 'success');
    else showToast('Permissão de notificações negada.', 'info');
  };

  window._unmatch = async (matchId, name) => {
    const confirmed = await showConfirm(
      t('unmatch'),
      t('unmatchConfirm', { name }),
      t('unmatchYes')
    );
    if (confirmed) {
      await unmatch(matchId);
      window._navigate('matches');
    }
  };

  window._openFilters = () => showToast(t('comingSoon') || 'Filtros em breve!', 'info');

  window._openChat = (convId, otherId) => {
    if (VeloraState.chatUnsub) {
      VeloraState.chatUnsub();
      VeloraState.chatUnsub = null;
    }
    VeloraState.navStack = [VeloraState.currentPage || 'matches'];
    VeloraState.currentPage = 'chat';
    VeloraState.activeConvId = convId;
    showPage('chat', { convId, otherId });
  };

  window._purchaseSparks = async (pkgId) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) { showToast('Faça login para comprar Sparks', 'error'); return; }

    const pkg = SPARKS_PACKAGES.find(p => p.id === pkgId);
    if (!pkg) return;

    // Se o link do Stripe estiver configurado, redireciona para o checkout.
    // client_reference_id=uid é o que permite à Cloud Function `stripeWebhook`
    // saber quem creditar quando o pagamento for confirmado pelo Stripe.
    if (pkg.stripeLink) {
      window.location.href = buildStripeCheckoutUrl(pkg, uid);
      return;
    }

    // Sem link do Stripe configurado: não há como cobrar de verdade, então
    // não há crédito "demo" — as regras do Firestore bloqueiam o cliente de
    // aumentar o próprio saldo. Avisa em vez de tentar (e falhar) um crédito direto.
    showToast('Este pacote ainda não tem checkout configurado.', 'error');
  };

  window._galleryPhotoClick = async (photoId) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const photos = await getUserGallery(uid).catch(() => []);
    const photo  = photos.find(p => p.id === photoId);
    if (!photo) return;
    showModal(`
      <div>
        <img src="${photo.url}" style="width:100%;max-height:70vh;object-fit:contain;background:#000">
        <div class="modal-body">
          <div class="flex-between">
            <label class="toggle-switch" style="gap:10px;align-items:center">
              <input type="checkbox" ${photo.isLocked ? 'checked' : ''} id="photo-lock-toggle">
              <div class="toggle-track"></div>
              <div class="toggle-thumb"></div>
              <span style="font-size:0.9rem">${photo.isLocked ? '🔒 Bloqueada' : '🌐 Pública'}</span>
            </label>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)"
              onclick="window._deletePhoto('${photo.id}')">🗑️</button>
          </div>
        </div>
      </div>
    `);
    setTimeout(() => {
      document.getElementById('photo-lock-toggle')?.addEventListener('change', async (e) => {
        await togglePhotoLock(uid, photoId, e.target.checked);
      });
    }, 100);
  };

  window._deletePhoto = async (photoId) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    await deletePhoto(uid, photoId).catch(() => {});
    document.querySelector('.modal-overlay')?.remove();
    window._navigate('gallery');
  };

  window._handleGalleryUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    const uid = VeloraState.currentUser?.uid;
    if (!uid) { showToast('Faça login para adicionar fotos', 'error'); return; }

    const progressEl = document.getElementById('gallery-upload-progress');
    const contentEl  = document.getElementById('gallery-content');
    if (progressEl) { progressEl.style.display = 'block'; progressEl.textContent = 'Enviando... 0%'; }
    if (contentEl)  { contentEl.style.opacity = '0.4'; }

    try {
      await uploadPhoto(uid, file, false, (pct) => {
        if (progressEl) progressEl.textContent = `Enviando... ${pct < 100 ? Math.round(pct) + '%' : '100% — salvando...'}`;
      });
      if (progressEl) progressEl.style.display = 'none';
      if (contentEl)  contentEl.style.opacity = '1';
      showToast('Foto adicionada!', 'success');
      // Reload gallery content in-place — avoid full page re-render
      if (contentEl) {
        contentEl.innerHTML = `<div class="flex-center" style="height:120px;color:var(--text-muted);font-size:0.9rem">Atualizando...</div>`;
        const photos = await getUserGallery(uid).catch(() => []);
        const emptyHTML = `<div class="empty-state"><div class="empty-state-icon">📷</div><p class="empty-state-title">Nenhuma foto ainda</p><p class="empty-state-desc" style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">Toque em + para adicionar!</p></div>`;
        contentEl.innerHTML = photos.length ? renderGalleryGrid(photos, uid, uid) : emptyHTML;
      }
    } catch (err) {
      if (progressEl) progressEl.style.display = 'none';
      if (contentEl)  contentEl.style.opacity = '1';
      showToast('Erro ao enviar: ' + (err.message || 'tente novamente'), 'error');
    }
  };

  window._editProfile = async () => {
    window._editSelectedGender    = VeloraState.currentUser?.profile?.gender || '';
    window._editSelectedLanguages = [...(VeloraState.currentUser?.profile?.languages || [])];
    window._editPhotoFile = null;
    showModal(renderEditProfileModal(), { fullscreen: true });
    // Load existing gallery photos asynchronously after modal is shown
    const uid = VeloraState.currentUser?.uid;
    if (uid) {
      try {
        const photos = await getUserGallery(uid);
        const grid = document.getElementById('edit-gallery-grid');
        if (grid && photos.length) {
          const addLabel = grid.querySelector('label');
          const thumbsHTML = photos.slice(0, 5).map(p =>
            `<div style="aspect-ratio:1;border-radius:8px;overflow:hidden"><img src="${p.url}" style="width:100%;height:100%;object-fit:cover" alt=""></div>`
          ).join('');
          if (addLabel) addLabel.insertAdjacentHTML('beforebegin', thumbsHTML);
        }
      } catch { /* non-critical */ }
    }
  };

  window._editSelectGender = (gender) => {
    window._editSelectedGender = gender;
    document.querySelectorAll('#edit-gender-grid button').forEach(b => {
      b.className = `btn btn-sm ${b.dataset.gender === gender ? 'btn-primary' : 'btn-ghost'}`;
    });
  };

  window._editPhotoPreview = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    window._editPhotoFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = document.getElementById('edit-avatar-img');
      if (img) img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  window._editToggleLooking = (value, btn) => {
    const wasPrimary = btn.classList.contains('btn-primary');
    btn.className = `btn btn-sm ${wasPrimary ? 'btn-ghost' : 'btn-primary'}`;
    btn.style.cssText = 'justify-content:flex-start;gap:6px;font-size:0.82rem';
  };

  window._uploadGalleryPhotoInEdit = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const label = event.target.closest('label');
    if (label) label.style.opacity = '0.5';
    try {
      showToast('Enviando foto...', 'info');
      await uploadPhoto(uid, file, false, () => {});
      showToast('Foto adicionada! ✨', 'success');
      const grid = document.getElementById('edit-gallery-grid');
      if (grid) {
        const photos = await getUserGallery(uid);
        const lastPhoto = photos[photos.length - 1];
        if (lastPhoto) {
          const thumb = document.createElement('div');
          thumb.style.cssText = 'aspect-ratio:1;border-radius:8px;overflow:hidden';
          thumb.innerHTML = `<img src="${lastPhoto.url}" style="width:100%;height:100%;object-fit:cover" alt="">`;
          const addLabel = grid.querySelector('label');
          if (addLabel) grid.insertBefore(thumb, addLabel);
        }
      }
    } catch (err) {
      showToast('Erro: ' + (err.message || 'tente novamente'), 'error');
    } finally {
      if (label) { label.style.opacity = '1'; event.target.value = ''; }
    }
  };

  window._saveEditProfile = async () => {
    const uid = VeloraState.currentUser?.uid || auth.currentUser?.uid;
    if (!uid) { showToast('Sessão expirada. Faça login novamente.', 'error'); return; }

    const name   = document.getElementById('edit-name')?.value?.trim();
    const bio    = document.getElementById('edit-bio')?.value?.trim();
    const age    = parseInt(document.getElementById('edit-age')?.value) || undefined;
    const city   = document.getElementById('edit-city')?.value?.trim() || '';
    const ageMin = parseInt(document.getElementById('edit-age-min')?.value) || 18;
    const ageMax = parseInt(document.getElementById('edit-age-max')?.value) || 50;
    const interests = [...document.querySelectorAll('#edit-interests-wrap .chip.active[data-interest]')]
      .map(el => el.dataset.interest);
    const languages = [...document.querySelectorAll('#edit-langs-wrap .chip.active[data-lang]')]
      .map(el => el.dataset.lang);
    const lookingFor = [...document.querySelectorAll('[data-looking].btn-primary')]
      .map(el => el.dataset.looking);

    if (!name) { showToast('Nome é obrigatório', 'error'); return; }
    if (age && (age < 18 || age > 99)) { showToast('Idade inválida (18–99)', 'error'); return; }
    if (ageMin > ageMax) { showToast('Idade mínima maior que máxima', 'error'); return; }

    const saveBtn = document.getElementById('edit-save-btn');
    if (saveBtn) saveBtn.classList.add('btn-loading');

    try {
      let photoURL = VeloraState.currentUser?.profile?.photoURL;
      if (window._editPhotoFile) {
        const { uploadProfilePhoto } = await import('./cloudinary.js?v=8');
        showToast('Enviando foto...', 'info');
        photoURL = await uploadProfilePhoto(uid, window._editPhotoFile);
        window._editPhotoFile = null;
      }

      const updates = {
        displayName: name,
        bio:         bio || '',
        interests,
        languages,
        city,
        ageMin,
        ageMax,
        gender:     window._editSelectedGender || VeloraState.currentUser?.profile?.gender || '',
        lookingFor: lookingFor.length ? lookingFor : (VeloraState.currentUser?.profile?.lookingFor || []),
        ...(age      ? { age }      : {}),
        ...(photoURL ? { photoURL } : {}),
      };

      await updateUserProfile(uid, updates);

      VeloraState.currentUser.profile = { ...VeloraState.currentUser?.profile, ...updates };
      if (photoURL) VeloraState.currentUser.photoURL = photoURL;

      document.querySelector('.modal-overlay')?.remove();
      showToast('Perfil atualizado! ✨', 'success');
      showPage('profile');
    } catch (err) {
      showToast('Erro ao salvar: ' + (err.message || 'tente novamente'), 'error');
    } finally {
      if (saveBtn) saveBtn.classList.remove('btn-loading');
    }
  };

  window._viewProfile = (ownerUid) => {
    const profile = VeloraState.profiles.find(p => p.uid === ownerUid);
    if (!profile) return;
    const viewerUid = VeloraState.currentUser?.uid;
    const safeName  = (profile.displayName || 'Usuário').replace(/'/g, '&#39;');

    showModal(`
      <div style="display:flex;flex-wrap:wrap;width:100%;height:92vh;max-height:92vh;overflow:hidden">

        <!-- COLUNA ESQUERDA: Foto -->
        <div style="width:min(420px,100%);flex-shrink:0;position:relative;background:var(--bg-deep);overflow:hidden;min-height:400px;max-height:92vh">
          <img src="${profile.photoURL || defaultAvatar(profile.displayName)}"
               style="width:100%;height:100%;object-fit:cover;object-position:center 20%;display:block">
          <!-- Gradiente com nome/local -->
          <div style="position:absolute;bottom:0;left:0;right:0;padding:20px 16px 16px;background:linear-gradient(transparent,rgba(5,5,16,0.95))">
            <div style="font-family:var(--font-display);font-size:1.5rem;font-weight:900;color:#fff;line-height:1.1">
              ${profile.displayName?.split(' ')[0]}, ${profile.age}
            </div>
            <div style="color:var(--primary);font-size:0.82rem;margin-top:4px;display:flex;align-items:center;gap:4px">
              ${svgIcon('location', 12)} ${profile.kmAway} km
              ${profile.verified ? ' &nbsp;<span class="badge badge-verified" style="font-size:0.7rem">✓ Verificado</span>' : ''}
            </div>
          </div>
          <!-- Botão fechar -->
          <button onclick="document.querySelector('.modal-overlay')?.remove()"
            style="position:absolute;top:12px;right:12px;width:32px;height:32px;border-radius:50%;background:rgba(5,5,16,0.6);border:none;cursor:pointer;color:#fff;font-size:1rem;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)">✕</button>
        </div>

        <!-- COLUNA DIREITA: Info + Ações -->
        <div style="flex:1;min-width:260px;max-height:92vh;overflow-y:auto;display:flex;flex-direction:column;background:var(--bg-surface)"
             id="view-profile-right-col">

          <!-- Header: Score + nome completo -->
          <div style="padding:20px 20px 0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
            <div>
              <div style="font-family:var(--font-display);font-size:1.2rem;font-weight:800">${profile.displayName}</div>
              <div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px">${profile.lookingFor?.join(' · ') || ''}</div>
            </div>
            ${veloraScoreRing(profile.veloraScore || 75)}
          </div>

          <!-- Bio -->
          <div style="padding:14px 20px 0">
            <p style="color:var(--text-secondary);font-size:0.92rem;line-height:1.5">${profile.bio || ''}</p>
          </div>

          <!-- Interesses -->
          ${profile.interests?.length ? `
          <div style="padding:14px 20px 0">
            <div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-display);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Interesses</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${profile.interests.map(i => `<span class="tag" style="font-size:0.78rem;padding:4px 10px">${i}</span>`).join('')}
            </div>
          </div>` : ''}

          <!-- Galeria -->
          <div id="view-profile-gallery" style="padding:14px 20px 0">
            <div style="font-size:0.72rem;color:var(--text-muted);font-family:var(--font-display);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Galeria</div>
            <div id="view-gallery-grid" style="color:var(--text-muted);font-size:0.82rem">Carregando...</div>
          </div>

          <!-- Spacer -->
          <div style="flex:1;min-height:16px"></div>

          <!-- Ações -->
          <div style="padding:16px 20px 20px;border-top:1px solid var(--glass-border);background:var(--bg-surface);position:sticky;bottom:0">
            <div style="display:flex;gap:10px;margin-bottom:8px">
              <button class="btn btn-ghost" style="flex:1;gap:6px" onclick="window._passProfile('${ownerUid}')">
                ${svgIcon('x', 16)} Passar
              </button>
              <button class="btn btn-primary" style="flex:2;gap:6px" onclick="window._likeProfile('${ownerUid}')">
                ${svgIcon('heart', 16)} Curtir
              </button>
            </div>
            <button class="btn btn-ghost btn-w-full" style="border:1px solid var(--glass-border);gap:8px;font-size:0.88rem"
              onclick="window._sendDirectMessage('${ownerUid}','${safeName}')">
              💬 Mensagem direta
              <span style="color:var(--gold);font-size:0.8rem;margin-left:auto">15 ✨</span>
            </button>
            <div style="display:flex;gap:8px;margin-top:6px">
              <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.78rem;color:var(--text-muted)"
                onclick="window._blockUser('${ownerUid}','${safeName}')">
                🚫 Bloquear
              </button>
              <button class="btn btn-ghost btn-sm" style="flex:1;font-size:0.78rem;color:var(--danger)"
                onclick="window._reportUser('${ownerUid}','${safeName}')">
                ⚠️ Denunciar
              </button>
            </div>
          </div>

        </div>
      </div>
    `, { centered: true, wide: true });

    // Carrega galeria async
    setTimeout(() => {
      const gridEl = document.getElementById('view-gallery-grid');
      if (!gridEl) return;
      getUserGallery(ownerUid).then(photos => {
        if (!gridEl.isConnected) return;
        if (!photos.length) { gridEl.textContent = 'Nenhuma foto ainda.'; return; }
        const PREVIEW = 6;
        const shown = photos.slice(0, PREVIEW);
        const remaining = photos.length - PREVIEW;
        const renderPhoto = (photo, idx) => {
          const unlocked = !photo.isLocked || (photo.unlockedBy || []).includes(viewerUid);
          const isLastVisible = remaining > 0 && idx === PREVIEW - 1;
          return `<div style="aspect-ratio:1;overflow:hidden;cursor:pointer;position:relative;background:var(--bg-card)"
            onclick="${isLastVisible ? `window._viewAllPhotos('${ownerUid}')` : `window._openLightbox('${ownerUid}','${photo.id}')`}">
            <img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;${(!unlocked || isLastVisible) ? 'filter:blur(10px) brightness(0.4)' : ''}" loading="lazy">
            ${isLastVisible ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:1.1rem">+${remaining + 1}</div>` :
              !unlocked ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:0.72rem;gap:2px">
                <span style="font-size:1.1rem">🔒</span><span>✨ ${photo.unlockCost || 5}</span></div>` : ''}
          </div>`;
        };
        gridEl.innerHTML = `
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;border-radius:8px;overflow:hidden">
            ${shown.map((photo, idx) => renderPhoto(photo, idx)).join('')}
          </div>
          ${remaining > 0 ? '' : ''}`;
        gridEl._allPhotos = photos;
      }).catch(() => { if (gridEl.isConnected) gridEl.textContent = ''; });
    }, 100);
  };

  window._likeProfile = async (targetUid) => {
    const viewerUid = VeloraState.currentUser?.uid;
    if (!viewerUid || viewerUid === targetUid) return;
    document.querySelector('.modal-overlay')?.remove();
    try {
      const result = await recordSwipe(viewerUid, targetUid, 'like');
      if (result.matched) {
        const profile = VeloraState.profiles.find(p => p.uid === targetUid);
        showMatchPopup(profile?.photoURL || defaultAvatar(profile?.displayName), result.matchId);
        launchConfetti();
      } else {
        showToast('Like enviado! ❤️', 'success');
      }
    } catch (err) {
      showToast('Erro ao enviar like: ' + (err.message || 'tente novamente'), 'error');
    }
  };

  window._passProfile = async (targetUid) => {
    const viewerUid = VeloraState.currentUser?.uid;
    if (!viewerUid || viewerUid === targetUid) return;
    document.querySelector('.modal-overlay')?.remove();
    try { await recordSwipe(viewerUid, targetUid, 'pass'); } catch { }
  };

  window._viewAllPhotos = (ownerUid) => {
    const viewerUid = VeloraState.currentUser?.uid;
    const gridEl = document.getElementById('view-gallery-grid');
    const photos = gridEl?._allPhotos;
    if (!photos?.length) return;
    showModal(`
      <div style="display:flex;flex-direction:column;width:100%;height:100%">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 24px;border-bottom:1px solid var(--glass-border);flex-shrink:0">
          <span style="font-family:var(--font-display);font-weight:700;font-size:1.1rem">Galeria — ${photos.length} foto${photos.length !== 1 ? 's' : ''}</span>
          <button onclick="document.querySelector('.modal-overlay')?.remove()"
            style="width:34px;height:34px;border-radius:50%;background:var(--glass-bg);border:1px solid var(--glass-border);cursor:pointer;color:var(--text-primary);font-size:1.1rem;display:flex;align-items:center;justify-content:center">✕</button>
        </div>
        <div id="view-all-gallery-grid" style="flex:1;overflow-y:auto;padding:4px">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:4px">
            ${photos.map(photo => {
              const unlocked = !photo.isLocked || (photo.unlockedBy || []).includes(viewerUid);
              return `<div style="aspect-ratio:1;overflow:hidden;cursor:pointer;position:relative;background:var(--bg-card);border-radius:4px"
                onclick="window._openLightbox('${ownerUid}','${photo.id}')">
                <img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;transition:transform 0.2s;${!unlocked ? 'filter:blur(12px) brightness(0.35)' : ''}" loading="lazy"
                  onmouseover="this.style.transform='scale(1.04)'" onmouseout="this.style.transform=''">
                ${!unlocked ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;gap:4px">
                  <span style="font-size:1.4rem">🔒</span><span style="font-size:0.78rem;opacity:0.8">✨ ${photo.unlockCost || 5}</span></div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>
    `, { centered: true, fullscreen: true });
    // Attach photos data to the grid for lightbox access
    setTimeout(() => {
      const allGrid = document.getElementById('view-all-gallery-grid');
      if (allGrid) allGrid._allPhotos = photos;
    }, 0);
  };

  window._sendDirectMessage = async (ownerUid, displayName) => {
    const viewerUid = VeloraState.currentUser?.uid;
    if (!viewerUid) { showToast('Faça login para enviar mensagens', 'error'); return; }
    if (viewerUid === ownerUid) return;

    const convId = [viewerUid, ownerUid].sort().join('_');
    document.querySelector('.modal-overlay')?.remove();

    // Verifica se já existe conversa (match ou DM anterior)
    try {
      const convSnap = await getDoc(doc(db, 'conversations', convId));
      if (convSnap.exists()) {
        window._openChat(convId, ownerUid);
        return;
      }
    } catch { /* continua para criar */ }

    // Sem conversa prévia — cobra Sparks
    const cost = SPARKS_COSTS.directMessage;
    const confirmed = await showConfirm(
      '💬 Mensagem Direta',
      `Enviar mensagem para ${displayName} custa ${cost} ✨ Sparks.\nVocê não precisa de match!\n\nSeu saldo: ${VeloraState.currentUser?.profile?.sparks || 0} ✨`,
      `Enviar (${cost} ✨)`
    );
    if (!confirmed) return;

    const enough = await hasSparks(viewerUid, cost);
    if (!enough) {
      showToast(`Sparks insuficientes. São necessários ${cost} ✨.`, 'error');
      window._navigate('store');
      return;
    }

    try {
      await deductSparks(viewerUid, cost, `Mensagem direta para ${displayName}`);
      await setDoc(doc(db, 'conversations', convId), {
        participants:  [viewerUid, ownerUid],
        matchId:       null,
        isDirect:      true,
        lastMessage:   null,
        lastAt:        serverTimestamp(),
        createdAt:     serverTimestamp(),
      });
      showToast('Conversa iniciada! 💬', 'success');
      window._openChat(convId, ownerUid);
    } catch (err) {
      showToast('Erro ao iniciar conversa: ' + (err.message || 'tente novamente'), 'error');
    }
  };

  // ─── Lightbox ────────────────────────────────────────────
  window._openLightbox = (ownerUid, photoId) => {
    const viewerUid = VeloraState.currentUser?.uid;
    // Collect photos from the active gallery grid or the all-photos modal
    const gridEl = document.getElementById('view-gallery-grid') || document.getElementById('view-all-gallery-grid');
    const photos  = gridEl?._allPhotos || [];
    let idx = photos.findIndex(p => p.id === photoId);
    if (idx === -1) return;

    const existing = document.getElementById('velora-lightbox');
    if (existing) existing.remove();

    const lb = document.createElement('div');
    lb.id = 'velora-lightbox';
    lb.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.96);display:flex;align-items:center;justify-content:center;touch-action:none';
    document.body.appendChild(lb);

    const renderLB = (i) => {
      const photo    = photos[i];
      if (!photo) return;
      const unlocked = !photo.isLocked || (photo.unlockedBy || []).includes(viewerUid);
      lb.innerHTML = `
        <button id="lb-close" style="position:absolute;top:16px;right:16px;z-index:2;width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;font-size:1.2rem;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">✕</button>
        <div style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.45);font-size:0.82rem;font-family:var(--font-display)">${i + 1} / ${photos.length}</div>
        ${i > 0 ? `<button id="lb-prev" style="position:absolute;left:16px;top:50%;transform:translateY(-50%);z-index:2;width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;font-size:1.6rem;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">&#8249;</button>` : ''}
        ${i < photos.length - 1 ? `<button id="lb-next" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);z-index:2;width:48px;height:48px;border-radius:50%;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;font-size:1.6rem;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)">&#8250;</button>` : ''}
        <div style="max-width:min(900px,90vw);max-height:85vh;display:flex;align-items:center;justify-content:center">
          ${unlocked
            ? `<img src="${photo.url}" style="max-width:100%;max-height:85vh;object-fit:contain;border-radius:10px;box-shadow:0 24px 80px rgba(0,0,0,0.7);display:block">`
            : `<div style="text-align:center;color:#fff;display:flex;flex-direction:column;align-items:center;gap:16px">
                <div style="width:220px;height:300px;border-radius:14px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,0.1)">
                  <img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;filter:blur(18px) brightness(0.3)">
                  <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px">
                    <span style="font-size:2.5rem">🔒</span>
                    <span style="font-size:0.9rem;opacity:0.7">Foto bloqueada</span>
                  </div>
                </div>
                <button id="lb-unlock" style="background:linear-gradient(135deg,var(--primary),var(--accent));border:none;border-radius:var(--radius-full);padding:12px 28px;color:#fff;font-family:var(--font-display);font-weight:700;font-size:0.95rem;cursor:pointer">
                  🔓 Desbloquear por ${photo.unlockCost || 5} ✨
                </button>
              </div>`
          }
        </div>
      `;
      document.getElementById('lb-close')?.addEventListener('click', () => lb.remove());
      document.getElementById('lb-prev')?.addEventListener('click',  () => renderLB(i - 1));
      document.getElementById('lb-next')?.addEventListener('click',  () => renderLB(i + 1));
      document.getElementById('lb-unlock')?.addEventListener('click', async () => {
        const ok = await unlockPhoto(viewerUid, ownerUid, photo.id);
        if (ok) { photo.unlockedBy = [...(photo.unlockedBy || []), viewerUid]; renderLB(i); }
      });
      lb.onclick = (e) => { if (e.target === lb) lb.remove(); };
    };

    renderLB(idx);
  };

  window._unlockOrViewPhoto = (ownerUid, photoId) => window._openLightbox(ownerUid, photoId);

  window._likePost = async (postId, btn) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    const isLiked = btn.classList.contains('liked');
    btn.classList.toggle('liked');
    const span = btn.querySelector('span');
    span.textContent = parseInt(span.textContent) + (isLiked ? -1 : 1);
    try {
      await updateDoc(doc(db, 'posts', postId), {
        likes:   increment(isLiked ? -1 : 1),
        likedBy: isLiked ? arrayRemove(uid) : arrayUnion(uid),
      });
    } catch {
      btn.classList.toggle('liked');
      span.textContent = parseInt(span.textContent) + (isLiked ? 1 : -1);
    }
  };

  window._quickLike = (postId) => {
    showToast('Like enviado! 💚', 'success');
  };

  window._quickPass = (postId) => {
    showToast('Perfil ignorado', 'info');
  };

  window._commentPost = () => showToast('Comentários em breve!', 'info');
  window._sharePost = () => showToast('Compartilhamento em breve!', 'info');

  window._createPost = () => {
    showModal(`
      <div class="modal-body">
        <h3 class="text-xl font-bold mb-md">${t('newPost')}</h3>
        <textarea class="input-field input-textarea mb-md" id="post-text" placeholder="${t('whatsOnYourMind')}"></textarea>
        <div class="flex gap-sm mb-lg">
          <button class="btn btn-ghost btn-sm">${svgIcon('image', 16)} Foto</button>
          <button class="btn btn-ghost btn-sm">${svgIcon('location', 16)} Local</button>
        </div>
        <button id="post-submit-btn" class="btn btn-primary btn-w-full" onclick="window._submitPost()">
          ${t('publish')}
        </button>
      </div>
    `, { centered: true });
  };

  window._submitPost = async () => {
    const uid = VeloraState.currentUser?.uid;
    const profile = VeloraState.currentUser?.profile;
    const text = document.getElementById('post-text')?.value?.trim();
    if (!text) return;
    const btn = document.getElementById('post-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      await addDoc(collection(db, 'posts'), {
        authorId:    uid,
        authorName:  profile?.displayName || VeloraState.currentUser?.displayName || 'Anônimo',
        authorPhoto: profile?.photoURL || null,
        authorAge:   profile?.age || null,
        text,
        image:       null,
        likes:       0,
        likedBy:     [],
        createdAt:   serverTimestamp(),
      });
      document.querySelector('.modal-overlay')?.remove();
      showToast('Publicado com sucesso! ✨', 'success');
    } catch (err) {
      showToast('Erro ao publicar. Tente novamente.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = t('publish'); }
    }
  };

  window._sendSuggestion = (text) => {
    const input = document.getElementById('chat-input');
    if (input) { input.value = text; input.focus(); }
    document.getElementById('chat-suggestions')?.remove();
  };

  window._confirmDeleteAccount = async () => {
    const confirmed = await showConfirm(
      'Excluir conta',
      'Esta ação é irreversível. Todos os seus dados serão perdidos permanentemente.',
      'Sim, excluir conta'
    );
    if (!confirmed) return;
    const user = auth.currentUser;
    if (!user) return;
    try {
      stopPresence();
      await deleteUser(user);
      showToast('Conta excluída com sucesso.', 'success');
      showPage('splash');
    } catch (err) {
      if (err.code === 'auth/requires-recent-login') {
        showToast('Por segurança, faça login novamente antes de excluir a conta.', 'error');
        await logoutUser();
        showPage('login');
      } else {
        showToast('Erro ao excluir conta. Tente novamente.', 'error');
      }
    }
  };
}

// ─── DEMO PROFILES (visíveis quando não há usuários reais) ─
const DEMO_PROFILES = [
  {
    uid: 'demo_1', displayName: 'Ana Carolina', age: 26,
    photoURL: 'https://randomuser.me/api/portraits/women/44.jpg',
    bio: 'Amo viajar, fotografia e café coado. Procuro alguém para explorar a cidade! ☕',
    interests: ['Fotografia', 'Viagens', 'Café', 'Música'],
    kmAway: 2, city: 'São Paulo', veloraScore: 94, verified: true,
    lookingFor: ['relationship'], isOnline: true, lastSeen: { seconds: Math.floor(Date.now()/1000) - 60 },
  },
  {
    uid: 'demo_2', displayName: 'Mariana Silva', age: 24,
    photoURL: 'https://randomuser.me/api/portraits/women/68.jpg',
    bio: 'Dançarina, amante de arte e culinária italiana. 🍝 Adoro novas experiências.',
    interests: ['Dança', 'Arte', 'Culinária', 'Yoga'],
    kmAway: 4, city: 'São Paulo', veloraScore: 88, verified: false,
    lookingFor: ['casual', 'relationship'], isOnline: false,
  },
  {
    uid: 'demo_3', displayName: 'Juliana Costa', age: 29,
    photoURL: 'https://randomuser.me/api/portraits/women/22.jpg',
    bio: 'Engenheira de dia, guitarrista de noite. 🎸 Buscando alguém que curta rock e trilhas.',
    interests: ['Música', 'Tecnologia', 'Trilhas', 'Gaming'],
    kmAway: 7, city: 'São Paulo', veloraScore: 91, verified: true,
    lookingFor: ['relationship'], isOnline: true, lastSeen: { seconds: Math.floor(Date.now()/1000) - 120 },
  },
  {
    uid: 'demo_4', displayName: 'Beatriz Mendes', age: 23,
    photoURL: 'https://randomuser.me/api/portraits/women/57.jpg',
    bio: 'Estudante de medicina. Apaixonada por séries, leitura e cachorros. 🐕',
    interests: ['Leitura', 'Séries', 'Natureza', 'Animais'],
    kmAway: 3, city: 'Guarulhos', veloraScore: 85, verified: false,
    lookingFor: ['relationship'], isOnline: false,
  },
  {
    uid: 'demo_5', displayName: 'Camila Rocha', age: 27,
    photoURL: 'https://randomuser.me/api/portraits/women/33.jpg',
    bio: 'Chef de cozinha criativa. Viajei 30 países e ainda tem muito chão! ✈️🍜',
    interests: ['Culinária', 'Viagens', 'Cultura', 'Fotografia'],
    kmAway: 9, city: 'São Paulo', veloraScore: 97, verified: true,
    lookingFor: ['casual', 'relationship'], isOnline: true, lastSeen: { seconds: Math.floor(Date.now()/1000) - 30 },
  },
  {
    uid: 'demo_6', displayName: 'Fernanda Lima', age: 25,
    photoURL: 'https://randomuser.me/api/portraits/women/17.jpg',
    bio: 'Professora de ioga e meditação. 🧘 Acredito em conexões genuínas e conversas profundas.',
    interests: ['Yoga', 'Meditação', 'Natureza', 'Leitura'],
    kmAway: 5, city: 'São Paulo', veloraScore: 82, verified: false,
    lookingFor: ['relationship'], isOnline: false,
  },
  {
    uid: 'demo_7', displayName: 'Isabela Torres', age: 28,
    photoURL: 'https://randomuser.me/api/portraits/women/79.jpg',
    bio: 'Arquiteta apaixonada por design e arte urbana. 🏙️ Adora um bom museu e cinema independente.',
    interests: ['Arte', 'Design', 'Cinema', 'Arquitetura'],
    kmAway: 11, city: 'Santo André', veloraScore: 89, verified: true,
    lookingFor: ['relationship'], isOnline: true, lastSeen: { seconds: Math.floor(Date.now()/1000) - 200 },
  },
  {
    uid: 'demo_8', displayName: 'Larissa Nunes', age: 22,
    photoURL: 'https://randomuser.me/api/portraits/women/90.jpg',
    bio: 'Recém-formada em Marketing. Apaixonada por música ao vivo e fim de semana na praia. 🌊🎵',
    interests: ['Música', 'Praia', 'Marketing', 'Fitness'],
    kmAway: 15, city: 'São Paulo', veloraScore: 78, verified: false,
    lookingFor: ['casual', 'relationship'], isOnline: false,
  },
];

// ─── LOAD HOME ────────────────────────────────────────────
let isLoadingHome = false;
let profilesLoaded  = false;

async function loadAndShowHome() {
  if (isLoadingHome) return;
  isLoadingHome = true;
  if (!VeloraState.profiles) VeloraState.profiles = [];
  VeloraState.currentPage = 'home';
  VeloraState.navStack = [];
  showPage('home');
  isLoadingHome = false;

  const uid = VeloraState.currentUser?.uid;
  if (!uid || profilesLoaded) return;

  try {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
    const loaded = await Promise.race([loadProfiles(uid), timeout]);
    if (loaded?.length) {
      profilesLoaded = true;
      VeloraState.profiles = loaded;
    } else if (!VeloraState.profiles.length) {
      // Sem usuários reais → usa perfis demo para demonstração
      profilesLoaded = true;
      VeloraState.profiles = DEMO_PROFILES;
    }
    // Atualiza o TikTok feed se ainda na tela inicial
    if (VeloraState.currentCardIdx === 0 && document.getElementById('tiktok-feed')) {
      isLoadingHome = true;
      try { showPage('home'); } finally { isLoadingHome = false; }
    }
  } catch {
    // Timeout ou erro → usa demo profiles
    if (!VeloraState.profiles.length) {
      VeloraState.profiles = DEMO_PROFILES;
      isLoadingHome = true;
      try { showPage('home'); } finally { isLoadingHome = false; }
    }
  }
}

// ─── PAGE INIT HANDLERS ───────────────────────────────────
function initPageHandlers() {
  window.addEventListener('pageReady', (e) => {
    const { pageId, el } = e.detail;

    if (pageId === 'splash') {
      setTimeout(() => {
        // Only advance if auth hasn't already redirected to home
        if (!VeloraState.currentUser) showPage('onboarding');
      }, 2200);
    }

    if (pageId === 'onboarding') {
      let currentSlide = 0;
      const slides = [
        { emoji:'💫', color:'var(--primary)', glow:'var(--glow-primary)', title:'Conexões Reais', desc:'Encontre pessoas incríveis ao seu redor com o VeloraScore™' },
        { emoji:'🔒', color:'var(--gold)', glow:'var(--glow-gold)', title:'Sua Privacidade', desc:'Controle suas fotos. Desbloqueie conteúdo com Sparks ✨' },
        { emoji:'⚡', color:'var(--secondary)', glow:'var(--glow-secondary)', title:'Match Instantâneo', desc:'Swipe, conecte e converse em tempo real!' },
      ];

      const nextBtn = el.querySelector('#onboarding-next');
      const skipBtn = el.querySelector('#onboarding-skip');

      const goToLogin = () => showPage('login');

      nextBtn?.addEventListener('click', () => {
        currentSlide++;
        if (currentSlide >= slides.length) { goToLogin(); return; }
        const s = slides[currentSlide];
        el.querySelector('#onboarding-content').innerHTML = `
          <div class="onboarding-slide slide-in-right" id="onboarding-slide">
            <div class="onboarding-icon animate-popIn" style="background:${s.color}20;box-shadow:${s.glow}">${s.emoji}</div>
            <div>
              <h2 style="font-family:var(--font-display);font-size:1.8rem;font-weight:800;text-align:center;margin-bottom:12px">${s.title}</h2>
              <p style="color:var(--text-secondary);text-align:center;font-size:1rem;line-height:1.6">${s.desc}</p>
            </div>
          </div>
        `;
        el.querySelectorAll('.step-dot').forEach((dot, i) => {
          dot.className = `step-dot ${i < currentSlide ? 'completed' : i === currentSlide ? 'active' : ''}`;
        });
        if (currentSlide === slides.length - 1) nextBtn.textContent = t('finish');
      });
      skipBtn?.addEventListener('click', goToLogin);
    }

    if (pageId === 'login') {
      // Sessão persistida: redireciona imediatamente sem mostrar o formulário
      if (VeloraState.currentUser) {
        loadAndShowHome();
        return;
      }

      const loginBtn  = el.querySelector('#login-btn');
      const googleBtn = el.querySelector('#google-login-btn');
      const togglePw  = el.querySelector('#toggle-pw');
      const pwInput   = el.querySelector('#login-password');

      togglePw?.addEventListener('click', () => {
        const isText = pwInput.type === 'text';
        pwInput.type = isText ? 'password' : 'text';
        togglePw.innerHTML = svgIcon(isText ? 'eye' : 'eyeOff', 18);
      });

      loginBtn?.addEventListener('click', async () => {
        if (loginBtn.classList.contains('btn-loading')) return; // evita duplo clique

        const email    = el.querySelector('#login-email')?.value?.trim();
        const password = el.querySelector('#login-password')?.value;

        if (!email)    { showToast('Digite seu e-mail', 'error'); return; }
        if (!password) { showToast('Digite sua senha', 'error'); return; }
        if (password.length < 6) { showToast('Senha muito curta (mín. 6 caracteres)', 'error'); return; }

        loginBtn.classList.add('btn-loading');
        loginBtn.disabled = true;
        try {
          const res = await loginWithEmail(email, password);
          if (!res.success) showToast(res.error, 'error');
        } finally {
          loginBtn.classList.remove('btn-loading');
          loginBtn.disabled = false;
        }
      });

      // Enter na senha aciona o login
      pwInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginBtn?.click();
      });

      googleBtn?.addEventListener('click', async () => {
        if (googleBtn.classList.contains('btn-loading')) return;
        googleBtn.classList.add('btn-loading');
        googleBtn.disabled = true;
        try {
          const res = await loginWithGoogle();
          if (!res.success) showToast(res.error, 'error');
        } finally {
          googleBtn.classList.remove('btn-loading');
          googleBtn.disabled = false;
        }
      });
    }

    if (pageId === 'register') {
      let step = 1;
      let selectedGender = '';
      let selectedIntents = [];
      let photoFile = null;
      let photoURL = null;

      window._selectGender = (el2, gender) => {
        selectedGender = gender;
        el.querySelectorAll('[data-gender]').forEach(t => t.classList.remove('active'));
        el2.classList.add('active');
      };

      window._toggleIntent = (el2, intent) => {
        el2.classList.toggle('active');
        if (el2.classList.contains('active')) selectedIntents.push(intent);
        else selectedIntents = selectedIntents.filter(i => i !== intent);
      };

      el.querySelector('#photo-upload')?.addEventListener('change', (e) => {
        photoFile = e.target.files[0];
        if (photoFile) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            photoURL = ev.target.result;
            const preview = el.querySelector('#photo-preview');
            if (preview) { preview.innerHTML = `<img src="${photoURL}" style="width:100%;height:100%;object-fit:cover">`; }
          };
          reader.readAsDataURL(photoFile);
        }
      });

      el.querySelector('#adult-toggle')?.addEventListener('change', (e) => {
        const group = el.querySelector('#age-confirm-group');
        if (group) group.style.display = e.target.checked ? 'flex' : 'none';
      });

      el.querySelector('#age-checkbox')?.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const box = el.querySelector('#age-checkbox');
        const isChecked = box.dataset.checked === 'true';
        box.dataset.checked = (!isChecked).toString();
        box.innerHTML = !isChecked ? svgIcon('check', 14) : '';
      });

      const nextBtn = el.querySelector('#register-next-btn');
      const backBtn = el.querySelector('#register-back-btn');

      nextBtn?.addEventListener('click', async () => {
        if (step === 1) {
          const name    = el.querySelector('#reg-name')?.value?.trim();
          const email   = el.querySelector('#reg-email')?.value?.trim();
          const birth   = el.querySelector('#reg-birth')?.value;
          const pass    = el.querySelector('#reg-password')?.value;
          const pass2   = el.querySelector('#reg-password2')?.value;
          if (!name || !email || !birth || !pass || !pass2) { showToast('Preencha todos os campos', 'error'); return; }
          if (pass !== pass2) { showToast(t('errorPasswordMatch'), 'error'); return; }
          const age = getAge(birth);
          if (age < 18) { showToast(t('errorAge'), 'error'); return; }
          step = 2;
          el.querySelector('#step-1').style.display = 'none';
          el.querySelector('#step-2').style.display = 'block';
          backBtn.style.display = 'block';
        } else if (step === 2) {
          step = 3;
          el.querySelector('#step-2').style.display = 'none';
          el.querySelector('#step-3').style.display = 'block';
          nextBtn.querySelector('.btn-text').textContent = t('finish');
        } else {
          // Submit
          const name  = el.querySelector('#reg-name')?.value?.trim();
          const email = el.querySelector('#reg-email')?.value?.trim();
          const birth = el.querySelector('#reg-birth')?.value;
          const pass  = el.querySelector('#reg-password')?.value;
          const bio   = el.querySelector('#reg-bio')?.value?.trim();
          const isAdult = el.querySelector('#adult-toggle')?.checked;
          const ageConfirmed = el.querySelector('#age-checkbox')?.dataset.checked === 'true';
          const interests = [...el.querySelectorAll('[data-interest].active')].map(t => t.dataset.interest);

          if (isAdult && !ageConfirmed) { showToast('Confirme que você tem 18+ anos', 'error'); return; }

          nextBtn.classList.add('btn-loading');
          const age = getAge(birth);

          const res = await registerWithEmail(email, pass, {
            displayName: name, bio, age, gender: selectedGender,
            lookingFor: selectedIntents, interests, isAdult,
            photoURL: photoURL || defaultAvatar(name),
          }, photoFile);
          nextBtn.classList.remove('btn-loading');
          if (!res.success) showToast(res.error, 'error');
        }
      });

      backBtn?.addEventListener('click', () => {
        if (step === 2) {
          step = 1;
          el.querySelector('#step-1').style.display = 'block';
          el.querySelector('#step-2').style.display = 'none';
          backBtn.style.display = 'none';
        } else if (step === 3) {
          step = 2;
          el.querySelector('#step-2').style.display = 'block';
          el.querySelector('#step-3').style.display = 'none';
          nextBtn.querySelector('.btn-text').textContent = t('next');
        }
      });
    }

    if (pageId === 'home') {
      // ── TikTok feed: IntersectionObserver para rastrear slide atual ──
      const tikFeed = el.querySelector('#tiktok-feed');
      if (tikFeed) {
        VeloraState.currentCardIdx = 0;
        const slides = [...tikFeed.querySelectorAll('.tiktok-slide:not(.tiktok-slide-end)')];
        const total  = VeloraState.profiles.length;
        const maxDots = Math.min(total, 7);

        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              const idx = parseInt(entry.target.dataset.idx ?? '-1', 10);
              if (idx < 0) return;
              VeloraState.currentCardIdx = idx;

              // Atualiza progress pill
              const prog = document.getElementById('tiktok-progress');
              if (prog) prog.textContent = `${idx + 1} / ${total}`;

              // Atualiza dots
              const dotIdx = Math.floor((idx / total) * maxDots);
              document.querySelectorAll('.tiktok-dot').forEach((d, i) =>
                d.classList.toggle('active', i === dotIdx)
              );
            }
          });
        }, { threshold: 0.5 });

        slides.forEach(s => observer.observe(s));
        tikFeed._veloraObserver = observer;
      }
    }

    if (pageId === 'feed') {
      const uid = VeloraState.currentUser?.uid;
      const feedEl = el.querySelector('#feed-posts');
      if (uid && feedEl) {
        if (VeloraState._feedUnsub) VeloraState._feedUnsub();
        const postsQ = query(
          collection(db, 'posts'),
          orderBy('createdAt', 'desc'),
          limit(30)
        );
        VeloraState._feedUnsub = onSnapshot(postsQ, (snap) => {
          if (!feedEl.isConnected) return;
          if (snap.empty) {
            feedEl.innerHTML = `<div class="flex-center" style="height:200px;color:var(--text-muted);font-size:0.9rem">Nenhum post ainda. Seja o primeiro! 🌟</div>`;
            return;
          }
          feedEl.innerHTML = snap.docs.map(d => renderPostCard({ id: d.id, ...d.data() }, uid)).join('');
        }, () => {
          if (feedEl.isConnected) feedEl.innerHTML = `<div class="flex-center" style="height:200px;color:var(--danger);font-size:0.9rem">Erro ao carregar posts.</div>`;
        });
      }
    }

    if (pageId === 'matches') {
      const uid = VeloraState.currentUser?.uid;
      if (uid) {
        if (VeloraState.matchesUnsub) {
          VeloraState.matchesUnsub();
        }
        VeloraState.matchesUnsub = subscribeToMatches(uid, async (matches) => {
          VeloraState.matchCount = matches.length;
          // Mark all as seen so profile banner resets "new" count
          localStorage.setItem(`velora_seen_matches_${uid}`, matches.length);
          const badge = document.querySelector('#nav-matches .nav-badge');
          if (badge) badge.textContent = matches.length || '';
          // Re-renderiza a lista completa de matches na página
          if (!el.isConnected) return;
          const content = el.querySelector('.page-content');
          if (!content) return;
          if (!matches.length) {
            content.querySelector('#matches-list')?.remove();
            return;
          }
          // Busca perfis dos outros usuários para mostrar nome e foto
          const enriched = await Promise.all(matches.map(async m => {
            const otherId = m.user1 === uid ? m.user2 : m.user1;
            let name = 'Usuário';
            let photo = defaultAvatar(otherId);
            try {
              const snap = await getDoc(doc(db, 'users', otherId));
              if (snap.exists()) {
                const d = snap.data();
                name  = d.displayName || name;
                photo = d.photoURL   || photo;
              }
            } catch { /* keep defaults */ }
            return { ...m, otherId, name, photo };
          }));
          const listEl = content.querySelector('#matches-list') || (() => {
            const d = document.createElement('div');
            d.id = 'matches-list';
            content.appendChild(d);
            return d;
          })();
          const emptyEl = content.querySelector('.empty-state');
          if (emptyEl) emptyEl.remove();
          listEl.innerHTML = enriched.map(m => `
            <div class="match-item" onclick="window._openChat('${m.id}', '${m.otherId}')">
              <div class="avatar avatar-md avatar-online" style="background:var(--bg-surface);overflow:hidden">
                <img src="${m.photo}" style="width:100%;height:100%;object-fit:cover" alt="${m.name}" loading="lazy">
              </div>
              <div class="match-item-info">
                <div class="match-item-name">${m.name}</div>
                <div class="match-item-preview">Toque para iniciar a conversa 💬</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
                <div class="match-item-time">agora</div>
                <button class="btn btn-ghost btn-sm" style="font-size:0.75rem;padding:4px 8px;color:var(--danger)"
                  onclick="event.stopPropagation();window._unmatch('${m.id}', '${m.name}')">
                  ${svgIcon('x', 12)} ${t('unmatch')}
                </button>
              </div>
            </div>
          `).join('');
        });
      }
    }

    if (pageId === 'chat') {
      const { convId, otherId } = e.detail.data;
      if (!convId) return;

      const uid = VeloraState.currentUser?.uid;
      const messagesEl = el.querySelector('#chat-messages');
      const input      = el.querySelector('#chat-input');
      const sendBtn    = el.querySelector('#chat-send-btn');

      if (uid && messagesEl) {
        const unsub = subscribeToChat(convId, (messages) => {
          const prev = messagesEl.scrollHeight;
          messagesEl.innerHTML = renderMessages(messages, uid);
          if (messagesEl.scrollHeight > prev) messagesEl.scrollTop = messagesEl.scrollHeight;
        });
        VeloraState.chatUnsub = unsub;
      }

      const doSend = async () => {
        const text = input?.value?.trim();
        if (!text || !uid) return;
        input.value = '';
        await sendMessage(convId, text, uid);
      };

      sendBtn?.addEventListener('click', doSend);
      input?.addEventListener('keydown', (e2) => { if (e2.key === 'Enter' && !e2.shiftKey) { e2.preventDefault(); doSend(); } });
    }

    if (pageId === 'store') {
      const uid = VeloraState.currentUser?.uid;
      const balance = VeloraState.currentUser?.profile?.sparks || 0;
      el.innerHTML = renderStoreHTML(balance);
    }

    if (pageId === 'settings') {
      const uid = VeloraState.currentUser?.uid;
      el.querySelector('#settings-adult')?.addEventListener('change', async (ev) => {
        if (!uid) return;
        const val = ev.target.checked;
        await updateUserProfile(uid, { isAdult: val }).catch(() => {});
        if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.isAdult = val;
        showToast(val ? 'Modo adulto ativado 🔞' : 'Modo adulto desativado', 'info');
      });
      el.querySelector('#settings-notifications')?.addEventListener('change', async (ev) => {
        if (!uid) return;
        const val = ev.target.checked;
        await updateUserProfile(uid, { notifications: val }).catch(() => {});
        if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.notifications = val;
        showToast(val ? 'Notificações ativadas 🔔' : 'Notificações desativadas', 'info');
      });
    }

    if (pageId === 'discover') {
      const radarEl = el.querySelector('#presence-radar');
      const countEl = el.querySelector('#presence-count');
      if (radarEl && countEl) {
        const cutoff = Math.floor(Date.now() / 1000) - 600;
        const q = query(collection(db, 'users'), where('isOnline', '==', true));
        const unsub = onSnapshot(q, (snap) => {
          if (!radarEl.isConnected) { unsub(); return; }
          const onlineUsers = snap.docs.filter(d => {
            const ls = d.data().lastSeen?.seconds || 0;
            return ls > cutoff;
          });
          const count = onlineUsers.length;
          countEl.textContent = count > 0 ? `${count} usuário${count !== 1 ? 's' : ''} online agora` : 'Nenhum usuário online no momento';
          // Re-render radar dots based on real count
          const dots = Math.max(count, 1);
          radarEl.innerHTML = Array.from({length: Math.min(dots + 3, 20)}, (_, i) => {
            const colors = ['var(--primary)', 'var(--secondary)', 'var(--accent)'];
            const size = 7 + Math.random() * 9;
            return `<div style="position:absolute;width:${size}px;height:${size}px;border-radius:50%;background:${colors[i % 3]};opacity:${0.5 + Math.random() * 0.5};left:${5 + Math.random() * 88}%;top:${10 + Math.random() * 75}%;box-shadow:0 0 ${8 + Math.random() * 10}px currentColor;animation:pulse ${1.5 + Math.random()}s ease-in-out infinite ${Math.random()}s"></div>`;
          }).join('');
        }, () => {
          countEl.textContent = 'Erro ao carregar presença';
        });
      }
    }

    if (pageId === 'profile') {
      const uid = VeloraState.currentUser?.uid;

      // ── Gallery preview ──
      const previewEl = el.querySelector('#profile-gallery-preview');
      if (uid && previewEl) {
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000));
        Promise.race([getUserGallery(uid), timeout])
          .then(photos => {
            if (!el.isConnected || !previewEl.isConnected) return;
            if (!photos.length) return;
            previewEl.innerHTML = photos.slice(0, 6).map(photo => `
              <div style="aspect-ratio:1;overflow:hidden;cursor:pointer;background:var(--bg-surface)" onclick="window._navigate('gallery')">
                <img src="${photo.url}" style="width:100%;height:100%;object-fit:cover;${photo.isLocked ? 'filter:blur(8px) brightness(0.5)' : ''}" loading="lazy">
              </div>
            `).join('');
          })
          .catch(() => {});
      }

      // ── Match notification banner ──
      const notifyEl = el.querySelector('#profile-match-notify');
      if (uid && notifyEl) {
        const seenKey = `velora_seen_matches_${uid}`;

        const renderMatchBanner = async (matches) => {
          if (!el.isConnected || !notifyEl.isConnected) return;
          const seenCount  = parseInt(localStorage.getItem(seenKey) || '0', 10);
          const totalCount = matches.length;
          const newCount   = Math.max(0, totalCount - seenCount);

          if (!totalCount) {
            notifyEl.style.display = 'none';
            return;
          }

          // Enrich last 4 matches with photo + name
          const recent = matches.slice(0, 4);
          const enriched = await Promise.all(recent.map(async m => {
            const otherId = m.user1 === uid ? m.user2 : m.user1;
            let name  = 'Match';
            let photo = defaultAvatar(otherId);
            try {
              const snap = await getDoc(doc(db, 'users', otherId));
              if (snap.exists()) {
                const d = snap.data();
                name  = (d.displayName || '').split(' ')[0] || name;
                photo = d.photoURL || photo;
              }
            } catch { /* keep defaults */ }
            return { photo, name };
          }));

          const avatars = enriched.map(e => `
            <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;border:2px solid var(--primary);flex-shrink:0;margin-right:-10px">
              <img src="${e.photo}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
            </div>
          `).join('');

          const label = newCount > 0
            ? `<span style="font-size:0.72rem;background:var(--primary);color:#000;font-weight:800;padding:2px 8px;border-radius:99px;margin-left:6px">${newCount} NOVO${newCount > 1 ? 'S' : ''}</span>`
            : '';

          notifyEl.style.display = 'block';
          notifyEl.innerHTML = `
            <div onclick="window._navigate('matches')" style="cursor:pointer;display:flex;align-items:center;gap:14px;padding:14px 16px;background:linear-gradient(135deg,rgba(0,245,212,0.08),rgba(108,99,255,0.12));border:1px solid rgba(0,245,212,0.25);border-radius:var(--radius-lg);transition:all 0.2s">
              <div style="position:relative;display:flex;align-items:center;padding-right:10px">
                ${avatars}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem;display:flex;align-items:center;flex-wrap:wrap;gap:4px">
                  💞 ${totalCount} Match${totalCount > 1 ? 'es' : ''} ${label}
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px">Toque para ver seus matches</div>
              </div>
              <div style="color:var(--primary);font-size:1.1rem">›</div>
            </div>
          `;
        };

        // Subscribe in real-time so banner updates instantly on new match
        if (VeloraState._profileMatchUnsub) VeloraState._profileMatchUnsub();
        VeloraState._profileMatchUnsub = subscribeToMatches(uid, renderMatchBanner);
      }
    }

    if (pageId === 'gallery') {
      const uid = VeloraState.currentUser?.uid;
      const galleryContent = el.querySelector('#gallery-content');
      if (!uid || !galleryContent) return;
      const showEmpty = () => {
        galleryContent.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">📷</div>
            <p class="empty-state-title">Nenhuma foto ainda</p>
            <p class="empty-state-desc" style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">Toque em + para adicionar sua primeira foto!</p>
          </div>`;
      };
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 7000));
      Promise.race([getUserGallery(uid), timeout])
        .then(photos => {
          if (!el.isConnected) return;
          galleryContent.innerHTML = photos.length
            ? renderGalleryGrid(photos, uid, uid)
            : `<div class="empty-state"><div class="empty-state-icon">📷</div><p class="empty-state-title">Nenhuma foto ainda</p><p class="empty-state-desc" style="font-size:0.85rem;color:var(--text-muted);margin-top:4px">Toque em + para adicionar!</p></div>`;
        })
        .catch(showEmpty);
    }
  });
}

// ─── REGISTER ALL PAGES ───────────────────────────────────
function registerAllPages() {
  registerPage('splash',    () => renderSplash());
  registerPage('onboarding',() => renderOnboarding());
  registerPage('login',     () => renderLogin());
  registerPage('register',  () => renderRegister());
  registerPage('home',      () => renderHome());
  registerPage('discover',  () => renderDiscoverPage());
  registerPage('feed',      () => renderFeed());
  registerPage('matches',   (data) => renderMatchesPage(Array.isArray(data) ? data : []));
  registerPage('chat',      (data) => renderChatPage(data.convId, data.otherId));
  registerPage('profile',   () => renderProfilePage());
  registerPage('settings',  () => renderSettings());
  registerPage('store',     () => `<div style="min-height:100vh;background:var(--bg-deep)"></div>`);
  registerPage('gallery',   () => {
    const sparks = VeloraState.currentUser?.profile?.sparks || 0;
    return `
    <div style="min-height:100vh;background:var(--bg-deep);padding-bottom:calc(var(--nav-height) + 24px)">
      <div class="top-header" style="border-bottom:1px solid var(--glass-border);justify-content:space-between">
        <button class="btn-icon btn-ghost" onclick="window._navigate('profile')">${svgIcon('back', 20)}</button>
        <span style="font-family:var(--font-display);font-weight:700;font-size:1.1rem">${t('gallery')}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <label class="btn btn-primary btn-sm" style="cursor:pointer;gap:6px">
            ${svgIcon('plus', 16)} Adicionar
            <input type="file" id="gallery-upload-input" accept="image/*" style="display:none" onchange="window._handleGalleryUpload(event)">
          </label>
          <div class="sparks-badge" onclick="window._navigate('store')">
            <span class="sparks-icon">✨</span>
            <span data-sparks-balance>${sparks}</span>
          </div>
        </div>
      </div>
      <div id="gallery-upload-progress" style="display:none;padding:var(--space-md);text-align:center;color:var(--primary);font-size:0.9rem;font-weight:600"></div>
      <div id="gallery-content" style="padding:var(--space-md)">
        <div class="flex-center" style="height:200px;color:var(--text-muted);font-size:0.9rem">
          ${svgIcon('discover', 16)} &nbsp; Carregando galeria...
        </div>
      </div>
      ${renderBottomNav('profile')}
    </div>
  `;
  });
}

// ─── BOOT ─────────────────────────────────────────────────
export async function boot() {
  initParticles();
  setupGlobalHandlers();
  registerAllPages();
  initPageHandlers();

  // Show splash immediately — must happen before any await
  showPage('splash');

  // Init auth observer
  // onLoggedIn  → show home immediately (overrides any pending navigation)
  // onLoggedOut → no-op; splash timer in initPageHandlers drives onboarding
  document.addEventListener('velora:profileLoaded', () => updateSparksDisplay());

  try {
    initAuthObserver(
      async (user, profile) => {
        VeloraState.currentUser = { ...user, profile };
        profilesLoaded = false;
        VeloraState.currentCardIdx = 0;
        updateSparksDisplay();
        startPresence(user.uid);
        initForegroundMessages().catch(() => {});
        analytics.logLogin(user.providerData?.[0]?.providerId || 'email');
        await loadAndShowHome().catch(() => showPage('login'));
        // Email verification banner (non-blocking, shown after home loads)
        if (!user.emailVerified && user.providerData?.[0]?.providerId !== 'google.com') {
          setTimeout(() => {
            const existing = document.getElementById('email-verify-banner');
            if (existing) return;
            const banner = document.createElement('div');
            banner.id = 'email-verify-banner';
            banner.innerHTML = `
              <div style="position:fixed;top:0;left:0;right:0;z-index:8000;background:linear-gradient(90deg,rgba(247,201,72,0.95),rgba(255,140,0,0.95));color:#050510;padding:10px 16px;display:flex;align-items:center;gap:10px;font-size:0.82rem;font-family:var(--font-display);font-weight:600;backdrop-filter:blur(8px)">
                <span>⚠️ Verifique seu e-mail para acesso completo.</span>
                <button onclick="window._resendVerification()" style="margin-left:auto;padding:4px 12px;border-radius:99px;background:#050510;color:#fff;border:none;cursor:pointer;font-size:0.8rem;font-weight:700">Reenviar</button>
                <button onclick="document.getElementById('email-verify-banner')?.remove()" style="padding:4px 8px;border-radius:99px;background:transparent;border:none;cursor:pointer;font-size:1rem">✕</button>
              </div>`;
            document.body.prepend(banner);
          }, 2000);
        }
        // Retorno do Stripe: o crédito de Sparks é feito pelo backend
        // (Cloud Function `stripeWebhook`), depois que o Stripe confirma o
        // pagamento de verdade — o cliente nunca credita a si mesmo. Aqui só
        // aguardamos a atualização do saldo chegar via Firestore em tempo real.
        if (_pendingStripePkg) {
          _pendingStripePkg = null;
          const startingBalance = VeloraState.currentUser?.profile?.sparks ?? 0;
          showToast('Pagamento recebido! Confirmando com o Stripe...', 'info');

          let waitTimeout;
          const unsubWait = onSnapshot(doc(db, 'users', user.uid), (snap) => {
            const sparks = snap.data()?.sparks;
            if (typeof sparks === 'number' && sparks > startingBalance) {
              if (VeloraState.currentUser?.profile) VeloraState.currentUser.profile.sparks = sparks;
              updateSparksDisplay();
              showToast(`✅ Pagamento confirmado! +${sparks - startingBalance} Sparks adicionados!`, 'gold');
              clearTimeout(waitTimeout);
              unsubWait();
            }
          });
          waitTimeout = setTimeout(() => {
            unsubWait();
            showToast('Pagamento em processamento. Seu saldo será atualizado em poucos instantes.', 'info');
          }, 20000);
        }
      },
      () => { profilesLoaded = false; stopPresence(); }
    );
  } catch (authErr) {
    console.warn('[VELORA] Firebase auth unavailable:', authErr.message);
    // splash timer still fires; nothing extra needed
  }
}
