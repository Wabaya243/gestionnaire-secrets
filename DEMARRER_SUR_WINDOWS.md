# Tester puis pousser le gestionnaire de secrets sur Windows

Cette archive contient **le projet entier**, y compris le dossier `.git`, sur la
branche `feat/zero-knowledge-files-dashboards`. Son dépôt distant `origin` pointe
vers `https://github.com/Wabaya243/gestionnaire-secrets.git`.
Le dossier `.git` peut être masqué par l'Explorateur Windows ; il est bien inclus.
Aucun mot de passe, fichier `.env`, base de données ou dossier `node_modules` n'est
inclus. Tu installerais les dépendances sur ton propre PC.

## 1. Extraire et vérifier

Extrais le ZIP avec l'Explorateur Windows. Ouvre PowerShell **dans le dossier où
se trouve le dossier `gestionnaire-secrets-projet`**, puis :

```powershell
cd .\gestionnaire-secrets-projet
git config core.filemode false
git status
git branch --show-current
```

Tu dois voir la branche `feat/zero-knowledge-files-dashboards` et un arbre de
travail propre. `core.filemode false` évite de voir `build.sh` modifié simplement
parce que l'extraction ZIP sur Windows ne conserve pas les permissions Unix.

## 2. Backend et tests API

Il te faut Python 3.12, puis depuis la racine du projet :

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend\requirements-dev.txt
python -m pytest backend\tests -q
```

Résultat attendu : **11 tests passent**. Les tests créent leurs propres bases
SQLite temporaires et n'utilisent pas le service Render.

Si PowerShell bloque le script d'activation, tu peux appeler directement
`.\.venv\Scripts\python.exe` à la place de `python` dans les commandes suivantes.

## 3. Frontend et tests cryptographiques

Dans la même fenêtre PowerShell :

```powershell
cd frontend
npm ci
npm test
npm run build
cd ..
```

Résultat attendu : **3 tests passent**, puis Vite compile le frontend. Le build
peut signaler un avertissement sur la taille du bundle ; il doit finir avec
`built`.

## 4. Essayer le site localement

Ouvre **deux fenêtres PowerShell**.

Fenêtre A, depuis la racine du projet :

```powershell
.\.venv\Scripts\Activate.ps1
$env:JWT_SECRET = python -c "import secrets; print(secrets.token_urlsafe(48))"
cd backend
uvicorn app.main:app --reload --port 8000
```

Fenêtre B, depuis la racine du projet :

```powershell
cd frontend
npm run dev
```

Ouvre `http://localhost:5173`. Le serveur crée une base SQLite locale
`backend/vault.db` (ignorée par Git). Vite transmet les appels `/api` au backend.

Pour essayer les quatre ajouts : crée **deux comptes fictifs**, connecte-toi,
ajoute un secret, puis ajoute un fichier dans « Fichiers ». Sur le second compte,
active l'identité de partage. Il montre une empreinte à transmettre au premier
compte par un autre canal. Après comparaison, partage le fichier. Le second
compte pourra voir son nom et télécharger le contenu déchiffré.

L'espace Administration est disponible seulement pour un compte avec MFA activé
et rôle administrateur. Après avoir activé le MFA dans ton compte local, depuis
`backend` avec le venv actif :

```powershell
python -m app.manage grant-admin ton-adresse@example.cd
```

Déconnecte-toi et reconnecte-toi avec ton code TOTP pour voir l'onglet.

## 5. Pousser sur GitHub

Arrête les deux serveurs (`Ctrl+C`), reviens à la racine, puis :

```powershell
git status
git push -u origin feat/zero-knowledge-files-dashboards
```

Git peut demander de te connecter à GitHub avec ton compte. La commande crée
la branche distante avec le commit déjà préparé. Tu pourras ensuite ouvrir
une pull request vers `main` et relire le changement. Le push d'une branche
ne met pas à jour le site Render tant que ton flux de déploiement utilise `main`.
Avant de fusionner et déployer, sauvegarde PostgreSQL et essaie la migration
sur une base PostgreSQL de test.

Pour la défense orale et les limites du protocole, lis
`gestionnaire-secrets-projet/docs/EXTENSIONS_ZERO_KNOWLEDGE.md`.
