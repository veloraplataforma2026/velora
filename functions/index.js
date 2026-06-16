/* ============================================================
   VELORA — Cloud Functions
   ────────────────────────────────────────────────────────────
   Webhook do Stripe: ÚNICO caminho autorizado a AUMENTAR o saldo
   de Sparks de um usuário.

   Por quê isso existe:
   As regras do Firestore (firestore.rules) agora bloqueiam
   qualquer tentativa do CLIENTE de aumentar o campo `sparks`
   (só permitem criar com 50 e diminuir via gasto). A Admin SDK
   usada aqui ignora essas regras — então só código rodando no
   servidor, depois de validar a assinatura do Stripe, pode
   creditar Sparks de verdade.

   Configuração necessária antes do deploy (ver README-FUNCTIONS.md):
   1. firebase functions:secrets:set STRIPE_SECRET_KEY
   2. firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   3. Em cada Price do Stripe (Dashboard → Product catalog → Price),
      adicionar metadata: sparks=<quantidade>, package_id=<starter|popular|vip>
   4. Configurar o endpoint do webhook no Stripe Dashboard apontando
      para a URL desta function (gerada após o primeiro deploy) com
      o evento "checkout.session.completed".
   ============================================================ */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();
const db = admin.firestore();

const STRIPE_SECRET_KEY     = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], region: 'us-central1', cors: false },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const signature = req.headers['stripe-signature'];

    let event;
    try {
      // req.rawBody é preservado pelo runtime de Cloud Functions
      // especificamente para permitir esta verificação de assinatura.
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value());
    } catch (err) {
      logger.warn('[stripeWebhook] Assinatura inválida:', err.message);
      res.status(400).send(`Webhook signature error: ${err.message}`);
      return;
    }

    if (event.type !== 'checkout.session.completed') {
      res.status(200).send('ignored: ' + event.type);
      return;
    }

    const session = event.data.object;
    const uid = session.client_reference_id;

    if (!uid) {
      // Sem client_reference_id não há como saber quem creditar.
      // Isso só acontece se o link do Stripe for aberto sem o
      // parâmetro ?client_reference_id=<uid> (ver js/currency.js).
      logger.error('[stripeWebhook] Sessão sem client_reference_id', { sessionId: session.id });
      res.status(200).send('no client_reference_id');
      return;
    }

    // ─── Idempotência ───────────────────────────────────────
    // O Stripe pode reentregar o mesmo evento mais de uma vez.
    // Registramos o event.id ANTES de creditar; se já existir,
    // não credita de novo.
    const eventRef = db.collection('stripeEvents').doc(event.id);
    const alreadyProcessed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);
      if (snap.exists) return true;
      tx.set(eventRef, {
        sessionId: session.id,
        uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return false;
    });

    if (alreadyProcessed) {
      res.status(200).send('duplicate event, skipped');
      return;
    }

    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        expand: ['data.price'],
      });

      let sparksToCredit = 0;
      let packageId = null;
      for (const item of lineItems.data) {
        const meta = item.price?.metadata || {};
        if (meta.sparks) {
          sparksToCredit += parseInt(meta.sparks, 10) * (item.quantity || 1);
          packageId = meta.package_id || packageId;
        }
      }

      if (!sparksToCredit || sparksToCredit <= 0) {
        logger.error('[stripeWebhook] Nenhum metadata "sparks" no Price do Stripe — configure no Dashboard.', {
          sessionId: session.id,
        });
        res.status(200).send('no sparks metadata configured on Stripe Price');
        return;
      }

      const userRef = db.collection('users').doc(uid);
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) throw new Error(`Usuário ${uid} não encontrado.`);
        tx.update(userRef, { sparks: admin.firestore.FieldValue.increment(sparksToCredit) });
      });

      await db.collection('transactions').add({
        userId: uid,
        type: 'credit',
        amount: sparksToCredit,
        description: `Compra confirmada via Stripe${packageId ? ` (${packageId})` : ''}`,
        stripeSessionId: session.id,
        stripeEventId: event.id,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      logger.info(`[stripeWebhook] +${sparksToCredit} Sparks creditados para ${uid} (sessão ${session.id}).`);
      res.status(200).send('ok');
    } catch (err) {
      logger.error('[stripeWebhook] Erro ao creditar Sparks:', err);
      // Libera o registro de idempotência para o Stripe poder tentar
      // de novo (ele reenvia o webhook em caso de resposta não-2xx).
      await eventRef.delete().catch(() => {});
      res.status(500).send('internal error');
    }
  }
);
