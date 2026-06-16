# Deploy do crédito de Sparks via Stripe (passo a passo)

Este documento cobre a parte que **só você** pode fazer — exige login no
Stripe Dashboard e no Firebase CLI com sua conta, e segredos que eu não
tenho acesso. O código já está pronto; falta só configurar e publicar.

## 1. Upgrade do projeto Firebase para o plano Blaze

Cloud Functions (2ª geração) exigem o plano pay-as-you-go (Blaze), mesmo
que o uso fique dentro da camada gratuita.

```
firebase open billing --project velora-social
```

ou faça isso direto no [Console do Firebase](https://console.firebase.google.com/project/velora-social/usage/details).

## 2. Adicionar metadata em cada Price do Stripe

No [Stripe Dashboard → Product catalog](https://dashboard.stripe.com/test/products),
para **cada um dos 3 Prices** usados nos Payment Links (`starter`, `popular`, `vip`):

1. Abra o Price → "Edit" → seção **Metadata**.
2. Adicione:
   - `sparks` = quantidade de Sparks daquele pacote (`100`, `500` ou `1500`)
   - `package_id` = `starter`, `popular` ou `vip` (precisa bater com `js/currency.js`)

A Cloud Function lê esse metadata para saber quanto creditar — sem ele,
o webhook recebe o pagamento mas não credita nada (e loga um erro).

## 3. Configurar os secrets da function

Rode estes dois comandos no seu terminal (eles pedem o valor de forma
interativa, sem ecoar na tela — não cole a chave em chat/histórico):

```
cd functions
firebase functions:secrets:set STRIPE_SECRET_KEY
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
```

- `STRIPE_SECRET_KEY`: Stripe Dashboard → Developers → API keys → "Secret key"
  (use a de **test mode**, já que os Payment Links atuais são `test_...`).
- `STRIPE_WEBHOOK_SECRET`: você só vai ter esse valor depois do passo 5
  (criar o endpoint do webhook) — pode voltar aqui depois.

## 4. Deploy da function

```
firebase deploy --only functions
```

Ao terminar, o CLI imprime a URL pública da function, algo como:
```
https://us-central1-velora-social.cloudfunctions.net/stripeWebhook
```
Guarde essa URL para o próximo passo.

## 5. Criar o endpoint de webhook no Stripe

No [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/test/webhooks):

1. "Add endpoint" → cole a URL do passo 4.
2. Em "Select events to listen to", marque **checkout.session.completed**.
3. Salve e copie o **Signing secret** (`whsec_...`).
4. Se ainda não fez no passo 3, rode:
   ```
   firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
   ```
   e cole esse `whsec_...`.
5. Rode `firebase deploy --only functions` de novo para a function pegar o secret atualizado.

## 6. Deploy das regras do Firestore

Isso pode (e deve) ser feito **junto** com o passo 4, para não deixar a
loja sem crédito funcionando no meio do caminho:

```
firebase deploy --only firestore:rules,functions
```

## 7. Testar

No Stripe Dashboard, os Payment Links de teste aceitam o cartão
`4242 4242 4242 4242` (qualquer CVC/validade futura). Compre um pacote
pelo app, complete o checkout, e confira:

- `firebase functions:log` deve mostrar `+<N> Sparks creditados para <uid>`.
- O saldo de Sparks no app deve atualizar sozinho em poucos segundos
  (o app fica ouvindo o documento do usuário em tempo real após o
  retorno do Stripe — ver `js/app.js`, bloco `_pendingStripePkg`).

## Por que isso é necessário (contexto de segurança)

Antes desta mudança, qualquer usuário logado podia chamar
`updateDoc(doc(db,'users',uid), {sparks: 999999})` direto do DevTools e
se autocreditar Sparks ilimitados — a regra do Firestore só bloqueava
saldo *negativo*, nunca um aumento indevido. A correção fecha essa porta
nas regras (`firestore.rules`), o que por sua vez exige que todo crédito
real passe por aqui: um servidor (Cloud Function) que só credita depois
de validar a assinatura do webhook do Stripe.
