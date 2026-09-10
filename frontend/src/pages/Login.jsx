import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { deriveAuthHash, deriveEncryptionKey } from '../lib/crypto';
import { fetchSalt, loginUser } from '../lib/api';
import { useSession } from '../lib/session';

const LABEL = 'block text-xs font-medium text-zinc-400';

const INPUT =
  'mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-600 hover:border-zinc-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/50';

export default function Login() {
  const { unlock } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setError('');
    setBusy(true);

    try {
      // 1. Récupérer le sel de CET utilisateur.
      //    Le serveur répond toujours, même pour un email inconnu
      //    (sel factice déterministe) : pas d'énumération possible.
      const { kdf_salt } = await fetchSalt(email);

      // 2. Deux dérivations indépendantes à partir du même mot de passe.
      //    Coûteux (~650 ms chacune) : d'où l'indicateur visuel.
      const authHash = await deriveAuthHash(password, kdf_salt);
      const encKey = await deriveEncryptionKey(password, kdf_salt);

      // 3. Seul authHash part sur le réseau. encKey reste ici.
      const res = await loginUser(email, authHash, totp);

      if (res.mfa_required) {
        // Le serveur demande le second facteur : on affiche le champ
        // et on attend. La clé est déjà dérivée, on la garde en local.
        setNeedTotp(true);
        setBusy(false);
        return;
      }

      // 4. Connexion validée : on place la clé en mémoire.
      //    Le cookie JWT a été posé par le serveur (HttpOnly).
      //    unlock charge ensuite le profil depuis /auth/me.
      await unlock(encKey);

    } catch (e) {
      if (e.status === 423) {
        setError('Compte temporairement verrouillé. Réessayez plus tard.');
      } else {
        // 401 : on ne dit pas si c'est l'email ou le mot de passe.
        setError('Identifiants invalides');
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
          Ouvrir le coffre
        </h2>
        <p className="text-xs leading-relaxed text-zinc-500">
          Déverrouillez votre coffre avec votre mot de passe maître.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="login-email" className={LABEL}>Adresse e-mail</label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT}
          />
        </div>

        <div>
          <label htmlFor="login-password" className={LABEL}>Mot de passe maître</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </div>

        {needTotp && (
          <div>
            <label htmlFor="login-totp" className={LABEL}>Code à 6 chiffres</label>
            <input
              id="login-totp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={totp}
              onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))}
              className={`${INPUT} text-center tracking-[0.4em]`}
            />
          </div>
        )}
      </div>

      {error && (
        <p className="rounded-r-lg border-l-2 border-red-500 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {/* La dérivation Argon2 bloque ~1 s : l'opacité et le curseur
            signalent que l'attente est normale, pas un gel de l'interface. */}
        <button
          onClick={handleSubmit}
          disabled={busy}
          className="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:cursor-wait disabled:opacity-60 disabled:hover:bg-emerald-600"
        >
          {busy ? 'Déverrouillage…' : 'Déverrouiller'}
        </button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-emerald-400/90">
          <ShieldCheck size={16} className="shrink-0" />
          Chiffré de bout en bout
        </p>
      </div>
    </div>
  );
}
