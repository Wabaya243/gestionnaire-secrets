import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck } from 'lucide-react';
import { mfaSetup, mfaActivate, mfaDisable } from '../lib/api';
import { useSession } from '../lib/session';

const CARD = 'rounded-xl border border-zinc-800 bg-zinc-900 p-4';

const ERROR_BOX =
  'mt-4 rounded-r-lg border-l-2 border-red-500 bg-red-950/50 px-3 py-2 text-sm text-red-300';

const BTN_GHOST =
  'rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600';

export default function MfaSetup() {
  // L'état d'activation vient du serveur, pas d'un état local :
  // c'est /auth/me qui fait foi, y compris après un rechargement.
  const { mfaEnabled, refreshProfile } = useSession();

  const [uri, setUri] = useState(null);
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function start() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const res = await mfaSetup();
      setUri(res.provisioning_uri);
      setSecret(res.secret);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setError('');
    setBusy(true);
    try {
      await mfaActivate(code);
      // Le serveur a basculé mfa_enabled : on relit le profil
      // plutôt que de deviner l'état côté client.
      await refreshProfile();
      setUri(null);
      setSecret('');
      setCode('');
    } catch {
      setError('Code invalide — vérifiez l’heure de votre téléphone');
    } finally {
      setBusy(false);
    }
  }

  async function disable(event) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await mfaDisable(disableCode);
      setDisableCode('');
      setShowDisable(false);
      setUri(null);
      setSecret('');
      setCode('');
      await refreshProfile();
      setNotice('Double authentification désactivée.');
    } catch (e) {
      setError(e.status === 400 ? 'Code invalide — vérifiez l’heure de votre téléphone' : e.message);
    } finally {
      setBusy(false);
    }
  }

  if (mfaEnabled) {
    return (
      <div className={CARD}>
        <p className="flex items-center gap-2 text-sm text-emerald-400">
          <ShieldCheck size={16} className="shrink-0" />
          Double authentification active
        </p>
        {showDisable ? (
          <form onSubmit={disable} className="mt-4 space-y-3">
            <p className="text-xs leading-relaxed text-zinc-400">
              Saisissez un code de votre application TOTP pour désactiver la protection.
              Si ce compte est administrateur, l’administration sera inaccessible jusqu’à
              sa réactivation.
            </p>
            <label htmlFor="mfa-disable-code" className="block text-xs font-medium text-zinc-400">
              Code à 6 chiffres
            </label>
            <input
              id="mfa-disable-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
              className="w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-center text-sm tracking-[0.3em] text-zinc-100 outline-none focus:border-emerald-600"
            />
            <div className="flex gap-2">
              <button disabled={busy || disableCode.length !== 6} className={BTN_GHOST}>
                {busy ? 'Vérification…' : 'Confirmer la désactivation'}
              </button>
              <button
                type="button"
                disabled={busy}
                className={BTN_GHOST}
                onClick={() => { setShowDisable(false); setDisableCode(''); setError(''); }}
              >
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={`${BTN_GHOST} mt-3`}
            onClick={() => { setShowDisable(true); setError(''); }}
          >
            Désactiver la double authentification
          </button>
        )}
        {error && <p role="alert" className={ERROR_BOX}>{error}</p>}
      </div>
    );
  }

  if (!uri) {
    return (
      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div className="space-y-1">
          <p className="text-sm font-medium text-zinc-300">Double authentification</p>
          <p className="text-xs text-zinc-500">Second facteur par application TOTP.</p>
        </div>
        <button onClick={start} disabled={busy} className={BTN_GHOST}>
          {busy ? 'Préparation…' : 'Activer la double authentification'}
        </button>
        {error && <p className={`${ERROR_BOX} w-full`}>{error}</p>}
        {notice && <p role="status" className="w-full text-xs text-emerald-400">{notice}</p>}
      </div>
    );
  }

  return (
    <div className={CARD}>
      <p className="text-sm text-zinc-400">
        Scannez ce code avec Google Authenticator ou Aegis :
      </p>

      {/* Le QR encode l'URI otpauth:// — donc le secret.
          Il ne doit jamais être capturé ni partagé.
          Fond blanc obligatoire : les lecteurs attendent des modules
          sombres sur clair, un QR sur fond zinc-950 ne se scanne pas. */}
      <div className="mt-4 inline-block rounded-lg bg-white p-3">
        <QRCodeSVG value={uri} size={180} />
      </div>

      <p className="mt-4 text-xs text-zinc-500">
        Saisie manuelle :{' '}
        <code className="mt-1 inline-block rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs break-all text-zinc-200 select-all">
          {secret}
        </code>
      </p>

      <div className="mt-4">
        <label htmlFor="mfa-code" className="block text-xs font-medium text-zinc-400">
          Code à 6 chiffres
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <input
            id="mfa-code"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-36 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-center text-sm tracking-[0.3em] text-zinc-100 outline-none transition-colors duration-150 hover:border-zinc-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/50"
          />
          <button
            onClick={confirm}
            disabled={busy || code.length !== 6}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
          >
            {busy ? 'Vérification…' : 'Confirmer'}
          </button>
        </div>
      </div>

      {error && <p className={ERROR_BOX}>{error}</p>}
    </div>
  );
}
