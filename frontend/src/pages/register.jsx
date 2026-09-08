import { useState } from 'react';
import { generateSalt, deriveAuthHash } from '../lib/crypto';
import { registerUser } from '../lib/api';
import StrengthMeter from '../components/StrengthMeter';

const MIN_SCORE = 3;   // on refuse en dessous de "Fort"

export default function Register({ onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [score, setScore] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setError('');

    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    if (score < MIN_SCORE) {
      setError('Mot de passe trop faible');
      return;
    }

    setBusy(true);   // Argon2 prend ~1 s : il FAUT un indicateur visuel
    try {
      // 1. Sel aléatoire, généré côté client et jamais réutilisé
      const salt = generateSalt();

      // 2. Dérivation. Le mot de passe ne quitte JAMAIS cette fonction.
      const authHash = await deriveAuthHash(password, salt);

      // 3. On envoie le sel et le hash. Pas le mot de passe.
      await registerUser(email, salt, authHash);

      onDone?.();
    } catch (e) {
      // Message volontairement générique : le serveur répond
      // "Inscription impossible" sans dire si l'email existe.
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '3rem auto' }}>
      <h2>Créer un coffre</h2>

      <input
        type="email"
        placeholder="Adresse e-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: '100%', marginBottom: 8 }}
      />

      <input
        type="password"
        placeholder="Mot de passe maître"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: '100%' }}
      />
      <StrengthMeter password={password} onScore={setScore} />

      <input
        type="password"
        placeholder="Confirmer"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        style={{ width: '100%', marginTop: 8 }}
      />

      {error && <p style={{ color: '#c0392b' }}>{error}</p>}

      <button onClick={handleSubmit} disabled={busy} style={{ marginTop: 12 }}>
        {busy ? 'Dérivation en cours…' : 'Créer le coffre'}
      </button>

      <p style={{ marginTop: 16, fontSize: 13, color: '#666' }}>
        Ce mot de passe ne peut pas être réinitialisé. S'il est perdu,
        les secrets sont définitivement irrécupérables.
      </p>
    </div>
  );
}
