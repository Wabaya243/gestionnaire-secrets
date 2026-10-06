import { panelClass, dateLabel } from "../lib/display";
export function ErrorNotice({ children }) {
  return children ? (
    <p
      role="alert"
      className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200"
    >
      {children}
    </p>
  ) : null;
}
export function Stat({ label, value }) {
  return (
    <div className={panelClass}>
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-zinc-100">{value}</p>
    </div>
  );
}
const actions = {
  "login.success": "Connexion réussie",
  "login.failed": "Tentative de connexion refusée",
  "secret.created": "Secret ajouté",
  "secret.updated": "Secret modifié",
  "secret.deleted": "Secret supprimé",
  "mfa.enabled": "Double authentification activée",
  "mfa.disabled": "Double authentification désactivée",
  "sharing.initialized": "Identité de partage créée",
  "file.uploaded": "Fichier chiffré ajouté",
  "file.downloaded": "Blob de fichier téléchargé",
  "file.shared": "Fichier partagé",
  "file.received": "Partage reçu",
  "file.revoked": "Accès au fichier révoqué",
  "file.deleted": "Fichier supprimé",
  "admin.account.enabled": "Compte réactivé",
  "admin.account.disabled": "Compte désactivé",
  "admin.account.unlocked": "Compte débloqué",
  "admin.role.granted": "Rôle admin accordé",
  "admin.role.revoked": "Rôle admin retiré",
};
export function Activity({ events }) {
  if (!events.length)
    return (
      <p className="text-sm text-zinc-500">
        Aucune activité enregistrée depuis cette mise à jour.
      </p>
    );
  return (
    <ul className="divide-y divide-zinc-800">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-wrap justify-between gap-2 py-3 text-sm"
        >
          <span>
            {actions[event.action] || event.action}
            {event.target_user_id ? ` · compte #${event.target_user_id}` : ""}
          </span>
          <time className="text-xs text-zinc-500">
            {dateLabel(event.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}
