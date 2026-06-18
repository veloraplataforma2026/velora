/* ============================================================
   VELORA — Chat Module
   Real-time messaging via Firestore onSnapshot,
   typing indicators, message reactions
   ============================================================ */

import { db } from './firebase-config.js?v=8';
import {
  collection, doc, addDoc, onSnapshot,
  query, orderBy, serverTimestamp, setDoc, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { VeloraState } from './app.js?v=8';
import { svgIcon, formatDate } from './ui.js?v=8';

let unsubscribeChat = null;
let typingTimeout = null;

// ─── Subscribe to Messages ────────────────────────────────
export function subscribeToChat(conversationId, callback) {
  if (unsubscribeChat) unsubscribeChat();
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');
  const q = query(messagesRef, orderBy('createdAt', 'asc'));
  unsubscribeChat = onSnapshot(q, (snap) => {
    const messages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(messages);
  });
  return () => { if (unsubscribeChat) unsubscribeChat(); };
}

const to = (ms = 8000) => new Promise((_, r) => setTimeout(() => r(new Error('Timeout ao enviar mensagem.')), ms));

// ─── Send Message ─────────────────────────────────────────
export async function sendMessage(conversationId, text, senderId) {
  if (!text.trim()) return;
  const messagesRef = collection(db, 'conversations', conversationId, 'messages');
  await Promise.race([
    addDoc(messagesRef, { text: text.trim(), senderId, createdAt: serverTimestamp(), read: false, reactions: {} }),
    to(),
  ]);
  const convRef = doc(db, 'conversations', conversationId);
  await Promise.race([
    setDoc(convRef, { lastMessage: text.trim(), lastAt: serverTimestamp(), lastSender: senderId }, { merge: true }),
    to(),
  ]);
}

// ─── Set Typing State ─────────────────────────────────────
export async function setTyping(conversationId, uid, isTyping) {
  const convRef = doc(db, 'conversations', conversationId);
  // Fire-and-forget — typing indicator is non-critical
  setDoc(convRef, { [`typing_${uid}`]: isTyping }, { merge: true }).catch(() => {});
}

// ─── Render Messages ──────────────────────────────────────
export function renderMessages(messages, myUid) {
  if (!messages.length) {
    return `
      <div class="empty-state" style="padding: 40px 20px">
        <div class="empty-state-icon">💬</div>
        <p class="text-muted text-sm text-center">Seja o primeiro a dizer olá!</p>
      </div>
    `;
  }

  return messages.map((msg, i) => {
    const isMine = msg.senderId === myUid;
    const showTime = i === messages.length - 1 ||
      (messages[i + 1]?.senderId !== msg.senderId);
    const time = msg.createdAt ? formatDate(msg.createdAt) : '';

    return `
      <div class="message-row ${isMine ? 'sent' : 'received'}" id="msg-${msg.id}">
        <div class="flex-col gap-xs" style="${isMine ? 'align-items:flex-end' : 'align-items:flex-start'}">
          <div class="message-bubble ${isMine ? 'sent' : 'received'}">${escapeHtml(msg.text)}</div>
          ${showTime ? `<div class="message-time">${time}${isMine ? ' ✓✓' : ''}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// ─── Typing Indicator HTML ────────────────────────────────
export function typingIndicatorHTML() {
  return `
    <div class="message-row received" id="typing-indicator">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
}

// ─── Message Suggestions ──────────────────────────────────
export const MESSAGE_SUGGESTIONS = {
  'pt-BR': ['Oi! Vi seu perfil e adorei 😊', 'Olá! O que está fazendo hoje?', 'Ei! Que tal conversarmos? 💬', 'Oi! Adoro seus interesses também!'],
  'en':    ['Hey! Loved your profile 😊', 'Hi! What are you up to today?', "Hello! Let's chat? 💬", 'Hey! I love your interests too!'],
  'es':    ['¡Hola! Me encantó tu perfil 😊', '¡Hola! ¿Qué estás haciendo hoy?', '¡Oye! ¿Hablamos? 💬', '¡Hola! Me encantan tus intereses!'],
};

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
