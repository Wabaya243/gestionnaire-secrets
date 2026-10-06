# Tableaux de bord, fichiers et partage : conception et défense orale

Cette extension conserve les paramètres Argon2id, les deux domaines `auth|` et
`enc|`, le double hachage serveur et le format des secrets existants. Aucun ancien
secret n'est déchiffré, réencodé ou migré. Les opérations ci-dessous s'ajoutent au
coffre.

## 1. Ce que chaque acteur peut consulter

| Donnée | Propriétaire | Destinataire autorisé | Administrateur |
|---|---|---|---|
| Secrets texte | Déchiffrement local | Aucun accès | Nombre seulement |
| Contenu du fichier | Déchiffrement local | Déchiffrement local | Aucun accès privilégié |
| Nom, type MIME, taille originale du fichier | Déchiffrement local | Déchiffrement local | Aucun accès privilégié |
| Email, création, dernière connexion du compte | Son compte | Email utilisé pour un partage | Oui |
| Taille du blob chiffré, nombre de fichiers/secrets | Son compte | Taille des fichiers reçus | Oui, statistiques |
| État MFA, compte actif, verrouillage | Son compte | Non | Oui |
| Clé publique de partage | Oui | Recherche exacte d'un email connecté | Information publique par nature |
| Clé privée de partage | Déchiffrement local | Non | Aucun accès privilégié |
| Journal des opérations | Ses 30 derniers événements | Ses propres événements | 50 dernières actions administratives |

Un administrateur peut utiliser son propre coffre. S'il reçoit volontairement un
fichier comme destinataire, il peut le lire en cette qualité, pas grâce à son rôle.

Les emails, les relations expéditeur/destinataire, les dates et tailles de blobs
restent des **métadonnées visibles du serveur**. Le zero-knowledge protège ici le
contenu et les clés, pas l'anonymat. La taille originale peut en outre être déduite
avec précision de la taille du blob (28 octets de surcoût). La recherche de
destinataire révèle sa disponibilité à un utilisateur déjà connecté ; elle exige
un email exact et est limitée à 10 recherches/minute, sans annuaire global. La
route anonyme de récupération du sel conserve son sel factice.

## 2. Tableau de bord personnel

L'accueil affiche le nombre de secrets, fichiers, partages envoyés/reçus, le
stockage chiffré consommé, le statut MFA et la dernière connexion. Les statistiques
sont calculées par des agrégations SQL sur les métadonnées. Le serveur ne peut pas
calculer la faiblesse des mots de passe stockés : une telle analyse devrait être
faite localement dans le navigateur.

L'activité contient des actions prédéfinies et des identifiants : jamais le nom
d'un fichier, un libellé, une clé, un mot de passe, un blob ou une adresse IP. Le
journal commence avec cette version ; les anciennes actions ne sont pas inventées.

Le même écran permet d'activer le MFA après validation d'un premier code TOTP,
ou de le désactiver après saisie d'un code valide. La désactivation efface le
secret TOTP côté serveur ; une activation ultérieure produit un nouveau secret
et un nouveau QR. Un administrateur qui retire son MFA perd l'accès aux routes
d'administration jusqu'à sa réactivation, même si son rôle reste attribué.
Un événement `file.downloaded` signifie que le serveur a servi le **blob chiffré**,
pas que le destinataire a réussi son déchiffrement. Les lectures hors ligne ne sont
pas observables. Les anciens journaux restent actuellement en base ; une politique
de rétention et un archivage sont à prévoir pour une exploitation durable. Ce
journal applicatif n'est pas une preuve inviolable face à un administrateur de base.

## 3. Administration

Le premier administrateur est attribué depuis la console serveur. Ensuite un admin
connecté, avec MFA actif, peut promouvoir un compte déjà actif dont le MFA est lui aussi
actif. La promotion révoque les anciennes sessions du nouveau compte admin. Aucun endpoint
public ne permet l’auto-promotion. Le garde `admin_user` contrôle le rôle **en base**
et exige un MFA actif. Masquer un onglet React n'est pas un contrôle
d'accès : même un appel HTTP direct doit être refusé.

La désactivation incrémente `session_version`. Le JWT inclut la version ; chaque
requête la compare avec la base. Ainsi, les anciens JWT sont invalides immédiatement,
et restent invalides après réactivation. Une désactivation suspend aussi les futurs
téléchargements des fichiers partagés par ce compte. Elle ne supprime pas ses blobs.
Une requête déjà autorisée peut cependant terminer son traitement.

