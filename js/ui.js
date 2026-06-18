/* ============================================================
   VELORA — UI Utilities
   Toast notifications, page transitions, modal system,
   particle system, confetti, and common UI helpers
   ============================================================ */

import { t } from './i18n.js?v=7';

// ─── Page Router ──────────────────────────────────────────
const pages = new Map();
let currentPage = null;

export function registerPage(id, renderFn) {
  pages.set(id, renderFn);
}

const SIDEBAR_PAGES = new Set(['home','discover','feed','matches','profile','settings','store','gallery','chat']);

export function showPage(pageId, data = {}) {
  const app = document.getElementById('app');
  if (!app) return;

  app.classList.toggle('has-sidebar', SIDEBAR_PAGES.has(pageId));

  const renderFn = pages.get(pageId);
  if (!renderFn) return;

  // Fade out and remove the leaving page
  const leaving = currentPage;
  if (leaving) {
    leaving.style.pointerEvents = 'none';
    leaving.style.transition = 'opacity 0.25s ease';
    leaving.style.opacity = '0';
    setTimeout(() => leaving.remove(), 300);
  }

  // Create new page — immediately visible, no CSS animation dependency
  const pageEl = document.createElement('div');
  pageEl.className = 'page';
  pageEl.id = `page-${pageId}`;

  try {
    pageEl.innerHTML = renderFn(data);
  } catch (err) {
    console.error(`[VELORA] render error for "${pageId}":`, err);
    pageEl.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#050510;color:#00F5D4;font-family:Outfit,sans-serif;font-size:1rem">Erro ao carregar página</div>`;
  }

  app.appendChild(pageEl);
  currentPage = pageEl;
  app.scrollTop = 0;

  window.dispatchEvent(new CustomEvent('pageReady', { detail: { pageId, data, el: pageEl } }));
}

// ─── Toast System ─────────────────────────────────────────
let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);
    }
  }
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 3000) {
  const container = getToastContainer();
  const icons = { success: '✅', error: '❌', info: '✨', gold: '⭐' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type] || '💬'}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastExit 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Modal System ─────────────────────────────────────────
export function showModal(content, options = {}) {
  const { centered = false, fullscreen = false, wide = false, onClose } = options;
  const overlay = document.createElement('div');
  overlay.className = `modal-overlay${centered ? ' modal-center' : ''}${fullscreen ? ' modal-fullscreen' : ''}`;

  const modal = document.createElement('div');
  modal.className = `modal${centered ? ' modal-rounded' : ''}${wide ? ' modal-wide' : ''}`;
  if (!centered && !fullscreen) {
    modal.innerHTML = `<div class="modal-handle"></div>`;
  }
  modal.innerHTML += content;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeModal(overlay);
      onClose?.();
    }
  });

  return {
    el: overlay,
    close: () => closeModal(overlay),
  };
}

function closeModal(overlay) {
  overlay.style.animation = 'fadeOut 0.2s ease forwards';
  setTimeout(() => overlay.remove(), 200);
}

// ─── Confirm Dialog ───────────────────────────────────────
export function showConfirm(title, message, confirmText, cancelText = t('cancel')) {
  return new Promise((resolve) => {
    const modal = showModal(`
      <div class="modal-body">
        <h3 class="text-xl font-bold mb-md">${title}</h3>
        <p class="text-muted mb-lg">${message}</p>
        <div class="flex-col gap-sm">
          <button class="btn btn-secondary btn-w-full" id="confirm-yes">${confirmText}</button>
          <button class="btn btn-ghost btn-w-full" id="confirm-no">${cancelText}</button>
        </div>
      </div>
    `, { centered: true });

    modal.el.querySelector('#confirm-yes').addEventListener('click', () => {
      modal.close();
      resolve(true);
    });
    modal.el.querySelector('#confirm-no').addEventListener('click', () => {
      modal.close();
      resolve(false);
    });
  });
}

// ─── Confetti ─────────────────────────────────────────────
const CONFETTI_COLORS = ['#00F5D4', '#FF2BD6', '#7C3CFF', '#F7C948', '#FFFFFF'];

export function launchConfetti(count = 60) {
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.cssText = `
        left: ${Math.random() * 100}vw;
        top: -20px;
        background: ${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
        width: ${4 + Math.random() * 8}px;
        height: ${4 + Math.random() * 8}px;
        animation-duration: ${1.5 + Math.random() * 2}s;
        animation-delay: ${Math.random() * 0.5}s;
      `;
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3000);
    }, i * 30);
  }
}

