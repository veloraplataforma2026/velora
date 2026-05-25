/* ============================================================
   VELORA — Push Notifications (Firebase Cloud Messaging)
   Request permission, store FCM token, handle foreground msgs
   ============================================================ */

import { db } from './firebase-config.js?v=7';
import { doc, updateDoc } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { showToast } from './ui.js?v=7';

// VAPID public key from Firebase Console → Project Settings → Cloud Messaging
const VAPID_KEY = 'BBG2twdX5vIMxgm3kUAxfkgLBcT2D0DHHbwwxh1Gf0au4HUsGUAJRWUMwyMRqGb0b1z76HckVSOEjQXBhx4W9-A';

let _messaging = null;

async function getMessaging() {
  if (_messaging) return _messaging;
  try {
    const { getMessaging: _getMsg } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    const { default: app } = await import('./firebase-config.js?v=7');
    _messaging = _getMsg(app);
  } catch {
    _messaging = null;
  }
  return _messaging;
}

// ─── Request Permission & Get Token ──────────────────────
export async function requestNotificationPermission(uid) {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  try {
    const messaging = await getMessaging();
    if (!messaging) return false;

    const { getToken } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });

    if (token && uid) {
      await updateDoc(doc(db, 'users', uid), { fcmToken: token, notificationsEnabled: true });
    }
    return true;
  } catch (err) {
    console.warn('[VELORA] FCM token error:', err.message);
    return false;
  }
}

// ─── Handle Foreground Messages ───────────────────────────
export async function initForegroundMessages() {
  try {
    const messaging = await getMessaging();
    if (!messaging) return;
    const { onMessage } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
    onMessage(messaging, (payload) => {
      const { title, body } = payload.notification || {};
      if (title || body) showToast(`${title ? title + ': ' : ''}${body || ''}`, 'info');
    });
  } catch { /* FCM not available */ }
}

// ─── Disable Notifications ────────────────────────────────
export async function disableNotifications(uid) {
  if (!uid) return;
  try {
    await updateDoc(doc(db, 'users', uid), { fcmToken: null, notificationsEnabled: false });
  } catch { /* non-fatal */ }
}

// ─── Check Permission Status ──────────────────────────────
export function getNotificationStatus() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}
