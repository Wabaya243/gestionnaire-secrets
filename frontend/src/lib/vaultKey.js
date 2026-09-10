// Stockage volatil de la clé de déchiffrement.
// Un module JavaScript, pas un state React : la clé n'apparaît
// jamais dans les DevTools React ni dans un dump d'état.
let vaultKey = null;

export function setVaultKey(key) {
  vaultKey = key;
}

export function getVaultKey() {
  if (!vaultKey) throw new Error('Coffre verrouillé');
  return vaultKey;
}

export function hasVaultKey() {
  return vaultKey !== null;
}

export function lockVault() {
  // Déverrouillage impossible sans ressaisir le mot de passe.
  vaultKey = null;
}