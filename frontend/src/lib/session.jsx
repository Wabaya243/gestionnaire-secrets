import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { fetchMe } from './api';

// Le contexte porte la clé de chiffrement pour toute l'application.
// Rien n'est écrit sur disque : la clé vit dans un état React,
// donc uniquement en mémoire vive, et disparaît au rechargement.
const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [encKey, setEncKey] = useState(null);    // CryptoKey ou null
  const [profile, setProfile] = useState(null);  // { email, mfa_enabled, created_at }

  // Recharge le profil depuis le serveur. Un échec signifie que le cookie
  // de session ne vaut plus rien : on oublie la clé, sinon l'interface
  // resterait déverrouillée alors qu'aucune requête ne passerait plus.
  const refreshProfile = useCallback(async () => {
    try {
      const me = await fetchMe();
      setProfile(me);
      return me;
    } catch {
      setEncKey(null);
      setProfile(null);
      return null;
    }
  }, []);

  // La clé est dérivée par l'appelant ; l'email, lui, vient du serveur.
  const unlock = useCallback(
    async (key) => {
      setEncKey(key);
      return refreshProfile();
    },
    [refreshProfile],
  );

  const lock = useCallback(() => {
    // Verrouiller = oublier la clé. Rien d'autre à effacer.
    setEncKey(null);
    setProfile(null);
  }, []);

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
