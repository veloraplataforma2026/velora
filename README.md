# VELORA — Connect Beyond Limits

Plataforma social futurística de conexões românticas, amizades e relacionamentos casuais, com design "Bioluminescência Quântica" único no mercado.

## 🚀 Tecnologias

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (SPA Customizada)
- **Backend/BaaS:** Firebase (Authentication, Firestore, Storage, Hosting)
- **Estilo:** Design System proprietário com animações fluidas e glassmorphism

## 🌟 Funcionalidades

- **Swipe & Match:** Gestos de swipe fluidos, matches em tempo real via Firestore
- **Galeria com Bloqueio (SPARKS):** Upload de fotos no Firebase Storage. Opção de bloquear fotos e cobrar moeda virtual (SPARKS ✨) para visualizar
- **Chat ao Vivo:** Mensagens em tempo real, status de "digitando"
- **Moeda Virtual (SPARKS ✨):** Usada para desbloquear recursos premium, dar Super Likes e ver fotos bloqueadas
- **Multilíngue:** Suporte para PT-BR, PT-PT, EN, ES, FR, DE
- **Feed Social:** Integração de posts com cards de perfil

## 🛠 Configuração do Projeto (Local)

1. Clone o repositório
2. Abra o arquivo `js/firebase-config.js` e substitua as configurações com as chaves do seu projeto Firebase.
3. Para rodar localmente, basta servir a pasta `velora/` usando uma extensão como "Live Server" ou `npx serve`.

## ☁️ Deploy no Firebase Hosting

1. Instale o Firebase CLI: `npm install -g firebase-tools`
2. Faça login: `firebase login`
3. Associe ao seu projeto: `firebase use seu-projeto-id`
4. Faça o deploy: `firebase deploy --only hosting`

## 🎨 Design System: Bioluminescência Quântica

- `Background`: #050510 (Espaço profundo)
- `Primary`: #00F5D4 (Teal bioluminescente)
- `Secondary`: #FF2BD6 (Magenta neon)
- `Accent`: #7C3CFF (Violeta elétrico)
- `Premium`: #F7C948 (Ouro/SPARKS)
