import { useState } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { generateSalt, deriveAuthHash } from '../lib/crypto';
import { registerUser } from '../lib/api';
import StrengthMeter from '../components/StrengthMeter';

const MIN_SCORE = 3;   // on refuse en dessous de "Fort"

const LABEL = 'block text-xs font-medium text-zinc-400';

const INPUT =
  'mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-600 hover:border-zinc-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/50';

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
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Créer un coffre
        </h2>
        <p className="text-xs leading-relaxed text-zinc-500">
          Choisissez un mot de passe maître : il protège tout le reste.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="register-email" className={LABEL}>Adresse e-mail</label>
          <input
            id="register-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor="register-password" className={LABEL}>Mot de passe maître</label>
          <input
            id="register-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
          <StrengthMeter password={password} onScore={setScore} />
        </div>

        <div>
          <label htmlFor="register-confirm" className={LABEL}>Confirmer</label>
          <input
            id="register-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={INPUT}
          />
        </div>
      </div>

      {/* Ambre et non rouge : ce n'est pas une erreur mais une
          conséquence irréversible que l'utilisateur doit lire avant. */}
      <div className="flex gap-3 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-3">
        <TriangleAlert size={16} className="mt-0.5 shrink-0 text-amber-400" />
        <p className="text-xs leading-relaxed text-amber-200/90">
          Ce mot de passe ne peut pas être réinitialisé. S'il est perdu,
          les secrets sont définitivement irrécupérables.
        </p>
      </div>

      {error && (
        <p className="rounded-r-lg border-l-2 border-red-500 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-3">
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-emerald-600"
        >
          {busy ? 'Dérivation en cours…' : 'Créer le coffre'}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-emerald-400/90">
          <ShieldCheck size={16} className="shrink-0" />
          Chiffré de bout en bout
        </p>
      </div>
    </div>
  );
}
