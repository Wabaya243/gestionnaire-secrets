# Gestionnaire web sécurisé de secrets

Projet du cours **Protocoles de Sécurité Réseau** — Master 1, Université de Kinshasa (2026).

- **Site déployé** : https://gestionnaire-secrets.onrender.com
- **Dépôt** : https://github.com/Wabaya243/gestionnaire-secrets

---

## Membres du groupe 13

| Nom |
|---|
| THEYTHEY KAMBALE DIVIN |
| MUELA MPIANA POPOL |
| TATY MUNSI MANASSE |
| MBENGA EZIBE ANDERSON |
| MANZITA LUZOLO FRANCK |

---

## Objectif

Coffre-fort en ligne permettant de stocker des secrets (mots de passe, clés d'API)
protégés par un unique mot de passe maître.

La propriété centrale est le **zero-knowledge** : toute la cryptographie s'exécute
dans le navigateur. Le serveur stocke des données chiffrées qu'il est structurellement
incapable de lire, et ne reçoit jamais le mot de passe maître.

---

## Mécanismes de sécurité (protocoles)

| Mécanisme | Rôle | Menace traitée |
|---|---|---|
| Argon2id (client + serveur) | Dérivation de clé memory-hard | Force brute hors ligne, tables arc-en-ciel |
| AES-GCM 256 | Chiffrement authentifié | Lecture et altération des secrets |
| TOTP (RFC 6238) | Second facteur | Vol du mot de passe maître |
| Verrouillage après échecs | 5 tentatives, 15 min | Force brute en ligne |
| zxcvbn | Indicateur de robustesse | Mot de passe maître faible |
| HTTPS/TLS | Chiffrement du transport | Interception réseau |
| Cookie HttpOnly + CSP | Protection session | Vol de session, XSS |

---

## Architecture

### Chaîne cryptographique

Mot de passe maître (navigateur)
│
├── Argon2id("auth|" + sel) ──> auth_hash ──> serveur ──> Argon2id ──> base
│
└── Argon2id("enc|" + sel) ──> clé AES-256 (reste dans le navigateur)
│
AES-GCM(secret, nonce)
│
[nonce][chiffré][tag] ──> base


La **séparation de domaine** garantit que le hash transmis au serveur ne révèle
rien sur la clé de chiffrement. Le **double hachage** garantit qu'un vol de la
base ne permet pas de rejouer le hash volé pour s'authentifier.

### Stack

| Couche | Technologie |
|---|---|
| Frontend | React, Vite, hash-wasm, WebCrypto, zxcvbn |
| Backend | FastAPI, SQLModel, argon2-cffi, pyotp, slowapi, PyJWT |
| Base | SQLite (dev), PostgreSQL (prod) |
| Hébergement | Render (Frankfurt) |

### Modèle de données

`user` — email, kdf_salt (public), auth_hash, totp_secret, mfa_enabled,
failed_attempts, locked_until

`vaultitem` — user_id, label_enc, payload_enc
(le libellé est chiffré lui aussi)

### Défenses spécifiques

- **Anti-énumération** : sel factice déterministe pour email inconnu, messages d'erreur identiques
- **Anti-timing** : hachage Argon2 exécuté même si l'utilisateur n'existe pas
- **IDOR** : filtre `user_id` dans la requête SQL, réponse 404 jamais 403
- **XSS** : clé AES non extractible, JWT en cookie `HttpOnly`, CSP restrictive
- **CSRF** : `SameSite=Lax`, service mono-origine

---

## Installation locale

### Prérequis

- Python 3.12, conda
- Node.js 20+, npm

### Backend

```bash
cd backend
conda create -n secrets-back python=3.12 -y
conda activate secrets-back
pip install -r requirements.txt
cp .env.example .env   # renseigner JWT_SECRET
uvicorn app.main:app --reload --port 8000
```

Générer un secret JWT :

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Interface : `http://localhost:5173` — API : `http://127.0.0.1:8000/docs`

### Variables d'environnement

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de la base |
| `JWT_SECRET` | Secret de signature des jetons (obligatoire) |
| `JWT_EXPIRE_MINUTES` | Durée de vie des jetons (défaut : 15) |
| `ENVIRONMENT` | `development` ou `production` |

Aucun secret n'est versionné : `.env` est exclu par `.gitignore`.

---

## Déploiement

Hébergé sur **Render** (Frankfurt) en service unique : FastAPI sert l'API
et les fichiers statiques du build React. Même origine → pas de CORS,
cookie `SameSite=Lax`.

| Élément | Valeur |
|---|---|
| Build Command | `./build.sh` |
| Start Command | `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Base | PostgreSQL 16 (plan gratuit, expire 30 jours) |
| HTTPS/TLS | Certificat automatique Render |

Le script `build.sh` compile le frontend, copie le résultat dans
`backend/static`, puis installe les dépendances Python.

> Le plan gratuit met le service en veille après 15 min d'inactivité.
> Premier chargement : 30 à 50 secondes.

---

## Tests

Tous les tests ont été menés sur l'application déployée, en navigation privée,
avec des données fictives.

| Propriété vérifiée | Méthode | Résultat |
|---|---|---|
| Mot de passe non transmis | Inspection onglet Réseau (F12) | Absent de toutes les requêtes |
| Sels uniques | Deux comptes, même mot de passe | Condensats sans ressemblance |
| Condensat non rejouable | Soumission de `auth_hash` stocké | Connexion refusée (401) |
| Données illisibles en base | Lecture directe PostgreSQL | Blobs base64 opaques |
| Verrouillage | 5 échecs consécutifs | 423 au sixième essai |
| Second facteur | Connexion après activation MFA | Code TOTP exigé |

---

## Calibration d'Argon2id

Mesures relevées dans le navigateur (machine de développement) :

| Mémoire | Itérations | Durée |
|---|---|---|
| 19 Mio | 3 | 67 ms |
| 64 Mio | 3 | 195 ms |
| 64 Mio | 10 | *(à compléter)* |

Paramètres retenus : `m=64 Mio, t=10, p=1`.

---

## Identifiants de démonstration

- **Email** : `demo@exemple.cd`
- **Mot de passe maître** : *Demotest01*
- vous pouvez creer vos autres comptes pour tester les transfert de fichier et l'enregistrement

Ce compte contient uniquement des données fictives.
La double authentification **n'est pas activée** sur ce compte afin que
le correcteur puisse se connecter sans application TOTP.

---

## Limites connues

- Mot de passe maître irrécupérable (conséquence du zero-knowledge)
- Secret TOTP stocké en clair côté serveur (nécessaire à la vérification)
- XSS dans l'application donnerait accès à la clé en mémoire
- Serveur malveillant pourrait servir un JavaScript modifié
- Rotation des identités de partage et signature asymétrique des expéditeurs non implémentées
- Métadonnées (comptes, tailles, dates et relations de partage) visibles du serveur
- Base PostgreSQL gratuite expire 30 jours après création

---

## Dépendances externes

`FastAPI`, `SQLModel`, `argon2-cffi`, `PyJWT`, `pyotp`, `slowapi`,
`psycopg`, `React`, `Vite`, `hash-wasm`, `zxcvbn`, `qrcode.react`,
`lucide-react`, `tailwindcss`


## Extension : tableaux de bord et fichiers chiffrés

- **Tableau de bord utilisateur** : compteurs, stockage, état MFA et activité récente.
- **Administration** : vue globale, liste paginée des comptes, désactivation/réactivation
  avec invalidation des sessions, déblocage et journal des actions ; MFA obligatoire.
- **Fichiers** : AES-256-GCM dans le navigateur, noms et métadonnées également chiffrés,
  une clé par fichier, blobs stockés en base (10 Mio/fichier, 100 Mio/compte par défaut).
- **Partage** : enveloppe RSA-3072-OAEP/SHA-256 de la clé du fichier pour le destinataire,
  clé privée protégée par la clé du coffre, comparaison d'empreinte par un canal indépendant,
  révocation des téléchargements futurs.
- **MFA** : activation et désactivation depuis le tableau de bord ; la désactivation
  demande un code TOTP valide et efface l'ancien secret TOTP.
- **Administration** : recherche par adresse, promotion avec MFA, suspension pour 1 heure,
  24 heures ou 7 jours, désactivation jusqu’à réactivation, suppression définitive des
  comptes ordinaires avec leurs données chiffrées. Une nouvelle connexion est exigée
  après promotion ou suspension. Les admins ne peuvent pas être supprimés via l’interface.
- **Migration** : révisions additives `001_files_dashboards` et `002_admin_controls` appliquées au démarrage,
  sans modification des secrets chiffrés existants. Sauvegarder la base avant déploiement.

L'admin ne peut jamais lire les secrets ou fichiers d'autres comptes par son rôle.
Le partage de fichiers est un accès accordé au destinataire ; il conserve les données
chez l'expéditeur. Révoquer ne supprime pas les copies déjà téléchargées.
Un compte déjà inscrit doit d'abord ouvrir **Fichiers → Activer la réception sécurisée**
dans son propre navigateur avant de pouvoir recevoir. Le bouton du compte expéditeur
ne crée que la clé de réception de l'expéditeur.
On ne peut pas partager un fichier avec sa propre adresse : il figure déjà dans
« Mes fichiers ». Pour tester, envoyer depuis un compte vers un second compte.

Le compte administrateur doit être créé depuis le navigateur et avoir activé son MFA.
Depuis le dossier `backend`, dans la console serveur :

```bash
python -m app.manage grant-admin ton-adresse@example.cd
```

Puis se reconnecter. Il n'existe pas de compte admin par défaut.
Un administrateur déjà connecté peut ensuite promouvoir d’autres comptes actifs ayant
activé le MFA depuis son tableau de bord ; ces comptes doivent se reconnecter.

La conception, les limites, les commandes de vérification et les réponses pour
la défense orale sont détaillées dans [docs/EXTENSIONS_ZERO_KNOWLEDGE.md](docs/EXTENSIONS_ZERO_KNOWLEDGE.md).
