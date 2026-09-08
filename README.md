# Gestionnaire web sécurisé de secrets

Projet du cours **Protocoles de Sécurité Réseau** — Master 1, Université de Kinshasa (2026).

**Groupe 13 — Protocol de securité**


| THEYTHEY KAMBALE | |


- **Site déployé** : *(à compléter)*
- **Dépôt** : https://github.com/Wabaya243/gestionnaire-secrets

---

## 1. Objectif

Coffre-fort en ligne permettant de stocker des secrets (mots de passe,
clés d'API) protégés par un unique mot de passe maître.

La propriété centrale est le **zero-knowledge** : toute la cryptographie
s'exécute dans le navigateur. Le serveur stocke des données chiffrées
qu'il est structurellement incapable de lire, et ne reçoit jamais le
mot de passe maître.

## 2. Mécanismes de sécurité

| Mécanisme | Rôle | Menace traitée |
|---|---|---|
| Argon2id (client + serveur) | Dérivation de clé memory-hard | Force brute hors ligne, tables arc-en-ciel |
| AES-GCM 256 | Chiffrement authentifié | Lecture et altération des secrets |
| TOTP (RFC 6238) | Second facteur | Vol du mot de passe maître |
| Verrouillage après échecs | 5 tentatives, 15 min | Force brute en ligne |
| zxcvbn | Indicateur de robustesse | Mot de passe maître faible |
| HTTPS/TLS | Chiffrement du transport | Interception réseau |

## 3. Architecture

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



La **séparation de domaine** (préfixes `auth|` et `enc|`) garantit que le
hash transmis au serveur ne révèle rien sur la clé de chiffrement.

Le **double hachage** garantit qu'un vol de la base ne permet pas de
rejouer le hash volé pour s'authentifier.

### Stack

- **Frontend** : React, Vite, hash-wasm (Argon2id WASM), WebCrypto, zxcvbn
- **Backend** : FastAPI, SQLModel, argon2-cffi, pyotp, slowapi, PyJWT
- **Base** : SQLite en développement, PostgreSQL en production

### Modèle de données

`users` — email, kdf_salt (public), auth_hash, totp_secret, mfa_enabled,
failed_attempts, locked_until

`vault_items` — user_id, label_enc, payload_enc (le libellé est chiffré
lui aussi : un serveur qui lirait « Compte bancaire » apprendrait déjà
quelque chose)

## 4. Défenses spécifiques

- **Énumération de comptes** : un sel factice déterministe est renvoyé
  pour tout email inconnu ; les messages d'erreur sont identiques.
- **Attaque temporelle** : le hachage Argon2 est exécuté même lorsque
  l'utilisateur n'existe pas, pour égaliser les temps de réponse.
- **IDOR** : le filtre `user_id` figure dans la requête SQL elle-même ;
  un élément appartenant à autrui renvoie 404, jamais 403.
- **XSS** : clé AES importée en `extractable: false`, JWT en cookie
  `HttpOnly`, en-têtes CSP restrictifs.

## 5. Installation

### Backend

```bash
cd backend
conda create -n secrets-back python=3.12 -y
conda activate secrets-back
pip install -r requirements.txt
cp .env.example .env      # puis renseigner JWT_SECRET
uvicorn app.main:app --reload --port 8000
```

Génération d'un secret JWT :
```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Interface sur `http://localhost:5173`, API sur `http://127.0.0.1:8000/docs`.

## 6. Variables d'environnement

| Variable | Description |
|---|---|
| `DATABASE_URL` | URL de la base |
| `JWT_SECRET` | Secret de signature des jetons (obligatoire) |
| `JWT_EXPIRE_MINUTES` | Durée de vie des jetons (défaut : 15) |
| `ENVIRONMENT` | `development` ou `production` |

Aucun secret n'est versionné : `.env` est exclu par `.gitignore`.

## 7. Calibration d'Argon2id

Mesures relevées sur la machine de développement :

| Paramètres | Durée |
|---|---|
| m=19 Mio, t=3 | 67 ms |
| m=64 Mio, t=3 | 195 ms |
| m=64 Mio, t=10 | *(à compléter)* |

Le durcissement porte sur les itérations plutôt que sur la mémoire, cette
dernière étant plafonnée par les appareils modestes.

## 8. Tests

*(à compléter — captures dans `docs/captures/`)*

- Le mot de passe maître n'apparaît dans aucune requête réseau
- Deux comptes au même mot de passe produisent des hashs différents
- Le contenu de la base est inexploitable
- Verrouillage effectif après 5 échecs (HTTP 423)

## 9. Déploiement

*(à compléter)*

## 10. Identifiants de démonstration

*(à compléter)*

## 11. Limites connues

- **Mot de passe maître irrécupérable** : conséquence directe du
  zero-knowledge, pas un défaut d'implémentation.
- **Secret TOTP en clair côté serveur** : la vérification du second
  facteur doit être faite par la partie que l'attaquant ne contrôle pas.
  Même compromis que Bitwarden et 1Password.
- **XSS dans l'application** : le code injecté s'exécute là où la clé
  réside. Limite intrinsèque de la cryptographie en navigateur.
- **Serveur malveillant** : il sert le JavaScript et pourrait en servir
  une version modifiée.
- **Absence de migrations** : le schéma est créé par `create_all`.

## 12. Dépendances externes

FastAPI, SQLModel, argon2-cffi, PyJWT, pyotp, slowapi, psycopg,
React, Vite, hash-wasm, zxcvbn.
