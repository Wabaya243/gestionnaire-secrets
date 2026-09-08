import { argon2id } from 'hash-wasm';

// Paramètres Argon2id (recommandations OWASP 2024) 
// Côté navigateur on reste modéré : 64 Mio × 3 passes prend déjà
// ~1 seconde sur un portable moyen. Plus haut, l'UX devient pénible.
const ARGON2_PARAMS = {
  parallelism: 1,
  iterations: 10,
  memorySize: 65536,   // en Kio, soit 64 Mio
  hashLength: 32,      // 32 octets = 256 bits, taille exacte d'une clé AES-256
};

const NONCE_BYTES = 12;   // taille recommandée pour AES-GCM

//  Conversions base64 <-> octets 

function bytesToB64(bytes) {
  // String.fromCharCode plante sur de gros tableaux (limite d'arguments),
  // donc on construit la chaîne caractère par caractère.
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Génération du sel 

export function generateSalt() {
  // crypto.getRandomValues = générateur cryptographiquement sûr.
  // NE JAMAIS utiliser Math.random() ici : il est prévisible.
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return bytesToB64(salt);
}

// Dérivation 

async function derive(password, saltB64, domain) {
  // Séparation de domaine : on préfixe le sel par une étiquette,
  // ce qui produit deux sorties indépendantes à partir du même mot de passe.
  const salt = encoder.encode(domain + '|' + saltB64);

  return await argon2id({
    password,
    salt,
    ...ARGON2_PARAMS,
    outputType: 'binary',   // renvoie un Uint8Array
  });
}

export async function deriveAuthHash(password, saltB64) {
  // Ce qui part sur le réseau. Le serveur le re-hachera avant stockage.
  const bytes = await derive(password, saltB64, 'auth');
  return bytesToB64(bytes);
}

export async function deriveEncryptionKey(password, saltB64) {
  const raw = await derive(password, saltB64, 'enc');

  // importKey transforme les octets en objet CryptoKey.
  // extractable = false : le JavaScript ne pourra plus jamais relire
  // les octets de la clé, même via console.log. Protection contre le XSS.
  return await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,                     // <-- non extractible
    ['encrypt', 'decrypt'],
  );
}

//  Chiffrement / déchiffrement 
export async function encrypt(key, plaintext) {
  // Un nonce ALÉATOIRE et NEUF à chaque appel.
  // Le réutiliser sous la même clé casse complètement AES-GCM.
  const nonce = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(nonce);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    encoder.encode(plaintext),
  );

  // WebCrypto place déjà le tag d'authentification à la fin du ciphertext.
  // On préfixe simplement le nonce : [nonce][ciphertext+tag]
  const blob = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  blob.set(nonce, 0);
  blob.set(new Uint8Array(ciphertext), NONCE_BYTES);

  return bytesToB64(blob);
}

export async function decrypt(key, blobB64) {
  const blob = b64ToBytes(blobB64);

  // On sépare ce qu'on avait concaténé.
  const nonce = blob.slice(0, NONCE_BYTES);
  const ciphertext = blob.slice(NONCE_BYTES);

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext,
    );
    return decoder.decode(plaintext);
  } catch {
    // AES-GCM échoue si le tag ne correspond pas : données altérées,
    // ou mauvaise clé. On ne distingue pas les deux cas.
    throw new Error('Déchiffrement impossible');
  }
}
