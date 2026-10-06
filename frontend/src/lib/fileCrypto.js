// v1 file protocol. Master vault key never becomes extractable.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const rsa = { name: "RSA-OAEP", hash: "SHA-256" };

export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}
export function fromBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

export async function seal(key, bytes, context) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(context),
      tagLength: 128,
    },
    key,
    bytes,
  );
  const blob = new Uint8Array(12 + encrypted.byteLength);
  blob.set(iv);
  blob.set(new Uint8Array(encrypted), 12);
  return blob;
}
export async function open(key, blob, context) {
  if (blob.length < 28) throw new Error("Fichier chiffré invalide");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: blob.subarray(0, 12),
        additionalData: encoder.encode(context),
        tagLength: 128,
      },
      key,
      blob.subarray(12),
    ),
  );
}
async function importAES(raw) {
  if (raw.length !== 32) throw new Error("Clé de fichier invalide");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function fingerprint(publicKey) {
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", fromBase64(publicKey)),
  );
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()
    .match(/.{4}/g)
    .join(" ");
}

export async function createIdentity(vaultKey, userId) {
  // Temporary export is necessary to back up the private key in encrypted form.
  // PKCS8 bytes are never sent or persisted in clear.
  const pair = await crypto.subtle.generateKey(
    { ...rsa, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  try {
    return {
      public_key: toBase64(
        new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)),
      ),
      private_key_enc: toBase64(
        await seal(vaultKey, raw, `identity:v1:${userId}`),
      ),
    };
  } finally {
    raw.fill(0);
  }
}

export async function restoreIdentity(vaultKey, userId, stored) {
  const raw = await open(
    vaultKey,
    fromBase64(stored.private_key_enc),
    `identity:v1:${userId}`,
  );
  try {
    const privateKey = await crypto.subtle.importKey("pkcs8", raw, rsa, false, [
      "decrypt",
    ]);
    const publicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64(stored.public_key),
      rsa,
      false,
      ["encrypt"],
    );
    // Detect corrupted or replaced public key on the account itself.
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const encrypted = await crypto.subtle.encrypt(rsa, publicKey, challenge);
    const answer = new Uint8Array(
      await crypto.subtle.decrypt(rsa, privateKey, encrypted),
    );
    if (!answer.every((b, i) => b === challenge[i]))
      throw new Error("Identité de partage incohérente");
    return privateKey;
  } finally {
    raw.fill(0);
  }
}

export async function encryptFile(vaultKey, file) {
  const id = crypto.randomUUID();
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const plaintext = new Uint8Array(await file.arrayBuffer());
  try {
    const key = await importAES(raw);
    return {
      id,
      ciphertext: toBase64(await seal(key, plaintext, `file:v1:${id}`)),
      metadata_enc: toBase64(
        await seal(
          key,
          encoder.encode(
            JSON.stringify({
              name: file.name,
              type: file.type,
              size: file.size,
            }),
          ),
          `metadata:v1:${id}`,
        ),
      ),
      owner_key_enc: toBase64(await seal(vaultKey, raw, `owner:v1:${id}`)),
    };
  } finally {
    raw.fill(0);
    plaintext.fill(0);
  }
}

export async function rawFileKey(vaultKey, identity, userId, item) {
  if (item.user_id === userId) {
    return open(
      vaultKey,
      fromBase64(item.owner_key_enc),
      `owner:v1:${item.id}`,
    );
  }
  if (!identity) throw new Error("Initialisez votre identité de partage");
  return new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "RSA-OAEP",
        label: encoder.encode(`share:v1:${item.id}:${userId}`),
      },
      identity,
      fromBase64(item.wrapped_key),
    ),
  );
}

export async function readMetadata(vaultKey, identity, userId, item) {
  const raw = await rawFileKey(vaultKey, identity, userId, item);
  try {
    const clear = await open(
      await importAES(raw),
      fromBase64(item.metadata_enc),
      `metadata:v1:${item.id}`,
    );
    return JSON.parse(decoder.decode(clear));
  } finally {
    raw.fill(0);
  }
}

export async function decryptFile(vaultKey, identity, userId, item, bytes) {
  const raw = await rawFileKey(vaultKey, identity, userId, item);
  try {
    return await open(await importAES(raw), bytes, `file:v1:${item.id}`);
  } finally {
    raw.fill(0);
  }
}

export async function wrapForRecipient(vaultKey, item, recipient) {
  const raw = await open(
    vaultKey,
    fromBase64(item.owner_key_enc),
    `owner:v1:${item.id}`,
  );
  try {
    const publicKey = await crypto.subtle.importKey(
      "spki",
      fromBase64(recipient.public_key),
      rsa,
      false,
      ["encrypt"],
    );
    return toBase64(
      new Uint8Array(
        await crypto.subtle.encrypt(
          {
            name: "RSA-OAEP",
            label: encoder.encode(`share:v1:${item.id}:${recipient.id}`),
          },
          publicKey,
          raw,
        ),
      ),
    );
  } finally {
    raw.fill(0);
  }
}
