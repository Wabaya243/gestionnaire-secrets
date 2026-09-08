// Toutes les requêtes passent par ici : un seul endroit à auditer.

const BASE = '/api';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    // credentials: 'include' = envoie et accepte les cookies.
    // Sans ça, le cookie HttpOnly du JWT ne circule pas.
    credentials: 'include',
  });

  if (res.status === 204) return null;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    // On remonte une erreur portant le code HTTP, pour que l'appelant
    // puisse distinguer 401 (identifiants) de 423 (verrouillé).
    const err = new Error(data.detail || 'Erreur serveur');
    err.status = res.status;
    throw err;
  }

  return data;
}

// Authentification 

export const registerUser = (email, kdfSalt, authHash) =>
  request('/auth/register', {
    method: 'POST',
    body: { email, kdf_salt: kdfSalt, auth_hash: authHash },
  });

export const fetchSalt = (email) =>
  request('/auth/login/salt', { method: 'POST', body: { email } });

export const loginUser = (email, authHash, totpCode) =>
  request('/auth/login', {
    method: 'POST',
    body: { email, auth_hash: authHash, totp_code: totpCode || null },
  });

export const logoutUser = () => request('/auth/logout', { method: 'POST' });

//  Coffre 

export const listItems = () => request('/vault');

export const createItem = (labelEnc, payloadEnc) =>
  request('/vault', {
    method: 'POST',
    body: { label_enc: labelEnc, payload_enc: payloadEnc },
  });

export const updateItem = (id, labelEnc, payloadEnc) =>
  request(`/vault/${id}`, {
    method: 'PUT',
    body: { label_enc: labelEnc, payload_enc: payloadEnc },
  });

export const deleteItem = (id) =>
  request(`/vault/${id}`, { method: 'DELETE' });