Le déblocage remet à zéro `failed_attempts` et `locked_until`, sans changer le mot
de passe ni le MFA. Les comptes administrateurs ne peuvent pas être désactivés via
le tableau de bord : leur rôle se gère depuis la console pour éviter de supprimer
accidentellement tout accès administrateur. Les actions sont journalisées.

La recherche par adresse s’effectue uniquement dans l’interface admin et sur le
serveur, avec pagination et compteur filtrés. La suspension temporaire stocke
`suspended_until` en UTC ; un accès redevient possible à l’échéance sans tâche de fond,
mais les anciens JWT restent invalides car `session_version` a changé. La suspension
indéfinie conserve `is_active=false` jusqu’à réactivation manuelle. Les requêtes
de partage et de téléchargement contrôlent également l’échéance du compte propriétaire
ou destinataire.

La suppression d’un compte ordinaire efface ses secrets et fichiers chiffrés,
son identité privée chiffrée, les accès qu’il a accordés et reçus, ainsi que ses
événements personnels. Les références au compte dans d’autres événements sont
effacées ; un événement admin avec l’identifiant du compte supprimé trace l’action.
Cette opération est irréversible et ne restitue aucun contenu en clair. Un compte
admin doit d’abord être rétrogradé depuis la console serveur avant suppression.

## 4. Chiffrement des fichiers

Un fichier ne doit pas être chiffré directement avec la clé du coffre si l'on veut
le partager : il faudrait alors donner cette clé et exposer tous les secrets.
Chaque fichier obtient une **clé AES-256 aléatoire indépendante**.

Pour un identifiant UUID `F` créé dans le navigateur :

1. Générer 32 octets aléatoires `Kf` avec `crypto.getRandomValues`.
2. Importer `Kf` en `CryptoKey` AES-GCM non extractible.
3. Chiffrer les octets du fichier avec un nonce de 12 octets neuf et un tag de 128 bits.
4. Chiffrer séparément les métadonnées `{name, type, size}` avec `Kf` et un autre nonce.
5. Chiffrer les 32 octets `Kf` avec la clé AES du coffre du propriétaire, avec encore
   un nonce neuf. C'est l'enveloppe du propriétaire.
6. Envoyer uniquement les trois blobs chiffrés et l'UUID au serveur. L'identifiant
   du propriétaire provient du JWT et non du corps de requête.

Les blobs AES-GCM conservent le format `nonce[12] || chiffré || tag[16]`, en base64
pour JSON. Le téléchargement transmet le blob binaire et le navigateur le déchiffre.
Le nom réel n'apparaît ni dans l'URL ni dans `Content-Disposition` côté serveur.

Des données associées authentifiées (AAD), publiques, lient les blobs à leur usage :

| Blob | AAD UTF-8 exacte |
|---|---|
| Contenu binaire | `file:v1:F` |
| Métadonnées | `metadata:v1:F` |
| Clé du propriétaire | `owner:v1:F` |
| Sauvegarde de la clé privée d'un compte `U` | `identity:v1:U` |

Déplacer un blob vers un autre UUID ou contexte fait échouer son authentification.
L'AAD n'est pas chiffrée ; elle protège le contexte, pas sa confidentialité.
Le serveur peut contrôler les encodages et les tailles, mais **ne peut pas vérifier
le tag AES-GCM** : cette vérification revient au navigateur.

La clé du coffre reste non extractible. Les octets de la clé du fichier existent
brièvement en mémoire pour être enveloppés ; ils sont écrasés dans les `finally`.
L'effacement de tableaux réduit leur durée de vie, mais JavaScript et son ramasse-
miettes n'offrent aucune garantie de suppression de toutes les copies en mémoire.

## 5. Identité asymétrique du destinataire

À sa première activation de réception, le navigateur crée une paire
**RSA-3072 / RSA-OAEP / SHA-256**, exposant public `65537` via WebCrypto.

- La clé publique, SPKI DER encodée en base64, est publiée sur le serveur.
- La clé privée, PKCS8 DER, est immédiatement chiffrée avec la clé du coffre et
  l'AAD `identity:v1:U`. Seul ce blob est sauvegardé.
- À la connexion suivante, le navigateur déchiffre ce blob, importe la clé privée
  en `extractable:false` et efface le tableau d'octets PKCS8.
- Un défi aléatoire chiffré/déchiffré vérifie que la clé publique sauvegardée
  correspond à la clé privée avant de l'utiliser.

La clé privée doit être exportable **temporairement lors de sa génération**, car
WebCrypto doit pouvoir la sauvegarder sous forme chiffrée. La clé AES du coffre
n'est jamais rendue extractible. La bibliothèque Python `cryptography` sert
uniquement à valider le format et la taille de la **clé publique** reçue ; elle
ne déchiffre aucun fichier ou clé privée sur le serveur.

