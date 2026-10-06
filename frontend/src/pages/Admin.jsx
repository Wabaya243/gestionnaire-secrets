import { useCallback, useEffect, useState } from "react";
import { useSession } from "../lib/session";
import {
  fetchAdminOverview,
  fetchAdminUsers,
  fetchAdminActivity,
  setAccountState,
  unlockAccount,
} from "../lib/api";
import { Stat, Activity, ErrorNotice } from "../components/DashboardUI";
import { bytesLabel, dateLabel, buttonClass, panelClass } from "../lib/display";

export default function Admin({ navigate }) {
  const { profile } = useSession();
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState({ items: [], total: 0 });
  const [events, setEvents] = useState([]);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const load = useCallback(async () => {
    const [o, u, a] = await Promise.all([
      fetchAdminOverview(),
      fetchAdminUsers(offset),
      fetchAdminActivity(),
    ]);
    setOverview(o);
    setAccounts(u);
    setEvents(a);
  }, [offset]);
  useEffect(() => {
    if (profile.mfa_enabled)
      Promise.resolve()
        .then(load)
        .catch((e) => setError(e.message));
  }, [load, profile.mfa_enabled]);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      if (pending.action === "unlock") await unlockAccount(pending.user.id);
      else await setAccountState(pending.user.id, !pending.user.is_active);
      setPending(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  if (!profile.mfa_enabled)
    return (
      <section className={panelClass}>
        <h1 className="text-2xl font-semibold">Administration</h1>
        <p className="my-4 text-sm text-amber-300">
          Activez votre double authentification pour accéder à l’administration.
        </p>
        <button className={buttonClass} onClick={() => navigate("dashboard")}>
          Configurer le MFA
        </button>
      </section>
    );
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-emerald-400">ADMINISTRATION</p>
        <h1 className="mt-2 text-3xl font-semibold">Vue d’ensemble</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Gestion des comptes et métadonnées. Les contenus et noms de fichiers
          restent chiffrés.
        </p>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
      {overview && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Comptes actifs / total"
            value={`${overview.active_users} / ${overview.users}`}
          />
          <Stat label="MFA activé" value={overview.mfa_users} />
          <Stat
            label="Secrets / fichiers"
            value={`${overview.secrets} / ${overview.files}`}
          />
          <Stat
            label="Stockage chiffré"
            value={bytesLabel(overview.storage_bytes)}
          />
        </div>
      )}
      {pending && (
        <section
          role="alertdialog"
          aria-label="Confirmer l’action"
          className="rounded-xl border border-amber-800 bg-amber-950/40 p-4"
        >
          <p className="text-sm">
            {pending.action === "unlock"
              ? "Débloquer"
              : pending.user.is_active
                ? "Désactiver"
                : "Réactiver"}{" "}
            le compte <strong>{pending.user.email}</strong> ?
          </p>
          {pending.action !== "unlock" && (
            <p className="mt-2 text-xs text-amber-200">
              Les sessions existantes seront invalidées. La désactivation
              suspend aussi les partages de ce compte.
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button className={buttonClass} disabled={busy} onClick={apply}>
              Confirmer
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Annuler
            </button>
          </div>
        </section>
      )}
      <section className={panelClass}>
        <h2 className="mb-4 font-medium">Utilisateurs ({accounts.total})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-400">
              <tr>
                {[
                  "Compte",
                  "État",
                  "MFA",
                  "Secrets / fichiers",
                  "Création / connexion",
                  "Actions",
                ].map((x) => (
                  <th key={x} className="p-3">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accounts.items.map((u) => (
                <tr key={u.id} className="border-t border-zinc-800">
                  <td className="p-3">
                    {u.email}
                    <p className="text-xs text-zinc-500">
                      #{u.id}
                      {u.is_admin ? " · admin" : ""}
                    </p>
                  </td>
                  <td className="p-3">
                    {!u.is_active
                      ? "Désactivé"
                      : u.is_locked
                        ? "Verrouillé"
                        : "Actif"}
                    <p className="text-xs text-zinc-500">
                      {u.failed_attempts} échec(s)
                      {u.is_locked
                        ? ` · jusqu’au ${dateLabel(u.locked_until)}`
                        : ""}
                    </p>
                  </td>
                  <td className="p-3">{u.mfa_enabled ? "Oui" : "Non"}</td>
                  <td className="p-3">
                    {u.secrets} / {u.files}
                    <p className="text-xs text-zinc-500">
                      {bytesLabel(u.storage_bytes)}
                    </p>
                  </td>
                  <td className="p-3 text-xs text-zinc-400">
                    {dateLabel(u.created_at)}
                    <p>{dateLabel(u.last_login_at)}</p>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button
                        className={buttonClass}
                        disabled={busy || u.is_admin}
                        onClick={() => setPending({ user: u, action: "state" })}
                      >
                        {u.is_active ? "Désactiver" : "Réactiver"}
                      </button>
                      <button
                        className={buttonClass}
                        disabled={busy || (!u.is_locked && !u.failed_attempts)}
                        onClick={() =>
                          setPending({ user: u, action: "unlock" })
                        }
                      >
                        Débloquer
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex justify-between">
          <button
            className={buttonClass}
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Précédent
          </button>
          <button
            className={buttonClass}
            disabled={offset + 50 >= accounts.total}
            onClick={() => setOffset(offset + 50)}
          >
            Suivant
          </button>
        </div>
      </section>
      <section className={panelClass}>
        <h2 className="mb-3 font-medium">Journal d’administration</h2>
        <Activity events={events} />
      </section>
    </div>
  );
}
