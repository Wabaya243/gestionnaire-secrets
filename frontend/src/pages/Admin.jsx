import { useCallback, useEffect, useState } from "react";
import { useSession } from "../lib/session";
import {
  fetchAdminOverview,
  fetchAdminUsers,
  fetchAdminActivity,
  setAccountState,
  unlockAccount,
  promoteAccount,
  demoteAccount,
  deleteAccount,
} from "../lib/api";
import { Stat, Activity, ErrorNotice } from "../components/DashboardUI";
import { bytesLabel, dateLabel, buttonClass, panelClass } from "../lib/display";

export default function Admin({ navigate }) {
  const { profile } = useSession();
  const [overview, setOverview] = useState(null);
  const [accounts, setAccounts] = useState({ items: [], total: 0 });
  const [events, setEvents] = useState([]);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [duration, setDuration] = useState(1440);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const load = useCallback(async () => {
    const [o, u, a] = await Promise.all([
      fetchAdminOverview(),
      fetchAdminUsers(offset, query),
      fetchAdminActivity(),
    ]);
    setOverview(o);
    setAccounts(u);
    setEvents(a);
  }, [offset, query]);
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
      else if (pending.action === "promote") await promoteAccount(pending.user.id);
      else if (pending.action === "demote") await demoteAccount(pending.user.id);
      else if (pending.action === "delete") await deleteAccount(pending.user.id);
      else if (pending.action === "temporary") await setAccountState(pending.user.id, false, Number(duration));
      else await setAccountState(pending.user.id, !pending.user.is_available);
      setPending(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function ask(user, action) {
    setError("");
    setConfirmation("");
    setDuration(1440);
    setPending({ user, action });
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
          restent chiffrés. {profile.is_superadmin
            ? "Votre rôle superadmin permet d’attribuer et de retirer le rôle admin."
            : "Seul un superadmin peut attribuer ou retirer le rôle admin."}
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
            {{ unlock: "Débloquer", promote: "Promouvoir administrateur", demote: "Rétrograder en utilisateur", delete: "Supprimer définitivement", temporary: "Suspendre temporairement", state: pending.user.is_available ? "Désactiver jusqu’à réactivation" : "Réactiver" }[pending.action]}{" "}
            le compte <strong>{pending.user.email}</strong> ?
          </p>
          {pending.action === "temporary" && (
            <label className="mt-3 block text-sm text-zinc-300">
              Durée de suspension
              <select className="ml-3 rounded-md border border-zinc-700 bg-zinc-950 p-2" value={duration} onChange={(e) => setDuration(e.target.value)}>
                <option value={60}>1 heure</option>
                <option value={1440}>24 heures</option>
                <option value={10080}>7 jours</option>
              </select>
            </label>
          )}
          {(pending.action === "temporary" || pending.action === "state" || pending.action === "promote" || pending.action === "demote") && (
            <p className="mt-2 text-xs text-amber-200">
              Les sessions existantes seront invalidées.
              {(pending.action === "temporary" || pending.action === "state")
                ? " Une suspension empêche aussi les téléchargements des fichiers partagés par ce compte."
                : " Le compte devra se reconnecter pour prendre en compte son nouveau rôle."}
            </p>
          )}
          {pending.action === "delete" && (
            <div className="mt-3 text-sm text-red-300">
              <p>Cette suppression est irréversible : secrets, fichiers chiffrés et partages seront effacés. Saisissez l’adresse complète pour confirmer.</p>
              <input className="mt-2 w-full rounded-md border border-red-800 bg-zinc-950 p-2" aria-label="Confirmer l’adresse à supprimer" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button className={buttonClass} disabled={busy || (pending.action === "delete" && confirmation !== pending.user.email)} onClick={apply}>
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
        <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setOffset(0); setQuery(draft.trim()); }}>
          <input className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 p-2 text-sm" aria-label="Rechercher un compte par adresse e-mail" placeholder="Rechercher un compte par e-mail" value={draft} maxLength={254} onChange={(e) => setDraft(e.target.value)} />
          <button className={buttonClass} type="submit">Rechercher</button>
          {query && <button className={buttonClass} type="button" onClick={() => { setDraft(""); setQuery(""); setOffset(0); }}>Effacer</button>}
        </form>
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
                      {u.is_superadmin ? " · superadmin" : u.is_admin ? " · admin" : ""}
                    </p>
                  </td>
                  <td className="p-3">
                    {!u.is_available
                      ? u.suspended_until && u.is_active ? `Suspendu jusqu’au ${dateLabel(u.suspended_until)}` : "Désactivé jusqu’à réactivation"
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        className={buttonClass}
                        disabled={busy || u.is_admin}
                        onClick={() => ask(u, "state")}
                      >
                        {u.is_available ? "Désactiver" : "Réactiver"}
                      </button>
                      {u.is_available && !u.is_admin && <button className={buttonClass} disabled={busy} onClick={() => ask(u, "temporary")}>Suspendre</button>}
                      <button
                        className={buttonClass}
                        disabled={busy || (!u.is_locked && !u.failed_attempts)}
                        onClick={() =>
                          ask(u, "unlock")
                        }
                      >
                        Débloquer
                      </button>
                      {profile.is_superadmin && !u.is_admin && <button className={buttonClass} disabled={busy || !u.is_available || !u.mfa_enabled} title={!u.mfa_enabled ? "Le compte doit d’abord activer le MFA" : ""} onClick={() => ask(u, "promote")}>Promouvoir admin</button>}
                      {profile.is_superadmin && u.is_admin && !u.is_superadmin && u.id !== profile.id && <button className={buttonClass} disabled={busy} onClick={() => ask(u, "demote")}>Retirer admin</button>}
                      {!u.is_admin && <button className={buttonClass} disabled={busy} onClick={() => ask(u, "delete")}>Supprimer</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {accounts.items.length === 0 && <p className="p-4 text-sm text-zinc-400">Aucun compte trouvé.</p>}
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