RSA-OAEP enveloppe seulement 32 octets : il ne chiffre jamais un fichier entier.
ECDH aurait aussi été possible, mais aurait nécessité une clé éphémère, HKDF et
une seconde enveloppe symétrique. RSA-OAEP rend le protocole v1 plus simple à
expliquer et ne requiert pas de nouvelle bibliothèque cryptographique côté client.

Les identités v1 sont immuables : l'API refuse un second enregistrement. Les
comptes anciens restent compatibles et activent leur identité à leur convenance.
Un destinataire doit l'activer avant de recevoir. Une future rotation devra
versionner les clés et conserver ou réenvelopper les anciens partages ; écraser
une clé privée aujourd'hui rendrait ces partages irrécupérables.

Un compte inscrit n'a pas automatiquement une clé de partage. Si la recherche
du destinataire échoue, celui-ci doit se connecter à **son propre compte**,
ouvrir **Fichiers** et choisir **Activer la réception sécurisée**. L'émetteur
ne peut pas initialiser la clé privée d'autrui : cela obligerait le serveur ou
l'émetteur à connaître une clé privée qui ne leur appartient pas. Le message de
recherche reste identique pour une adresse inconnue, un compte désactivé et
une identité de partage non initialisée.
La recherche de son propre courriel est arrêtée dans le navigateur avec un message
distinct : le fichier est déjà accessible dans « Mes fichiers ».

## 6. Transfert sécurisé entre Alice et Bob

Alice garde son fichier et accorde un accès à Bob : il s'agit d'un **partage**, pas
d'un déplacement avec effacement chez l'expéditeur.

1. Alice recherche l'email exact de Bob et récupère sa clé publique et son ID.
2. Bob transmet à Alice son empreinte `SHA-256(SPKI DER)` complète (64 caractères
   hexadécimaux) via un canal de confiance indépendant.
3. Alice compare l'empreinte avec celle de la clé renvoyée. L'interface exige de
   saisir/coller l'empreinte reçue et bloque le partage si elles diffèrent.
4. Le navigateur d'Alice ouvre son enveloppe `owner:v1:F` pour retrouver `Kf`.
5. Il calcule `RSA-OAEP-SHA256(pk_Bob, Kf, label="share:v1:F:ID_Bob")`.
6. Le serveur sauvegarde seulement cette enveloppe et la relation fichier/Bob.
7. Bob récupère le blob du fichier et son enveloppe. Son navigateur utilise sa
   clé privée pour ouvrir l'enveloppe, puis AES-GCM pour le fichier et les métadonnées.

Le label OAEP lie l'enveloppe au fichier et au compte destinataire. La route de
partage vérifie également que la clé publique soumise correspond toujours à
celle enregistrée. Aucun appel réseau ne contient `Kf` ou une clé privée en clair.

**Pourquoi comparer une empreinte ?** Une clé publique publiée par le serveur
n'est pas automatiquement authentique. Un serveur compromis pourrait substituer
sa propre clé. Comparer uniquement deux empreintes affichées par ce même serveur
ne suffirait pas. La confiance dépend donc du canal indépendant et d'une comparaison
réelle ; copier l'empreinte affichée dans le champ de vérification ne protège pas
contre une substitution.

RSA-OAEP et AES-GCM n'apportent pas, dans cette version, une signature asymétrique
de l'expéditeur. L'identité de l'expéditeur affichée provient de l'authentification
serveur. Il n'y a ni transparence de clés, ni confidentialité persistante : une
compromission future de la clé privée et des blobs de partage permet de lire ces
anciens fichiers. Ces limites sont distinctes de la confidentialité du contenu
face à un serveur honnête qui conserve ses blobs.

## 7. Accès, révocation et fichiers malveillants

Les accès sont filtrés dans SQL : propriétaire ou destinataire d'un partage actif,
avec propriétaire actif. Un tiers reçoit 404, y compris un administrateur qui n'est
pas destinataire. Seul le propriétaire peut partager, supprimer ou révoquer ; un
fichier reçu ne peut pas être repartagé directement via ces routes.

Supprimer un fichier supprime d'abord les partages, puis le blob. Révoquer supprime
l'enveloppe et interdit les futurs téléchargements serveur. Cela **ne peut pas
récupérer une copie déjà téléchargée**, ni empêcher un destinataire de transmettre
le clair ou de l'ajouter à son propre coffre. C'est une limite de tout partage de
contenu déchiffrable, pas un mécanisme de DRM.