// ─── Match Popup ──────────────────────────────────────────
export function showMatchPopup(myPhoto, theirPhoto, theirName, onMessage, onSkip) {
  launchConfetti();

  const popup = document.createElement('div');
  popup.className = 'match-popup';
  popup.innerHTML = `
    <div class="match-avatars animate-popIn">
      <img class="match-avatar" src="${myPhoto || defaultAvatar()}" alt="You">
      <img class="match-avatar" src="${theirPhoto || defaultAvatar()}" alt="${theirName}">
    </div>
    <div class="match-title animate-popIn delay-200">${t('itsAMatch')}</div>
    <p class="match-subtitle animate-fadeIn delay-300">
      ${t('matchDesc', { name: theirName })}
    </p>
    <div class="flex-col gap-md mt-lg px-lg w-full animate-slideUp delay-400">
      <button class="btn btn-primary btn-lg btn-w-full" id="match-msg-btn">
        💬 ${t('sendMessage')}
      </button>
      <button class="btn btn-ghost btn-w-full" id="match-skip-btn">
        ${t('keepSwiping')}
      </button>
    </div>
    <!-- Burst rings -->
    <div class="splash-ring-1" style="width:300px;height:300px;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
    <div class="splash-ring-2" style="width:450px;height:450px;top:50%;left:50%;transform:translate(-50%,-50%)"></div>
  `;
  document.body.appendChild(popup);

  popup.querySelector('#match-msg-btn').addEventListener('click', () => {
    popup.remove();
    onMessage?.();
  });
  popup.querySelector('#match-skip-btn').addEventListener('click', () => {
    popup.remove();
    onSkip?.();
  });
}

// ─── Particle System ──────────────────────────────────────
export function initParticles() {
  const canvas = document.getElementById('particle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const isMobile = window.innerWidth <= 480;
  const COUNT    = isMobile ? 28 : 50;
  const CONNECT  = isMobile ? 80 : 110;

  const resize = () => {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const COLORS = [
    'rgba(0,245,212,',
    'rgba(255,43,214,',
    'rgba(124,60,255,',
    'rgba(247,201,72,',
  ];

  const particles = Array.from({ length: COUNT }, () => ({
    x:     Math.random() * canvas.width,
    y:     Math.random() * canvas.height,
    vx:    (Math.random() - 0.5) * 0.35,
    vy:    (Math.random() - 0.5) * 0.35,
    r:     Math.random() * 1.8 + 0.4,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    alpha: Math.random() * 0.45 + 0.1,
    pulse: Math.random() * Math.PI * 2,
  }));

  let frame = 0;
  let rafId = null;

  function animate() {
    if (document.hidden) { rafId = null; return; }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    frame++;
    const drawConnections = frame % 2 === 0; // skip connections every other frame on mobile

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.pulse += 0.018;
      const alpha = p.alpha * (0.65 + 0.35 * Math.sin(p.pulse));

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `${p.color}${alpha})`;
      ctx.fill();

      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

      if (!drawConnections && isMobile) continue;

      // Connections — only forward pairs to halve the work
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p.x - p2.x;
        const dy = p.y - p2.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < CONNECT * CONNECT) {
          const dist = Math.sqrt(distSq);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.strokeStyle = `${p.color}${0.06 * (1 - dist / CONNECT)})`;
          ctx.lineWidth = 0.4;
          ctx.stroke();
        }
      }
    }

    rafId = requestAnimationFrame(animate);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !rafId) animate();
  });

  animate();
}

// ─── Helpers ──────────────────────────────────────────────
export function defaultAvatar(name = '?') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=0D0D2B&color=00F5D4&bold=true&size=200`;
}

export function formatTime(date) {
  const now = new Date();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return t('timeNow');
  if (mins < 60) return `${mins}min`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString();
}

export function formatDate(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getAge(birthDate) {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function svgIcon(name, size = 24) {
  const icons = {
    home: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    discover: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
    heart: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    chat: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    feed: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>`,
    user: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    camera: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
    send: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`,
    lock: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
    star: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    x: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    settings: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    back: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`,
    plus: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    trash: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
    filter: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    location: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    eye: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
    eyeOff: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`,
    image: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
    undo: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.46"/></svg>`,
    bolt: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    gift: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
  };
  return icons[name] || '';
}

export function veloraScoreRing(score, size = 72) {
  const r = (size / 2) - 8;
  const circ = 2 * Math.PI * r;
  const fill = circ - (score / 100) * circ;
  return `
    <div class="velora-score">
      <div class="score-ring" style="width:${size}px;height:${size}px">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
          <defs>
            <linearGradient id="scoreGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" style="stop-color:#00F5D4"/>
              <stop offset="100%" style="stop-color:#FF2BD6"/>
            </linearGradient>
          </defs>
          <circle class="score-ring-track" cx="${size/2}" cy="${size/2}" r="${r}"/>
          <circle class="score-ring-fill"
            cx="${size/2}" cy="${size/2}" r="${r}"
            stroke-dasharray="${circ}"
            stroke-dashoffset="${fill}"
            style="--target-offset:${fill}"
          />
        </svg>
        <div class="score-value">${score}</div>
      </div>
      <div class="score-label">VeloraScore™</div>
    </div>
  `;
}
