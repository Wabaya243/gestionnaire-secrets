import { createContext, useCallback, useContext, useMemo, useState, useEffect, useRef } from 'react';
import { fetchMe, logoutUser } from './api';

// Le contexte porte la clé de chiffrement pour toute l'application.
// Rien n'est écrit sur disque : la clé vit dans un état React,
// donc uniquement en mémoire vive, et disparaît au rechargement.
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const generation = useRef(0);
  const [encKey, setEncKey] = useState(null);    // CryptoKey ou null
  const [profile, setProfile] = useState(null);  // { email, mfa_enabled, created_at }

  // Recharge le profil depuis le serveur. Un échec signifie que le cookie
  // de session ne vaut plus rien : on oublie la clé, sinon l'interface
  // resterait déverrouillée alors qu'aucune requête ne passerait plus.
  const refreshProfile = useCallback(async () => {
    const ticket = generation.current;
    try {
      const me = await fetchMe();
      if (ticket !== generation.current) return null;
      setProfile(me);
      return me;
    } catch {
      if (ticket !== generation.current) return null;
      setEncKey(null);
      setProfile(null);
      return null;
    }
  }, []);

  // La clé est dérivée par l'appelant ; l'email, lui, vient du serveur.
  const unlock = useCallback(
    async (key) => {
      const me = await refreshProfile();
      if (me) setEncKey(key);
      return me;
    },
    [refreshProfile],
  );

  const lock = useCallback(() => {
    // Verrouiller = oublier la clé. Rien d'autre à effacer.
    generation.current += 1;
    setEncKey(null);
    setProfile(null);
    logoutUser().catch(() => {});
  }, []);

  useEffect(() => {
    window.addEventListener('vault-session-expired', lock);
    return () => window.removeEventListener('vault-session-expired', lock);
  }, [lock]);
  useEffect(() => {
    if (!encKey) return;
    const timer = setInterval(refreshProfile, 60000);
    return () => clearInterval(timer);
  }, [encKey, refreshProfile]);

  const value = useMemo(
    () => ({
      encKey,
      profile,
      email: profile?.email ?? null,
      mfaEnabled: profile?.mfa_enabled ?? false,
      isUnlocked: encKey !== null,
      unlock,
      lock,
      refreshProfile,
    }),
    [encKey, profile, unlock, lock, refreshProfile],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
