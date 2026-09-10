import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Eye, EyeOff, Pencil, Trash2 } from 'lucide-react';

const ICON_BTN =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 text-zinc-400 transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600';

const ICON_BTN_ACTIVE =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-700 bg-emerald-950/40 text-emerald-400 transition-colors duration-150 hover:bg-emerald-950/70 focus:outline-none focus:ring-1 focus:ring-emerald-700';

const ICON_BTN_DANGER =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-800 text-zinc-400 transition-colors duration-150 hover:border-red-900 hover:bg-red-950/50 hover:text-red-400 focus:outline-none focus:ring-1 focus:ring-red-800';

const VALUE_BOX =
  'min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm break-all text-zinc-300';

// L'URL vient de l'utilisateur : sans ce filtre, un « javascript:… »
// enregistré dans un coffre deviendrait un lien exécutable au clic.
// On n'accepte que http(s), et on complète les domaines nus.
function safeHref(url) {
  const candidates = /^[a-z][a-z0-9+.-]*:/i.test(url) ? [url] : [`https://${url}`];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.href;
    } catch {
      // chaîne inexploitable : on retombera sur un affichage en texte
    }
  }
  return null;
}

function CopyButton({ copied, onCopy, title }) {
  return (
    <button
      onClick={onCopy}
      title={title}
      aria-label={title}
      className={copied ? ICON_BTN_ACTIVE : ICON_BTN}
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

function Row({ label, children, actions }) {
  return (
    <div>
      <p className="text-xs text-zinc-500">{label}</p>
      <div className="mt-1 flex items-start gap-2">
        {children}
        {actions}
      </div>
    </div>
  );
}

export default function SecretCard({
  item,
  expanded,
  onToggle,
  revealed,
  onToggleReveal,
  copiedField,
  onCopy,
  onEdit,
  onDelete,
}) {
  const href = item.url ? safeHref(item.url) : null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 transition-colors duration-150 hover:border-zinc-700">
      <div className="flex items-center gap-2 p-4">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-3 rounded text-left focus:outline-none focus:ring-1 focus:ring-zinc-600"
        >
          <span className="shrink-0 text-zinc-500">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-zinc-100">{item.label}</span>
            {item.username && (
              <span className="block truncate text-xs text-zinc-500">{item.username}</span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 gap-1.5">
          <button onClick={onEdit} title="Modifier" aria-label="Modifier" className={ICON_BTN}>
            <Pencil size={16} />
          </button>
          <button
            onClick={onDelete}
            title="Supprimer"
            aria-label="Supprimer"
            className={ICON_BTN_DANGER}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-zinc-800 px-4 py-4">
          {item.username && (
            <Row
              label="Identifiant"
              actions={
                <CopyButton
                  copied={copiedField === 'username'}
                  onCopy={() => onCopy('username', item.username)}
                  title="Copier l’identifiant"
                />
              }
            >
              <p className={VALUE_BOX}>{item.username}</p>
            </Row>
          )}

          <Row
            label="Mot de passe"
            actions={
              <>
                <button
                  onClick={onToggleReveal}
                  title={revealed ? 'Masquer' : 'Afficher'}
                  aria-label={revealed ? 'Masquer' : 'Afficher'}
                  className={revealed ? ICON_BTN_ACTIVE : ICON_BTN}
                >
                  {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <CopyButton
                  copied={copiedField === 'password'}
                  onCopy={() => onCopy('password', item.password)}
                  title="Copier le mot de passe"
                />
              </>
            }
          >
            <p className={`${VALUE_BOX} font-mono`}>
              {revealed ? item.password : '••••••••••••'}
            </p>
          </Row>

          {item.url && (
            <Row
              label="URL du site"
              actions={
                <CopyButton
                  copied={copiedField === 'url'}
                  onCopy={() => onCopy('url', item.url)}
                  title="Copier l’URL"
                />
              }
            >
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${VALUE_BOX} inline-flex items-center gap-1.5 text-emerald-400 transition-colors duration-150 hover:border-emerald-800 hover:text-emerald-300`}
                >
                  <span className="min-w-0 break-all">{item.url}</span>
                  <ExternalLink size={16} className="shrink-0" />
                </a>
              ) : (
                <p className={VALUE_BOX}>{item.url}</p>
              )}
            </Row>
          )}

          {item.notes && (
            <Row
              label="Notes"
              actions={
                <CopyButton
                  copied={copiedField === 'notes'}
                  onCopy={() => onCopy('notes', item.notes)}
                  title="Copier les notes"
                />
              }
            >
              <p className={`${VALUE_BOX} whitespace-pre-wrap`}>{item.notes}</p>
            </Row>
          )}
        </div>
      )}
    </div>
  );
}