Le fichier est téléchargé, jamais rendu en iframe/HTML dans l'origine du coffre.
Le serveur envoie `application/octet-stream` et `nosniff`. Le nom est rétabli et
nettoyé localement. Le chiffrement ne garantit pas que le fichier est sans malware ;
le serveur ne peut pas analyser son contenu sans abandonner le zero-knowledge.

## 8. Stockage, limites et protections HTTP

Pour ce projet académique mono-service, les fichiers chiffrés sont stockés dans
PostgreSQL (`BYTEA`) ou SQLite (`BLOB`). Aucun disque applicatif persistant n'est
nécessaire et la sauvegarde SQL couvre blobs et enveloppes. Pour de gros volumes,
un stockage objet privé serait préférable, sans changer le chiffrement client.

Limites : 10 Mio de clair par fichier, 100 Mio de blobs de contenu par compte, 100 fichiers par
compte, 100 destinataires par fichier. Les limites en octets sont configurables.
L'API n'accepte pas le `user_id` du client. Le middleware borne les octets reçus,
même sans `Content-Length`, avant le parsing JSON. Les uploads sont en base64,
avec un surcoût d'environ 33 % et plusieurs copies en mémoire : cette version n'est
pas conçue pour des fichiers de plusieurs centaines de Mio ou du streaming.
Les quotas sont sérialisés par verrou de ligne dans PostgreSQL. SQLite reste le
mode de développement, sans promesse équivalente de concurrence multi-processus.

Les mutations exigent `X-Vault-Request: 1`. Une origine tierce doit alors effectuer
un preflight CORS que ce service n'autorise pas ; les requêtes `cross-site` sont
rejetées. Les cookies HttpOnly/Secure en production/SameSite=Lax et la CSP avec
`wasm-unsafe-eval` restent en place. Les réponses API sont `Cache-Control: no-store`.
Le navigateur abandonne ses clés à un 401 et revérifie le profil chaque minute ;
la session conserve sa durée maximale de 15 minutes, sans renouvellement silencieux.

Le seuil de 5 échecs est désormais appliqué aux codes TOTP de connexion aussi,
avec compteur persisté et verrou de ligne PostgreSQL. Les valeurs de verrouillage
et de hachage existantes restent intactes lors de la migration.

## 9. Migration et activation sur Render

**Avant le premier déploiement :** sauvegarder PostgreSQL et les variables
Render. Le démarrage applique `001_files_dashboards` puis `002_admin_controls` :
ajout des colonnes d'administration et de `suspended_until` sur `user`, création
des quatre tables et de `schema_revision`. Les anciens
comptes ont `is_admin=false`, `is_active=true`, `session_version=0`. Les tables
existantes du coffre ne sont pas renommées. La migration est additive,
transactionnelle sur PostgreSQL et protégée par un verrou de migration. Un second
démarrage ne réapplique pas ces révisions. Il n'y a pas de migration descendante
automatique : ne pas supprimer des données chiffrées pour revenir en arrière.

1. Déployer la branche après relecture et sauvegarde (build/start inchangés).
2. Créer ou utiliser un compte dans le navigateur et activer son MFA.
3. Dans le shell Render, depuis `backend` :

   ```bash
   python -m app.manage grant-admin ton-adresse@example.cd
   ```

4. Se reconnecter : l'onglet Administration apparaît et le MFA est demandé.
5. Pour retirer ce rôle depuis le shell :

   ```bash
   python -m app.manage revoke-admin ton-adresse@example.cd
   ```

Aucun compte admin par défaut, mot de passe de démonstration ou auto-promotion
par « premier inscrit » n'est ajouté. Les anciens JWT sans champ `ver` valent
version 0 pour assurer la transition ; tout changement de version les invalide.

Configuration optionnelle :

```dotenv
MAX_FILE_BYTES=10485760
FILE_QUOTA_BYTES=104857600
```

Le service déployé n'est pas modifié par les tests locaux. La fusion/déploiement
et l'attribution du rôle restent des actions distinctes.

## 10. Vérification et démonstration à l'oral

Exécuter depuis la racine :

```bash
pip install -r backend/requirements-dev.txt
pytest backend/tests -q
cd frontend
npm ci
npm test
npm run build
npm run lint
```

Les tests API vérifient les anciens blobs après migration, les accès d'un tiers
et d'un admin, la recherche, la promotion, la suspension à durée définie,
la suppression complète d’un compte, la révocation, l'identité publique immuable, les sessions
après désactivation/réactivation, la suspension des fichiers du propriétaire,
le verrouillage TOTP, les quotas/tailles, le contrôle CSRF et le coffre existant.
Les tests JavaScript exécutent les vrais algorithmes WebCrypto et Argon2id pour
le transfert entre deux coffres indépendants, la restauration de clé privée,
les mauvaises clés, les contextes déplacés et les octets altérés.

