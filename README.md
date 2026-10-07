# Gestionnaire web sécurisé de secrets

Projet du cours **Protocoles de Sécurité Réseau** — Master 1, Université de Kinshasa (2026).

- [Application déployée](https://gestionnaire-secrets.onrender.com)
- [Dépôt GitHub](https://github.com/Wabaya243/gestionnaire-secrets)
- [Conception et défense des choix de sécurité](docs/EXTENSIONS_ZERO_KNOWLEDGE.md)

## Groupe 13

| Membre |
|---|
| THEYTHEY KAMBALE DIVIN |
| MUELA MPIANA POPOL |
| TATY MUNSI MANASSE |
| MBENGA EZIBE ANDERSON |
| MANZITA LUZOLO FRANCK |

## Fonctionnalités

Le coffre stocke des secrets texte et des fichiers chiffrés. Chaque utilisateur
dispose d'un tableau de bord avec ses compteurs, son activité récente et l'état
de sa double authentification (MFA). Il peut activer ou désactiver le MFA avec
une application TOTP ; la désactivation exige un code valide.

Un fichier peut être partagé avec un autre utilisateur. Le destinataire initialise
d'abord **Fichiers → Activer la réception sécurisée** sur son propre compte, puis
communique son empreinte de clé publique à l'expéditeur par un canal indépendant.
L'expéditeur vérifie cette empreinte avant de partager. Un compte ne peut pas se
partager un fichier à lui-même. Révoquer un partage empêche les téléchargements
futurs, sans effacer une copie déjà téléchargée.

Le tableau d'administration présente uniquement des **métadonnées** : adresses,
dates, nombres de secrets et de fichiers, volume chiffré et journal d'activité.
Un administrateur ayant activé le MFA peut rechercher des comptes, les débloquer,
les suspendre pour 1 heure, 24 heures ou 7 jours, les désactiver jusqu'à
réactivation et supprimer définitivement un compte ordinaire. Seul un
**superadministrateur** peut promouvoir un compte actif avec MFA en administrateur
ou retirer le rôle admin. Les sessions du compte visé sont invalidées après
un changement de rôle ou une suspension. Les administrateurs ne peuvent pas
être désactivés ou supprimés depuis l'interface.

## Architecture et sécurité

| Couche | Technologies |
|---|---|
| Frontend | React, Vite, WebCrypto, hash-wasm, zxcvbn, Tailwind CSS |
| Backend | FastAPI, SQLModel, argon2-cffi, PyJWT, pyotp, slowapi |
| Base | SQLite en développement, PostgreSQL en production |
| Hébergement | Render, service FastAPI servant également le build React |

Le **mot de passe maître reste dans le navigateur**. Deux dérivations Argon2id
indépendantes utilisent les domaines `auth|` et `enc|` avec un sel propre au compte :

1. La valeur d'authentification est envoyée au serveur, qui la hache une seconde
   fois avec Argon2id avant de la stocker. Un hash volé en base ne peut donc pas
   être rejoué tel quel pour se connecter.
2. La clé AES-256 du coffre reste en mémoire dans le navigateur. Elle n'est
   jamais transmise au serveur ni conservée dans `localStorage` ou `sessionStorage`.

Les secrets et les fichiers sont chiffrés localement avec AES-GCM et un nonce
neuf à chaque opération. Chaque fichier possède sa propre clé AES aléatoire ;
pour un partage, seule cette clé est enveloppée avec la clé publique RSA-3072
du destinataire. Sa clé privée n'est stockée qu'après chiffrement avec sa clé
de coffre. Le serveur conserve les blobs chiffrés, leurs tailles et les relations
de partage, sans disposer des clés nécessaires au déchiffrement.

Les autres protections comprennent le MFA TOTP, un verrouillage persistant après
5 échecs pendant 15 minutes, des cookies JWT `HttpOnly` et `SameSite=Lax`, une
CSP, des limites de débit et des filtres de propriété dans les requêtes SQL.
Les sessions durent au maximum 15 minutes ; leur version est vérifiée en base
pour permettre une révocation immédiate.

**Limite importante :** le secret TOTP est conservé côté serveur pour vérifier
les codes. Une faille XSS ou un serveur servant du JavaScript malveillant peut
également compromettre une session déverrouillée. Les métadonnées de compte,
les tailles et les relations de partage restent visibles du serveur. Le mot
de passe maître perdu ne peut pas être récupéré par l'administrateur.

## Installation locale

Prérequis : Python 3.12, Node.js et npm. Depuis la racine du dépôt :

```powershell
cd backend
conda create -n secrets-back python=3.12 -y
conda activate secrets-back
pip install -r requirements.txt
Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Renseigner dans `backend/.env` une valeur `JWT_SECRET` générée par la dernière
commande, `DATABASE_URL=sqlite:///./vault.db` et `ENVIRONMENT=development`.
Puis démarrer le backend :

```powershell
uvicorn app.main:app --reload --port 8000
```

Dans un **second terminal**, depuis la racine du dépôt :

```powershell
cd frontend
npm ci
npm run dev
```

Ouvrir `http://localhost:5173`. La documentation API locale est à
`http://127.0.0.1:8000/docs`. Vite relaie les appels `/api` au backend.
Le fichier `.env`, la base SQLite, `node_modules` et les builds sont ignorés
par Git. Sous Linux/macOS, remplacer `Copy-Item` par `cp`.

## Premier superadministrateur

Créer un compte dans le navigateur et activer son MFA. Dans le dossier `backend`,
avec le même environnement Python et la même base que le serveur :

```powershell
python -m app.manage grant-superadmin adresse-du-compte@example.cd
```

Se déconnecter puis se reconnecter. Ce superadmin pourra promouvoir et
rétrograder les administrateurs depuis l'interface. Les administrateurs déjà
présents ne deviennent **pas** superadmins automatiquement lors de la migration :
attribuer explicitement ce rôle à l'un d'eux avec la même commande. Le dernier
superadmin ne peut pas perdre ce rôle. Aucun compte privilégié par défaut
n'est créé.

## Vérification

Depuis la racine du dépôt, avec les dépendances de test installées :

```powershell
pip install -r backend/requirements-dev.txt
python -m pytest backend/tests -q
cd frontend
npm ci
npm test
npm run build
npm run lint
```

Les tests API couvrent les accès entre comptes, les migrations, les sessions,
le MFA, le partage, la recherche et les actions d'administration. Les tests
JavaScript exercent la cryptographie côté navigateur. Pour une démonstration
manuelle, utiliser deux comptes distincts et vérifier dans l'onglet Réseau que
le serveur ne reçoit ni nom de fichier en clair ni clé AES. Utiliser seulement
des données fictives pour tester la suppression d'un compte.

## Déploiement et limites d'exploitation

Sur Render, le build `./build.sh` compile React dans `backend/static` et installe
les dépendances Python. La commande de démarrage est :

```bash
cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Configurer `DATABASE_URL`, `JWT_SECRET` et `ENVIRONMENT=production` comme
variables privées du service. Sauvegarder PostgreSQL avant tout déploiement :
les migrations additives `001_files_dashboards`, `002_admin_controls` et
`003_superadmin_role`
s'exécutent au démarrage. Le volume de fichier est limité par défaut à 10 Mio
par fichier et 100 Mio par compte.

Les éventuels accès de démonstration destinés au professeur doivent être
transmis **séparément**, jamais publiés dans le dépôt. Voir
[la documentation de conception](docs/EXTENSIONS_ZERO_KNOWLEDGE.md) pour le
protocole de partage, les limites et les scénarios de soutenance.
