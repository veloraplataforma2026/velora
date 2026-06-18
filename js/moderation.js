/* ============================================================
   VELORA — Moderation Module
   Block users, report users, filter blocked from feed
   ============================================================ */

import { db } from './firebase-config.js?v=8';
import {
  doc, setDoc, getDoc, getDocs,
  collection, query, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './ui.js?v=8';

const fsTimeout = (ms = 8000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), ms));

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Block User ───────────────────────────────────────────
export async function blockUser(currentUid, targetUid) {
  const ref = doc(db, 'blocks', currentUid, 'blocked', targetUid);
  await Promise.race([
    setDoc(ref, { blockedAt: serverTimestamp(), targetUid }),
    fsTimeout(),
  ]);
  showToast('Usuário bloqueado.', 'info');
}

// ─── Unblock User ─────────────────────────────────────────
export async function unblockUser(currentUid, targetUid) {
  const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
  const ref = doc(db, 'blocks', currentUid, 'blocked', targetUid);
  await Promise.race([deleteDoc(ref), fsTimeout()]);
  showToast('Usuário desbloqueado.', 'info');
}

// ─── Check if Blocked ────────────────────────────────────
export async function isBlocked(currentUid, targetUid) {
  try {
    const snap = await Promise.race([
      getDoc(doc(db, 'blocks', currentUid, 'blocked', targetUid)),
      fsTimeout(),
    ]);
    return snap.exists();
  } catch { return false; }
}

// ─── Get All Blocked UIDs ────────────────────────────────
export async function getBlockedUids(currentUid) {
  try {
    const snap = await Promise.race([
      getDocs(collection(db, 'blocks', currentUid, 'blocked')),
      fsTimeout(),
    ]);
    return new Set(snap.docs.map(d => d.id));
  } catch { return new Set(); }
}

// ─── Report User ─────────────────────────────────────────
export async function reportUser(currentUid, targetUid, reason = 'other') {
  const reportRef = doc(db, 'reports', `${currentUid}_${targetUid}`);
  await Promise.race([
    setDoc(reportRef, {
      reportedBy: currentUid,
      targetUid,
      reason,
      status: 'pending',
      createdAt: serverTimestamp(),
    }),
    fsTimeout(),
  ]);
  showToast('Denúncia enviada. Obrigado por manter a comunidade segura.', 'success');
}

// ─── Report Modal HTML ────────────────────────────────────
export function renderReportModal(currentUid, targetUid, targetName) {
  const safeCurrentUid = esc(currentUid);
  const safeTargetUid  = esc(targetUid);
  const safeName       = esc(targetName || 'usuário');

  const reasons = [
    { id: 'fake',        label: '🚫 Perfil falso / spam' },
    { id: 'harassment',  label: '⚠️ Assédio ou intimidação' },
    { id: 'nudity',      label: '🔞 Conteúdo inapropriado' },
    { id: 'underage',    label: '🛡️ Suspeito de ser menor de idade' },
    { id: 'scam',        label: '💸 Golpe / fraude' },
    { id: 'other',       label: '📌 Outro motivo' },
  ];

  return `
    <div style="padding:24px;max-width:400px;width:100%">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
        <h3 style="font-family:var(--font-display);font-size:1.1rem;font-weight:800;margin:0">Denunciar ${safeName}</h3>
        <button onclick="document.querySelector('.modal-overlay')?.remove()"
          style="width:32px;height:32px;border-radius:50%;background:var(--glass-bg);border:1px solid var(--glass-border);cursor:pointer;color:var(--text-primary);font-size:1rem;display:flex;align-items:center;justify-content:center">✕</button>
      </div>
      <p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:16px">Selecione o motivo da denúncia:</p>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
        ${reasons.map(r => `
          <label style="display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--glass-border);cursor:pointer;background:var(--bg-card)" class="report-option">
            <input type="radio" name="report-reason" value="${esc(r.id)}" style="accent-color:var(--primary)">
            <span style="font-size:0.9rem">${r.label}</span>
          </label>
        `).join('')}
      </div>
      <div style="display:flex;gap:10px">
        <button class="btn btn-ghost" style="flex:1" onclick="document.querySelector('.modal-overlay')?.remove()">Cancelar</button>
        <button class="btn btn-primary" id="report-submit-btn" style="flex:1;background:var(--danger);border-color:var(--danger)"
          data-current="${safeCurrentUid}" data-target="${safeTargetUid}">
          Denunciar
        </button>
      </div>
    </div>
  `;
}
