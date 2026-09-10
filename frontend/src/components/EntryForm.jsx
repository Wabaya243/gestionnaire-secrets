import { useState } from 'react';
import { Wand2 } from 'lucide-react';
import { generatePassword } from '../lib/crypto';

const LABEL = 'block text-xs font-medium text-zinc-400';

const INPUT =
  'mt-1.5 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors duration-150 placeholder:text-zinc-600 hover:border-zinc-700 focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600/50';

const BTN_PRIMARY =
  'rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors duration-150 hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-emerald-600';

const BTN_GHOST =
  'inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-300 transition-colors duration-150 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-zinc-600';

const CHECKBOX =
  'h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600/50';

// Formulaire partagé par l'ajout et l'édition : même structure de champs
// des deux côtés, donc un seul endroit à faire évoluer.
export default function EntryForm({
  idPrefix,
  label,
  onLabelChange,
  entry,
  onEntryChange,
  onSubmit,
  submitLabel,
  onCancel,
}) {
  // Réglages du générateur : purement locaux au formulaire,
  // ils n'ont pas à remonter dans l'état du coffre.
  const [length, setLength] = useState(20);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);

  function setField(name, value) {
    onEntryChange({ ...entry, [name]: value });
  }

  function generate() {
    setField('password', generatePassword({ length, digits, symbols }));
  }

  // Libellé et mot de passe sont les deux seuls champs obligatoires.
  const incomplete = !label.trim() || !entry.password;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-label`} className={LABEL}>
          Libellé <span className="text-zinc-600">(requis)</span>
        </label>
        <input
          id={`${idPrefix}-label`}
          placeholder="ex. Compte bancaire"
          value={label}
          onChange={(e) => onLabelChange(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-username`} className={LABEL}>Identifiant</label>
        <input
          id={`${idPrefix}-username`}
          placeholder="ex. marie@exemple.fr"
          value={entry.username}
          onChange={(e) => setField('username', e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-password`} className={LABEL}>
          Mot de passe <span className="text-zinc-600">(requis)</span>
        </label>
        <div className="mt-1.5 flex items-start gap-2">
          <input
            id={`${idPrefix}-password`}
            value={entry.password}
            onChange={(e) => setField('password', e.target.value)}
            className={`${INPUT} mt-0 flex-1 font-mono`}
          />
          <button
            type="button"
            onClick={generate}
            title="Générer un mot de passe"
            aria-label="Générer un mot de passe"
            className="inline-flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition-colors duration-150 hover:border-emerald-700 hover:bg-emerald-950/40 hover:text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-700"
          >
            <Wand2 size={16} />
          </button>
        </div>

        <div className="mt-2 space-y-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={digits}
                onChange={(e) => setDigits(e.target.checked)}
                className={CHECKBOX}
              />
              Chiffres
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={symbols}
                onChange={(e) => setSymbols(e.target.checked)}
                className={CHECKBOX}
              />
              Symboles
            </label>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label htmlFor={`${idPrefix}-length`} className="text-xs text-zinc-400">
                Longueur
              </label>
              <span className="font-mono text-xs text-zinc-300">{length}</span>
            </div>
            <input
              id={`${idPrefix}-length`}
              type="range"
              min={12}
              max={40}
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
              className="mt-1.5 w-full accent-emerald-600"
            />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor={`${idPrefix}-url`} className={LABEL}>URL du site</label>
        <input
          id={`${idPrefix}-url`}
          type="url"
          placeholder="https://exemple.fr"
          value={entry.url}
          onChange={(e) => setField('url', e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-notes`} className={LABEL}>Notes</label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={3}
          value={entry.notes}
          onChange={(e) => setField('notes', e.target.value)}
          className={`${INPUT} resize-y`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSubmit}
          disabled={incomplete}
          className={onCancel ? BTN_PRIMARY : `${BTN_PRIMARY} w-full`}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button onClick={onCancel} className={BTN_GHOST}>Annuler</button>
        )}
      </div>
    </div>
  );
}