Un scénario navigateur reproductible est fourni dans `frontend/tests/browser.mjs`.
Il utilise uniquement une base temporaire locale, crée trois comptes fictifs et
vérifie upload, partage, téléchargement, reconnexion, révocation et administration.
Après le build, installer Playwright temporairement dans `frontend`, puis lancer
depuis la racine (adapter `TEST_PYTHON` si le backend utilise conda) :

```bash
cd frontend
npm install --no-save playwright
npx playwright install chromium
cd ..
node frontend/tests/browser.mjs
```

`CHROMIUM_EXECUTABLE` permet d'utiliser un Chromium déjà installé. Le scénario
ne vise jamais l'application Render et ne sauvegarde aucune donnée réelle.

Les tests automatisés API utilisent SQLite. Le dialecte et les verrous PostgreSQL
nécessitent encore un essai sur une base PostgreSQL de staging avant production ;
ces tests ne prouvent pas à eux seuls les propriétés de concurrence PostgreSQL.

Démonstration conseillée avec des fichiers fictifs :

1. Deux comptes, Alice et Bob, dans deux profils de navigateur distincts.
2. Bob active la réception et transmet son empreinte par un canal indépendant.
3. Alice ajoute un fichier. F12/Réseau : ni nom réel, ni clair, ni clé AES envoyés.
4. Alice partage après vérification de l'empreinte. Bob retrouve le nom et le contenu.
5. Un troisième compte tente l'URL du blob : 404.
6. Alice révoque. Bob ne peut plus télécharger depuis le serveur ; expliquer la
   limite concernant sa copie précédente.
7. L'admin voit les compteurs mais ne peut pas télécharger le fichier d'Alice.
8. L'admin désactive puis réactive Alice : son ancienne session reste invalide.
9. L'admin recherche Bob, vérifie que le MFA est activé, puis le promeut ; Bob se
   reconnecte et voit son onglet Administration.
10. L'admin suspend temporairement un compte de test et vérifie qu'il redevient
    accessible après échéance avec une nouvelle connexion.
11. L'admin supprime un compte de test en saisissant son adresse : ses fichiers
    et partages disparaissent. Ne pas utiliser de vraies données pour cette démo.

## 11. Réponses courtes aux questions du professeur

- **Pourquoi une clé par fichier ?** Pour donner accès à ce fichier sans révéler
  la clé maîtresse et sans exposer les autres secrets.
- **Pourquoi ne pas chiffrer le fichier entier avec RSA ?** RSA accepte seulement
  de petits messages. Le chiffrement hybride combine AES pour les données et
  RSA-OAEP pour la clé de 32 octets.
- **Où est la clé privée ?** En mémoire lors de l'utilisation ; en base uniquement
  sous forme chiffrée avec une clé que le serveur n'a jamais reçue.
- **L'admin peut-il récupérer un mot de passe maître perdu ?** Non. Débloquer
  l'accès à un compte ne recrée pas sa clé de déchiffrement.
- **À quoi sert le tag GCM ?** À détecter une modification du blob ou une mauvaise
  clé. Les données ne sont proposées au téléchargement en clair qu'après validation.
- **Pourquoi l'AAD et le label OAEP ?** Pour lier les enveloppes à leur fichier,
  leur usage et, pour RSA, leur destinataire.
- **Pourquoi l'empreinte ?** Pour authentifier la clé publique via un canal
  indépendant ; TLS seul authentifie le serveur, pas l'identité cryptographique de Bob.
- **Peut-on retirer un fichier déjà téléchargé ?** Non. On révoque les futurs
  accès au serveur, pas les copies locales d'un destinataire autorisé.
- **Qu'apporte le second Argon2id serveur ?** La base ne contient pas le hash client
  qui servirait de preuve d'authentification rejouable. Cela ne supprime pas les
  attaques hors ligne par essais de mots de passe faibles.
- **Que reste-t-il comme risque ?** XSS, navigateur compromis ou serveur qui sert
  un JavaScript malveillant peuvent exploiter les clés au déverrouillage. Une clé
  non extractible n'empêche pas un XSS d'appeler `decrypt`. Les clés et la CSP
  renforcent la protection, mais ne rendent pas ce modèle invulnérable.

## Références primaires

- W3C, Web Cryptography : https://www.w3.org/TR/WebCryptoAPI/
- RSA-OAEP, PKCS#1 v2.2 : https://www.rfc-editor.org/rfc/rfc8017
- NIST SP 800-38D (GCM) : https://csrc.nist.gov/pubs/sp/800/38/d/final
