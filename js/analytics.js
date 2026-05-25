/* ============================================================
   VELORA — Firebase Analytics
   Tracks key user actions for product insights
   ============================================================ */

import { getAnalytics, logEvent as _logEvent } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics.js';
import app from './firebase-config.js?v=7';

let _analytics = null;

function getAn() {
  if (!_analytics) {
    try { _analytics = getAnalytics(app); } catch { /* analytics blocked */ }
  }
  return _analytics;
}

function log(eventName, params = {}) {
  const an = getAn();
  if (an) _logEvent(an, eventName, params);
}

export const analytics = {
  logLogin:     (method = 'email')      => log('login',          { method }),
  logSignUp:    (method = 'email')      => log('sign_up',        { method }),
  logLogout:    ()                       => log('logout'),
  logSwipe:     (action, targetUid)     => log('swipe',          { action, target_uid: targetUid }),
  logMatch:     (matchId)               => log('match',          { match_id: matchId }),
  logSuperLike: (targetUid)             => log('super_like',     { target_uid: targetUid }),
  logBoost:     (durationHours)         => log('profile_boost',  { duration_hours: durationHours }),
  logPurchase:  (pkgId, sparks, brl)    => log('purchase',       { currency: 'BRL', package_id: pkgId, sparks, value: brl }),
  logStoryView: (storyId, authorUid)    => log('story_view',     { story_id: storyId, author_uid: authorUid }),
  logStoryPost: ()                       => log('story_post'),
  logPageView:  (pageName)              => log('page_view',      { page_name: pageName }),
  logBlock:     ()                       => log('block_user'),
  logReport:    (reason)                => log('report_user',    { reason }),
  logUnlock:    (cost)                  => log('photo_unlock',   { cost }),
};
