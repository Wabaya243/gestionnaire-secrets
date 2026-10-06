// Toutes les requêtes passent par ici : un seul endroit à auditer.

const BASE = '/api';

export async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'X-Vault-Request': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
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
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('vault-session-expired'));
    const err = new Error(typeof data.detail === 'string' ? data.detail : 'Données invalides');
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

// Profil du compte connecté : email, mfa_enabled, created_at.
// Aucun secret n'y transite (ni sel, ni hash, ni secret TOTP).
export const fetchMe = () => request('/auth/me');

//  Coffre 

export const listItems = () => request('/vault');

export const createItem = (labelEnc, payloadEnc) =>
  request('/vault', {
    method: 'POST',
    body: { label_enc: labelEnc, payload_enc: payloadEnc },
  });

// Le serveur remplace les deux blobs de l'élément désigné.
// Il ne sait toujours pas ce qu'ils contiennent.
export const updateItem = (id, labelEnc, payloadEnc) =>
  request(`/vault/${id}`, {
    method: 'PUT',
    body: { label_enc: labelEnc, payload_enc: payloadEnc },
  });

export const deleteItem = (id) =>
  request(`/vault/${id}`, { method: 'DELETE' });


export const mfaSetup = () => request('/auth/mfa/setup', { method: 'POST' });

export const mfaActivate = (totpCode) =>
  request('/auth/mfa/activate', { method: 'POST', body: { totp_code: totpCode } });

export const fetchDashboard = () => request('/dashboard');
export const fetchAdminOverview = () => request('/admin/overview');
export const fetchAdminUsers = (offset = 0) => request(`/admin/users?offset=${offset}&limit=50`);
export const fetchAdminActivity = () => request('/admin/activity');
export const setAccountState = (id, isActive) => request(`/admin/users/${id}/state`, { method: 'PATCH', body: { is_active: isActive } });
export const unlockAccount = id => request(`/admin/users/${id}/unlock`, { method: 'POST' });
export const fetchSharingKeys = () => request('/files/keys/me');
export const saveSharingKeys = body => request('/files/keys/me', { method: 'POST', body });
export const findRecipient = email => request('/files/recipient', { method: 'POST', body: { email } });
export const fetchFiles = () => request('/files');
export const uploadFile = body => request('/files', { method: 'POST', body });
export const removeFile = id => request(`/files/${id}`, { method: 'DELETE' });
export const fetchShares = id => request(`/files/${id}/shares`);
export const shareFile = (id, body) => request(`/files/${id}/shares`, { method: 'POST', body });
export const revokeShare = (fileId, shareId) => request(`/files/${fileId}/shares/${shareId}`, { method: 'DELETE' });
export async function downloadFile(id) {
  const res = await fetch(`/api/files/${id}/content`, { credentials: 'include' });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event('vault-session-expired'));
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || 'Téléchargement impossible');
  }
  return new Uint8Array(await res.arrayBuffer());
}
