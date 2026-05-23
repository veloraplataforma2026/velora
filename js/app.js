/* ============================================================
   VELORA — Main Application Router & State
   SPA routing, global state, page orchestration
   ============================================================ */

import { i18n, t, LANGUAGES } from './i18n.js';
import { auth, db } from './firebase-config.js';
import { initAuthObserver, logoutUser, getUserProfile, updateUserProfile } from './auth.js';
import {
  showPage, showToast, showModal, showConfirm,
  showMatchPopup, launchConfetti, initParticles,
  svgIcon, defaultAvatar, veloraScoreRing, registerPage,
} from './ui.js';
import {
  SwipeEngine, loadProfiles, recordSwipe,
  subscribeToMatches, unmatch, MOCK_PROFILES,
} from './swipe.js';
import { subscribeToChat, sendMessage, renderMessages, typingIndicatorHTML, MESSAGE_SUGGESTIONS } from './chat.js';
import { uploadPhoto, getUserGallery, togglePhotoLock, unlockPhoto, deletePhoto, renderGalleryGrid } from './gallery.js';
import { getBalance, purchaseSparks, updateSparksDisplay, renderStoreHTML } from './currency.js';
import {
  collection, doc, addDoc, getDocs, onSnapshot,
  query, where, orderBy, serverTimestamp, getDoc, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ─── Global State ─────────────────────────────────────────
export const VeloraState = {
  currentUser:    null,
  matchesUnsub:   null,
  chatUnsub:      null,
  activeConvId:   null,
  profiles:       [],
  currentCardIdx: 0,
  swipeEngine:    null,
  matchCount:     0,
};

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

// ─── LOGIN PAGE ───────────────────────────────────────────
function renderLogin() {
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
      <div style="flex:1;padding:var(--space-xl);display:flex;flex-direction:column;justify-content:center">
        <div style="text-align:center;margin-bottom:var(--space-2xl)">
          <h1 class="logo-text" style="font-size:2.5rem;display:block;margin-bottom:8px">VELORA</h1>
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

          <button class="btn btn-ghost btn-w-full" id="google-login-btn" style="gap:10px">
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
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
      <div style="padding:var(--space-lg);padding-top:var(--space-xl)">
        <button class="btn-icon btn-ghost" onclick="window._navigate('login')">
          ${svgIcon('back', 20)}
        </button>
      </div>

      <div style="flex:1;padding:0 var(--space-xl) var(--space-xl)" id="register-content">
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
  `;
}

// ─── HOME (Swipe) PAGE ────────────────────────────────────
function renderHome() {
  const user = VeloraState.currentUser;
  const sparks = user?.profile?.sparks || 0;
  const profiles = VeloraState.profiles.length ? VeloraState.profiles : MOCK_PROFILES;
  const profile = profiles[VeloraState.currentCardIdx];

  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding-bottom:100px">
      <div id="swipe-deck" style="position:relative;width:100%;max-width:420px;margin:0 auto;min-height:500px">
        ${profile ? renderProfileCard(profile, 0) : renderNoMoreCards()}
        ${profiles[VeloraState.currentCardIdx + 1] ? `<div class="card-stack-2" style="position:absolute;inset:0;">${renderProfileCard(profiles[VeloraState.currentCardIdx + 1], 1, true)}</div>` : ''}
        ${profiles[VeloraState.currentCardIdx + 2] ? `<div class="card-stack-3" style="position:absolute;inset:0;">${renderProfileCard(profiles[VeloraState.currentCardIdx + 2], 2, true)}</div>` : ''}
      </div>

      ${profile ? `
        <div class="swipe-actions" id="swipe-actions">
          <button class="swipe-btn swipe-btn-rewind" onclick="window._rewindSwipe()" title="Desfazer">
            ${svgIcon('undo', 20)}
          </button>
          <button class="swipe-btn swipe-btn-pass" onclick="window._triggerPass()" title="${t('pass')}">
            ${svgIcon('x', 28)}
          </button>
          <button class="swipe-btn swipe-btn-like" onclick="window._triggerLike()" title="${t('like')}">
            ${svgIcon('heart', 30)}
          </button>
          <button class="swipe-btn swipe-btn-superlike" onclick="window._triggerSuperlike()" title="${t('superLike')}">
            ${svgIcon('star', 22)}
          </button>
          <button class="swipe-btn" style="width:48px;height:48px;background:rgba(124,60,255,0.1);border:2px solid rgba(124,60,255,0.4);color:var(--accent);border-radius:50%" onclick="window._navigate('store')" title="Boost">
            ${svgIcon('bolt', 20)}
          </button>
        </div>
      ` : ''}
    </div>
    ${renderBottomNav('home')}
  `;
}

function renderProfileCard(profile, idx, isBackground = false) {
  const interests = (profile.interests || []).slice(0, 3);
  return `
    <div class="profile-card ${isBackground ? '' : 'animate-scaleIn'}" id="top-card" style="${isBackground ? 'pointer-events:none' : ''}">
      <img class="profile-card-image" src="${profile.photoURL || defaultAvatar(profile.displayName)}" alt="${profile.displayName}" draggable="false">
      <div class="profile-card-gradient"></div>
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
      <div style="padding:var(--space-lg) var(--space-lg) var(--space-sm)">
        <h1 style="font-family:var(--font-display);font-size:1.4rem;font-weight:800">${t('myMatches')}</h1>
      </div>

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
    ${renderBottomNav('matches')}
  `;
}

// ─── CHAT PAGE ────────────────────────────────────────────
function renderChatPage(convId, otherId) {
  const myUid = VeloraState.currentUser?.uid;
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;background:var(--bg-deep)">
      <div class="top-header">
        <button class="btn-icon btn-ghost" onclick="window._navigate('matches')">
          ${svgIcon('back', 20)}
        </button>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="avatar avatar-sm avatar-online" style="background:var(--bg-surface);overflow:hidden">
            <img src="${defaultAvatar(otherId)}" style="width:100%;height:100%;object-fit:cover" alt="User">
          </div>
          <div>
            <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">${otherId.replace('mock', 'Match ')}</div>
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
        ${(MESSAGE_SUGGESTIONS['pt-BR'] || []).map(s => `
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

// ─── FEED PAGE ────────────────────────────────────────────
function renderFeed() {
  const sparks = VeloraState.currentUser?.profile?.sparks || 0;
  const MOCK_POSTS = [
    {
      id: 'p1',
      authorName: 'Sofia Martins',
      authorPhoto: 'https://images.unsplash.com/photo-1529626455594-4ff0802cfb7e?w=100&q=80',
      authorAge: 26,
      text: 'Fim de semana incrível na praia! Quem mais ama o mar? 🌊☀️',
      image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=80',
      likes: 47,
      time: '2h',
      veloraScore: 87,
    },
    {
      id: 'p2',
      authorName: 'Luna Ferreira',
      authorPhoto: 'https://images.unsplash.com/photo-1567532939604-b6b5b0db2604?w=100&q=80',
      authorAge: 23,
      text: 'Observando estrelas é minha terapia favorita 🌟🔭 Alguém quer se juntar?',
      image: null,
      likes: 89,
      time: '4h',
      veloraScore: 95,
    },
    {
      id: 'p3',
      authorName: 'Valentina Rocha',
      authorPhoto: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=100&q=80',
      authorAge: 28,
      text: 'Fiz um jantar especial hoje! Receita no perfil 🍳❤️',
      image: 'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=400&q=80',
      likes: 134,
      time: '6h',
      veloraScore: 78,
    },
  ];

  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding:0 0 100px">
      <!-- Create post -->
      <div style="padding:var(--space-md) var(--space-lg);border-bottom:1px solid var(--glass-border)">
        <div style="display:flex;align-items:center;gap:var(--space-md)">
          <div class="avatar avatar-sm" style="background:var(--bg-surface);overflow:hidden">
            <img src="${defaultAvatar(VeloraState.currentUser?.displayName || '?')}" style="width:100%;height:100%;object-fit:cover">
          </div>
          <button class="input-field" style="flex:1;text-align:left;color:var(--text-muted);cursor:pointer;padding:12px 16px" onclick="window._createPost()">
            ${t('whatsOnYourMind')}
          </button>
          <button class="btn btn-primary btn-sm" onclick="window._createPost()">
            ${svgIcon('plus', 16)}
          </button>
        </div>
      </div>

      <!-- Posts -->
      ${MOCK_POSTS.map(post => `
        <div class="post-card">
          <div class="post-card-header">
            <div class="avatar avatar-md" style="background:var(--bg-surface);overflow:hidden">
              <img src="${post.authorPhoto}" style="width:100%;height:100%;object-fit:cover" alt="${post.authorName}">
            </div>
            <div style="flex:1">
              <div style="font-family:var(--font-display);font-weight:700">${post.authorName}, ${post.authorAge}</div>
              <div style="font-size:0.78rem;color:var(--text-muted)">${post.time} atrás</div>
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
            <button class="post-action-btn" id="like-btn-${post.id}" onclick="window._likePost('${post.id}', this)">
              ${svgIcon('heart', 16)} <span>${post.likes}</span>
            </button>
            <button class="post-action-btn" onclick="window._commentPost('${post.id}')">
              ${svgIcon('chat', 16)} Comentar
            </button>
            <button class="post-action-btn" onclick="window._sharePost('${post.id}')">
              ${svgIcon('send', 16)} Compartilhar
            </button>
          </div>
        </div>
      `).join('')}
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
    <div class="page-content" style="padding:0 0 100px">
      <!-- Cover -->
      <div style="height:160px;background:linear-gradient(135deg,var(--accent),var(--secondary));position:relative">
        <div style="position:absolute;bottom:-60px;left:var(--space-lg)">
          <div class="avatar avatar-xl avatar-ring-primary avatar-online" style="background:var(--bg-surface);overflow:hidden;border:4px solid var(--bg-deep)">
            <img src="${profile?.photoURL || defaultAvatar(user?.displayName || '?')}" style="width:100%;height:100%;object-fit:cover" alt="Profile">
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" style="position:absolute;bottom:12px;right:16px" onclick="window._editProfile()">
          ${svgIcon('settings', 16)} ${t('editProfile')}
        </button>
      </div>

      <div style="padding:70px var(--space-lg) var(--space-lg)">
        <div class="flex-between mb-sm">
          <div>
            <h2 style="font-family:var(--font-display);font-size:1.5rem;font-weight:800">
              ${profile?.displayName || user?.displayName || 'Usuário'}
              ${profile?.verified ? ' <span class="badge badge-verified">✓ Verificado</span>' : ''}
            </h2>
            <p style="color:var(--text-muted);font-size:0.85rem">${profile?.age ? `${profile.age} anos` : ''} ${profile?.bio ? '• ' + profile.bio.slice(0, 40) + '...' : ''}</p>
          </div>
          ${veloraScoreRing(profile?.veloraScore || 75)}
        </div>

        <!-- Level & XP -->
        <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-md);margin-bottom:var(--space-lg)">
          <div class="flex-between mb-sm">
            <div style="font-family:var(--font-display);font-weight:700;font-size:0.9rem">${t('level')} ${profile?.level || 1} — ${getLevelName(profile?.level || 1)}</div>
            <div style="font-size:0.82rem;color:var(--text-muted)">${profile?.xp || 0} ${t('xp')}</div>
          </div>
          <div class="xp-bar"><div class="xp-fill" style="width:${Math.min((profile?.xp || 0) % 100, 100)}%"></div></div>
        </div>

        <!-- Sparks balance -->
        <div class="glass" style="border-radius:var(--radius-lg);padding:var(--space-lg);margin-bottom:var(--space-lg);text-align:center;cursor:pointer" onclick="window._navigate('store')">
          <div style="font-size:2rem;margin-bottom:4px">✨</div>
          <div style="font-family:var(--font-display);font-weight:900;font-size:2rem;color:var(--gold)" data-sparks-balance>${sparks}</div>
          <div style="font-size:0.8rem;color:var(--text-muted)">Sparks • ${t('buySparks')}</div>
        </div>

        <!-- Interests -->
        ${profile?.interests?.length ? `
          <div class="mb-lg">
            <div class="section-title mb-sm">${t('yourInterests')}</div>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${(profile.interests || []).map(i => `<span class="tag active">${i}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Gallery preview -->
        <div class="mb-lg">
          <div class="section-header">
            <div class="section-title">${t('gallery')}</div>
            <div class="section-link" onclick="window._navigate('gallery')">${svgIcon('plus', 14)} Adicionar</div>
          </div>
          <div id="profile-gallery-preview" style="display:grid;grid-template-columns:repeat(3,1fr);gap:3px;border-radius:var(--radius-md);overflow:hidden">
            <div style="aspect-ratio:1;background:var(--bg-surface);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:1.5rem" onclick="window._navigate('gallery')">📷</div>
          </div>
        </div>

        <!-- Settings link -->
        <button class="btn btn-ghost btn-w-full" onclick="window._navigate('settings')">
          ${svgIcon('settings', 18)} ${t('settings')}
        </button>
        <button class="btn btn-ghost btn-w-full mt-sm" style="color:var(--danger)" onclick="window._logout()">
          🚪 ${t('logout')}
        </button>
      </div>
    </div>
    ${renderBottomNav('profile')}
  `;
}

// ─── DISCOVER PAGE ────────────────────────────────────────
function renderDiscoverPage() {
  const sparks = VeloraState.currentUser?.profile?.sparks || 0;
  const profiles = VeloraState.profiles.length ? VeloraState.profiles : MOCK_PROFILES;
  return `
    ${renderTopHeader(sparks)}
    <div class="page-content" style="padding:0 0 100px">
      <div style="padding:var(--space-lg) var(--space-lg) var(--space-sm);display:flex;align-items:center;justify-content:space-between">
        <h1 style="font-family:var(--font-display);font-size:1.4rem;font-weight:800">${t('discover')}</h1>
        <button class="btn btn-ghost btn-sm">
          ${svgIcon('filter', 16)} Filtros
        </button>
      </div>

      <!-- Heat map visual -->
      <div style="margin:0 var(--space-lg) var(--space-lg);padding:var(--space-md);background:var(--bg-card);border:1px solid var(--glass-border);border-radius:var(--radius-lg);text-align:center">
        <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;font-family:var(--font-display);font-weight:600;text-transform:uppercase;letter-spacing:0.05em">📍 Usuários próximos</div>
        <div style="height:80px;position:relative;overflow:hidden;border-radius:var(--radius-md)">
          ${Array.from({length: 15}, (_,i) => `
            <div style="position:absolute;width:${8+Math.random()*10}px;height:${8+Math.random()*10}px;border-radius:50%;background:var(--${['primary','secondary','accent'][i%3]});opacity:${0.4+Math.random()*0.6};left:${5+Math.random()*90}%;top:${10+Math.random()*80}%;box-shadow:0 0 ${8+Math.random()*12}px currentColor;animation:pulse ${1.5+Math.random()}s ease-in-out infinite ${Math.random()}s"></div>
          `).join('')}
        </div>
        <div style="font-size:0.82rem;color:var(--primary);margin-top:8px;font-weight:600">${profiles.length * 3}+ usuários online agora</div>
      </div>

      <!-- Profile grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:0 var(--space-lg)">
        ${profiles.map(p => `
          <div class="card card-hover" style="cursor:pointer;position:relative;overflow:hidden" onclick="window._viewProfile('${p.uid}')">
            <img src="${p.photoURL || defaultAvatar(p.displayName)}" style="width:100%;aspect-ratio:3/4;object-fit:cover" alt="${p.displayName}" loading="lazy">
            <div style="position:absolute;bottom:0;left:0;right:0;padding:var(--space-sm);background:linear-gradient(transparent,rgba(5,5,16,0.95))">
              <div style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">${p.displayName?.split(' ')[0]}, ${p.age}</div>
              <div style="font-size:0.75rem;color:var(--primary)">${svgIcon('location', 12)} ${p.kmAway} km</div>
            </div>
            ${p.verified ? `<div style="position:absolute;top:8px;right:8px"><span class="badge badge-verified">✓</span></div>` : ''}
            <div style="position:absolute;top:8px;left:8px">
              <div style="width:8px;height:8px;background:var(--success);border-radius:50%;box-shadow:0 0 8px var(--success)"></div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    ${renderBottomNav('discover')}
  `;
}

// ─── SETTINGS PAGE ────────────────────────────────────────
function renderSettings() {
  const profile = VeloraState.currentUser?.profile;
  return `
    <div style="min-height:100vh;background:var(--bg-deep)">
      <div class="top-header">
        <button class="btn-icon btn-ghost" onclick="window._navigate('profile')">
          ${svgIcon('back', 20)}
        </button>
        <span style="font-family:var(--font-display);font-weight:700">${t('settings')}</span>
        <div></div>
      </div>
      <div style="padding-bottom:40px">
        <div class="settings-section">
          <div class="settings-section-title">Conta</div>
          <div class="settings-item" onclick="window._editProfile()">
            <div class="settings-item-left">
              <div class="settings-icon" style="background:rgba(0,245,212,0.1)">👤</div>
              <div class="settings-item-title">${t('editProfile')}</div>
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
              <div class="settings-icon" style="background:rgba(124,60,255,0.1)">🌐</div>
              <div class="settings-item-title">${t('language')}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="settings-item-value">${i18n.getLangInfo()?.name || 'PT-BR'}</span>
              <span style="color:var(--text-muted)">›</span>
            </div>
          </div>
          <div class="settings-item">
            <div class="settings-item-left">
              <div class="settings-icon" style="background:rgba(255,43,214,0.1)">🔞</div>
              <div class="settings-item-title">${t('adultMode')}</div>
            </div>
            <label class="toggle-switch">
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
            <label class="toggle-switch">
              <input type="checkbox" checked>
              <div class="toggle-track"></div>
              <div class="toggle-thumb"></div>
            </label>
          </div>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Idioma</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:0 var(--space-lg)">
            ${Object.entries(LANGUAGES).map(([code, info]) => `
              <button class="btn ${i18n.getCurrentLang() === code ? 'btn-outline' : 'btn-ghost'}" style="justify-content:flex-start;gap:8px;font-size:0.85rem" onclick="window._setLanguage('${code}')">
                ${info.flag} ${info.name}
              </button>
            `).join('')}
          </div>
        </div>

        <div style="padding:0 var(--space-lg)">
          <button class="btn btn-ghost btn-w-full mt-lg" style="color:var(--danger)" onclick="window._confirmDeleteAccount()">
            ${svgIcon('trash', 18)} ${t('deleteAccount')}
          </button>
          <button class="btn btn-ghost btn-w-full mt-sm" onclick="window._logout()">
            🚪 ${t('logout')}
          </button>
        </div>
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

  window._navigate = async (page, data = {}) => {
    switch (page) {
      case 'splash':    showPage('splash', data); break;
      case 'onboarding': showPage('onboarding', data); break;
      case 'login':     showPage('login', data); break;
      case 'register':  showPage('register', data); break;
      case 'home':      await loadAndShowHome(); break;
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

  window._navBack = () => window.history.back();

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

  window._triggerLike = () => {
    VeloraState.swipeEngine?.triggerLike();
  };
  window._triggerPass = () => {
    VeloraState.swipeEngine?.triggerPass();
  };
  window._triggerSuperlike = () => {
    VeloraState.swipeEngine?.triggerSuperLike();
  };
  window._rewindSwipe = () => {
    showToast(`Desfazer requer ${3} ✨ Sparks`, 'gold');
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

  window._openChat = (convId, otherId) => {
    VeloraState.activeConvId = convId;
    showPage('chat', { convId, otherId });
  };

  window._purchaseSparks = async (pkgId) => {
    const uid = VeloraState.currentUser?.uid;
    if (!uid) return;
    await purchaseSparks(uid, pkgId);
    updateSparksDisplay();
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
    const uid = VeloraState.currentUser?.uid;
    if (!uid) { showToast('Faça login para adicionar fotos', 'error'); return; }
    const btn = document.getElementById('gallery-upload-input');
    showToast('Enviando foto...', 'info');
    try {
      await uploadPhoto(uid, file, false, (progress) => {
        showToast(`Enviando... ${Math.round(progress)}%`, 'info');
      });
      showToast('Foto adicionada! ✨', 'success');
      window._navigate('gallery');
    } catch (err) {
      showToast('Erro ao enviar foto: ' + err.message, 'error');
    }
  };

  window._editProfile = () => {
    showToast('Edição de perfil em breve!', 'info');
  };

  window._viewProfile = (uid) => {
    const profile = (VeloraState.profiles.length ? VeloraState.profiles : MOCK_PROFILES).find(p => p.uid === uid);
    if (!profile) return;
    showModal(`
      <div>
        <img src="${profile.photoURL || defaultAvatar(profile.displayName)}" style="width:100%;aspect-ratio:3/4;object-fit:cover">
        <div class="modal-body">
          <div class="flex-between mb-md">
            <div>
              <h2 style="font-family:var(--font-display);font-size:1.4rem;font-weight:800">${profile.displayName}, ${profile.age}</h2>
              <p style="color:var(--text-muted);font-size:0.85rem">${svgIcon('location', 14)} ${profile.kmAway} km</p>
            </div>
            ${veloraScoreRing(profile.veloraScore || 75)}
          </div>
          <p style="color:var(--text-secondary);margin-bottom:var(--space-md)">${profile.bio}</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:var(--space-lg)">
            ${(profile.interests || []).map(i => `<span class="tag">${i}</span>`).join('')}
          </div>
          <div style="display:flex;gap:12px">
            <button class="btn btn-ghost" style="flex:1" onclick="document.querySelector('.modal-overlay')?.remove()">
              ${svgIcon('x', 18)} ${t('pass')}
            </button>
            <button class="btn btn-primary" style="flex:2" onclick="document.querySelector('.modal-overlay')?.remove();showToast('Like enviado! ❤️','success')">
              ${svgIcon('heart', 18)} ${t('like')}
            </button>
          </div>
        </div>
      </div>
    `);
  };

  window._likePost = (postId, btn) => {
    btn.classList.toggle('liked');
    const span = btn.querySelector('span');
    const current = parseInt(span.textContent);
    span.textContent = btn.classList.contains('liked') ? current + 1 : current - 1;
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
        <button class="btn btn-primary btn-w-full" onclick="window._submitPost()">
          ${t('publish')}
        </button>
      </div>
    `, { centered: true });
  };

  window._submitPost = () => {
    const text = document.getElementById('post-text')?.value;
    if (!text?.trim()) return;
    document.querySelector('.modal-overlay')?.remove();
    showToast('Publicado com sucesso! ✨', 'success');
    window._navigate('feed');
  };

  window._sendSuggestion = (text) => {
    const input = document.getElementById('chat-input');
    if (input) { input.value = text; input.focus(); }
    document.getElementById('chat-suggestions')?.remove();
  };

  window._confirmDeleteAccount = async () => {
    const confirmed = await showConfirm('Excluir conta', 'Esta ação é irreversível. Todos os seus dados serão perdidos.', 'Sim, excluir conta');
    if (confirmed) showToast('Funcionalidade em implementação.', 'info');
  };
}

// ─── LOAD HOME ────────────────────────────────────────────
async function loadAndShowHome() {
  const uid = VeloraState.currentUser?.uid;
  if (uid) {
    try {
      const loaded = await loadProfiles(uid);
      VeloraState.profiles = loaded.length ? loaded : MOCK_PROFILES;
    } catch {
      VeloraState.profiles = MOCK_PROFILES;
    }
  } else {
    VeloraState.profiles = MOCK_PROFILES;
  }
  VeloraState.currentCardIdx = 0;
  showPage('home');
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
        const email    = el.querySelector('#login-email')?.value?.trim();
        const password = el.querySelector('#login-password')?.value;
        if (!email || !password) { showToast('Preencha todos os campos', 'error'); return; }
        loginBtn.classList.add('btn-loading');
        const { loginWithEmail } = await import('./auth.js');
        const res = await loginWithEmail(email, password);
        loginBtn.classList.remove('btn-loading');
        if (!res.success) showToast(res.error, 'error');
      });

      googleBtn?.addEventListener('click', async () => {
        const { loginWithGoogle } = await import('./auth.js');
        googleBtn.classList.add('btn-loading');
        const res = await loginWithGoogle();
        googleBtn.classList.remove('btn-loading');
        if (!res.success) showToast(res.error, 'error');
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
          const age = new Date().getFullYear() - new Date(birth).getFullYear();
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
          const age = new Date().getFullYear() - new Date(birth).getFullYear();

          const { registerWithEmail } = await import('./auth.js');
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
      const topCard = el.querySelector('#top-card');
      if (topCard && VeloraState.profiles.length > VeloraState.currentCardIdx) {
        const engine = new SwipeEngine(el.querySelector('#swipe-deck'), async (action) => {
          const profile = VeloraState.profiles[VeloraState.currentCardIdx];
          VeloraState.currentCardIdx++;
          const uid = VeloraState.currentUser?.uid || 'demo';

          if (action !== 'pass' && uid !== 'demo') {
            try {
              const result = await recordSwipe(uid, profile.uid, action);
              if (result.matched) {
                const myPhoto = VeloraState.currentUser?.profile?.photoURL;
                const theirPhoto = profile.photoURL;
                setTimeout(() => {
                  showMatchPopup(myPhoto, theirPhoto, profile.displayName,
                    () => window._openChat(result.matchId, profile.uid),
                    () => loadAndShowHome()
                  );
                }, 400);
              }
            } catch { /* demo mode */ }
          }

          // Simulate match in demo mode
          if (uid === 'demo' && action === 'like' && Math.random() > 0.5) {
            const myPhoto = VeloraState.currentUser?.profile?.photoURL;
            setTimeout(() => {
              showMatchPopup(myPhoto, profile.photoURL, profile.displayName,
                () => showToast('Chat disponível após login!', 'info'),
                () => {}
              );
            }, 500);
          }

          // Load next card after delay
          setTimeout(() => {
            if (VeloraState.currentCardIdx < VeloraState.profiles.length) {
              loadAndShowHome();
            } else {
              const deck = document.getElementById('swipe-deck');
              if (deck) deck.innerHTML = renderNoMoreCards();
              const actions = document.getElementById('swipe-actions');
              if (actions) actions.style.display = 'none';
            }
          }, 100);
        });
        engine.attach(topCard);
        VeloraState.swipeEngine = engine;
      }
    }

    if (pageId === 'matches') {
      const uid = VeloraState.currentUser?.uid;
      if (uid) {
        subscribeToMatches(uid, (matches) => {
          VeloraState.matchCount = matches.length;
          const container = el.querySelector('[id^="page-matches"] .page-content') || el;
          showPage('matches', matches);
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
  registerPage('gallery',   () => `
    <div style="min-height:100vh;background:var(--bg-deep)">
      <div class="top-header">
        <button class="btn-icon btn-ghost" onclick="window._navigate('profile')">${svgIcon('back', 20)}</button>
        <span style="font-family:var(--font-display);font-weight:700">${t('gallery')}</span>
        <button class="btn-icon btn-ghost" onclick="document.getElementById('gallery-upload-input').click()">${svgIcon('plus', 20)}</button>
      </div>
      <input type="file" id="gallery-upload-input" accept="image/*" style="display:none" onchange="window._handleGalleryUpload(event)">
      <div id="gallery-content" style="padding:var(--space-md)">
        <div class="flex-center" style="height:200px;color:var(--text-muted)">Carregando galeria...</div>
      </div>
    </div>
  `);
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
  try {
    initAuthObserver(
      async (user, profile) => {
        VeloraState.currentUser = { ...user, profile };
        updateSparksDisplay();
        await loadAndShowHome().catch(() => showPage('login'));
      },
      () => { /* not logged in — splash timer handles onboarding */ }
    );
  } catch (authErr) {
    console.warn('[VELORA] Firebase auth unavailable:', authErr.message);
    // splash timer still fires; nothing extra needed
  }
}
