import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';
import { useSession } from '../lib/session';
import { encrypt, decrypt } from '../lib/crypto';
import { listItems, createItem, deleteItem, updateItem, } from '../lib/api';
import MfaSetup from '../components/MfaSetup';
import Logo from '../components/Logo';
import EntryForm from '../components/EntryForm';
import SecretCard from '../components/SecretCard';

const EMPTY = { username: '', password: '', url: '', notes: '' };

const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600';

export default function Vault() {
  const { encKey, email, lock } = useSession();

  const [items, setItems] = useState([]);      // items déchiffrés
  const [label, setLabel] = useState('');
  const [entry, setEntry] = useState(EMPTY);
  const [expandedId, setExpandedId] = useState(null);  // carte dépliée
  const [revealed, setRevealed] = useState(null);      // mot de passe en clair
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  // Édition : on retient l'id en cours de modification et les valeurs saisies.
  // null = aucune édition active.
  const [editingId, setEditingId] = useState(null);
  const [editLabel, setEditLabel] = useState('');
  const [editEntry, setEditEntry] = useState(EMPTY);
  // Purement visuel : quel champ de quel item vient d'être copié.
  const [copied, setCopied] = useState(null);          // { id, field }
  const copyTimer = useRef(null);

  // On annule le minuteur au démontage, sinon il tenterait un setState
  // sur un composant disparu (coffre verrouillé pendant les 2 s).
  useEffect(() => () => clearTimeout(copyTimer.current), []);

  //  Chargement et déchiffrement

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await listItems();

      // Le serveur renvoie des blobs. On les déchiffre un par un,
      // ici, dans le navigateur, avec la clé qui n'a jamais circulé.
      const clear = await Promise.all(
        raw.map(async (it) => {
          const label = await decrypt(encKey, it.label_enc);
          const payload = await decrypt(encKey, it.payload_enc);

          // Compatibilité : les anciens secrets sont du texte simple,
          // pas du JSON. On les récupère comme mot de passe seul.
          // Le test sur le type couvre un ancien secret entièrement
          // numérique, que JSON.parse accepterait comme nombre.
          let data;
          try {
            const parsed = JSON.parse(payload);
            data = parsed && typeof parsed === 'object'
              ? { ...EMPTY, ...parsed }
              : { ...EMPTY, password: payload };
          } catch {
            data = { ...EMPTY, password: payload };
          }

          return { id: it.id, label, ...data };
        }),
      );

      setItems(clear);
    } catch (e) {
      setError('Impossible de déchiffrer le coffre');
    } finally {
      setLoading(false);
    }
  }, [encKey]);

  useEffect(() => { load(); }, [load]);

  // Ajout

  async function handleAdd() {
    if (!label.trim() || !entry.password) return;
    setError('');

    try {
      // Deux chiffrements distincts, donc deux nonces différents.
      // Le libellé est chiffré au même titre que le secret.
      const labelEnc = await encrypt(encKey, label);
      // JSON.stringify transforme l'objet en texte, puis on chiffre ce texte.
      // Le serveur reçoit un blob : il ignore qu'il contient une structure.
      const payloadEnc = await encrypt(encKey, JSON.stringify(entry));

      await createItem(labelEnc, payloadEnc);

      setLabel('');
      setEntry(EMPTY);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  // Edition
  function startEdit(item) {
    // On préremplit avec les valeurs DÉJÀ DÉCHIFFRÉES en mémoire.
    // Aucun appel réseau nécessaire : le coffre est ouvert.
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditEntry({
      username: item.username ?? '',
      password: item.password ?? '',
      url: item.url ?? '',
      notes: item.notes ?? '',
    });
    setRevealed(null);        // on masque l'affichage pendant l'édition
  }

  function cancelEdit() {
    setEditingId(null);
    setEditLabel('');
    setEditEntry(EMPTY);
  }

  async function saveEdit(id) {
    if (!editLabel.trim() || !editEntry.password) return;
    setError('');

    try {
      // Rechiffrement complet : deux nouveaux nonces sont générés.
      // On ne réutilise JAMAIS l'ancien nonce sous la même clé —
      // ce serait la faute la plus grave possible avec AES-GCM.
      const labelEnc = await encrypt(encKey, editLabel);
      const payloadEnc = await encrypt(encKey, JSON.stringify(editEntry));

      await updateItem(id, labelEnc, payloadEnc);

      cancelEdit();
      await load();           // on relit depuis le serveur : source de vérité
    } catch (e) {
      setError('Modification impossible');
    }
  }

  // Copie : un accusé de 2 s, par champ et par item.
  function handleCopy(id, field, value) {
    navigator.clipboard.writeText(value);
    setCopied({ id, field });
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 2000);
  }

  // Suppression
  async function handleDelete(id) {
    await deleteItem(id);
    await load();
  }

  // Rendu

  return (
    <div className="relative min-h-screen">
      {/* Fond ambiant fixé au viewport : il habille toute la page et
          reste en place pendant le défilement, au lieu de s'arrêter
          sous l'en-tête. -z-10 le maintient derrière le contenu. */}
      <div className="pointer-events-none fixed inset-0 -z-10 bg-linear-to-br from-emerald-950/70 via-zinc-950 to-zinc-950" />
      <div className="pointer-events-none fixed -top-40 -left-40 -z-10 h-128 w-128 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none fixed top-1/3 -right-40 -z-10 h-128 w-128 rounded-full bg-teal-400/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-48 left-1/4 -z-10 h-128 w-128 rounded-full bg-emerald-600/15 blur-3xl" />

      {/* En-tête collant : sur une longue liste, verrouiller le coffre
          doit rester atteignable sans remonter en haut de page. */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/70 bg-zinc-950/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-4 px-4 py-3.5">
          <Logo />
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-xs text-zinc-500">{email}</span>
            <button onClick={lock} className={`${BTN_GHOST} shrink-0`}>
              <Lock size={16} />
              Verrouiller
            </button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto max-w-xl px-4 py-10">
        <div className="space-y-8">
          <MfaSetup />

          <section>
            <h2 className="text-sm font-medium text-zinc-300">Nouveau secret</h2>
            <div className="mt-3 rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm">
              <EntryForm
                idPrefix="new"
                label={label}
                onLabelChange={setLabel}
                entry={entry}
                onEntryChange={setEntry}
                onSubmit={handleAdd}
                submitLabel="Chiffrer et enregistrer"
              />
            </div>
          </section>

          {error && (
            <p className="rounded-r-lg border-l-2 border-red-500 bg-red-950/50 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <section>
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-100">
              Mes secrets{' '}
              <span className="text-xs font-normal text-zinc-500">({items.length})</span>
            </h2>

            {loading && <p className="mt-4 text-sm text-zinc-500">Déchiffrement…</p>}

            {!loading && items.length === 0 && (
              <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-12 text-center backdrop-blur-sm">
                <KeyRound size={16} className="text-zinc-600" />
                <p className="text-sm text-zinc-400">Aucun secret enregistré</p>
                <p className="text-xs text-zinc-500">
                  Ajoutez votre premier secret avec le formulaire ci-dessus.
                </p>
              </div>
            )}

            <div className="mt-4 space-y-3">
              {items.map((it) => (
                editingId === it.id ? (
                  <div key={it.id} className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 backdrop-blur-sm">
                    <EntryForm
                      idPrefix={`edit-${it.id}`}
                      label={editLabel}
                      onLabelChange={setEditLabel}
                      entry={editEntry}
                      onEntryChange={setEditEntry}
                      onSubmit={() => saveEdit(it.id)}
                      submitLabel="Rechiffrer et enregistrer"
                      onCancel={cancelEdit}
                    />
                  </div>
                ) : (
                  <SecretCard
                    key={it.id}
                    item={it}
                    expanded={expandedId === it.id}
                    onToggle={() => setExpandedId(expandedId === it.id ? null : it.id)}
                    revealed={revealed === it.id}
                    onToggleReveal={() => setRevealed(revealed === it.id ? null : it.id)}
                    copiedField={copied && copied.id === it.id ? copied.field : null}
                    onCopy={(field, value) => handleCopy(it.id, field, value)}
                    onEdit={() => startEdit(it)}
                    onDelete={() => handleDelete(it.id)}
                  />
                )
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
