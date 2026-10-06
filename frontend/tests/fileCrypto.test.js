import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptFile,
  decryptFile,
  readMetadata,
  createIdentity,
  restoreIdentity,
  wrapForRecipient,
  fromBase64,
  fingerprint,
  toBase64,
} from "../src/lib/fileCrypto.js";
import {
  encrypt,
  decrypt,
  deriveAuthHash,
  deriveEncryptionKey,
} from "../src/lib/crypto.js";
const aes = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);

// Real WebCrypto primitives, no mocked encryption.
test("binary file roundtrip, metadata and non-extractable master key", async () => {
  const master = await aes();
  const plain = new Uint8Array([0, 255, 1, 128, 0, 13, 10]);
  const file = new File([plain], "confidentiel.bin", {
    type: "application/octet-stream",
  });
  const item = { ...(await encryptFile(master, file)), user_id: 1 };
  assert.deepEqual(await readMetadata(master, null, 1, item), {
    name: file.name,
    type: file.type,
    size: plain.length,
  });
  assert.deepEqual(
    await decryptFile(master, null, 1, item, fromBase64(item.ciphertext)),
    plain,
  );
  await assert.rejects(crypto.subtle.exportKey("raw", master));
  assert(!item.ciphertext.includes("confidentiel"));
  const again = await encryptFile(master, file);
  assert.notEqual(again.ciphertext, item.ciphertext);
});

test("RSA transfer between independent vaults, persisted private key, wrong recipient and swapped contexts", async () => {
  const alice = await aes(),
    bob = await aes(),
    eve = await aes();
  const stored = await createIdentity(bob, 2);
  const privateKey = await restoreIdentity(bob, 2, stored);
  assert.equal(privateKey.extractable, false);
  const item = {
    ...(await encryptFile(alice, new File(["secret document"], "memo.txt"))),
    user_id: 1,
  };
  const wrapped = await wrapForRecipient(alice, item, {
    id: 2,
    public_key: stored.public_key,
  });
  const received = {
    id: item.id,
    user_id: 1,
    metadata_enc: item.metadata_enc,
    wrapped_key: wrapped,
  };
  assert.equal(
    (await readMetadata(bob, privateKey, 2, received)).name,
    "memo.txt",
  );
  const result = await decryptFile(
    bob,
    privateKey,
    2,
    received,
    fromBase64(item.ciphertext),
  );
  assert.equal(new TextDecoder().decode(result), "secret document");
  await assert.rejects(readMetadata(bob, privateKey, 3, received));
  await assert.rejects(restoreIdentity(eve, 2, stored));
  await assert.rejects(restoreIdentity(bob, 3, stored));
  const eveStored = await createIdentity(eve, 3);
  await assert.rejects(
    restoreIdentity(bob, 2, { ...stored, public_key: eveStored.public_key }),
  );
  await assert.rejects(
    readMetadata(bob, await restoreIdentity(eve, 3, eveStored), 2, received),
  );
  await assert.rejects(
    decryptFile(
      alice,
      null,
      1,
      { ...item, id: crypto.randomUUID() },
      fromBase64(item.ciphertext),
    ),
  );
  const altered = fromBase64(item.ciphertext);
  altered[13] ^= 1;
  await assert.rejects(decryptFile(bob, privateKey, 2, received, altered));
  assert.equal(
    (await fingerprint(stored.public_key)).replace(/ /g, "").length,
    64,
  );
});

test("existing Argon2 domain separation and vault cipher remain compatible", async () => {
  const salt = toBase64(new Uint8Array(16).fill(12));
  const hash = await deriveAuthHash("test master password", salt);
  const master = await deriveEncryptionKey("test master password", salt);
  const recovered = await deriveEncryptionKey("test master password", salt);
  const blob = await encrypt(master, "ancien secret");
  assert.equal(await decrypt(recovered, blob), "ancien secret");
  assert.equal(master.extractable, false);
  const hashAsKey = await crypto.subtle.importKey(
    "raw",
    fromBase64(hash),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  await assert.rejects(decrypt(hashAsKey, blob));
});
