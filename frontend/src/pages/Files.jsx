import { useCallback, useEffect, useRef, useState } from "react";
import { FileLock2, Download, Share2, Trash2, ShieldCheck } from "lucide-react";
import { useSession } from "../lib/session";
import {
  fetchSharingKeys,
  saveSharingKeys,
  fetchFiles,
  uploadFile,
  downloadFile,
  removeFile,
  findRecipient,
  fetchShares,
  shareFile,
  revokeShare,
} from "../lib/api";
import {
  createIdentity,
  restoreIdentity,
  fingerprint,
  encryptFile,
  readMetadata,
  decryptFile,
  wrapForRecipient,
} from "../lib/fileCrypto";
import { ErrorNotice } from "../components/DashboardUI";
import {
  buttonClass,
  inputClass,
  panelClass,
  bytesLabel,
  dateLabel,
} from "../lib/display";

const normalizeFingerprint = (value) => value.replace(/\s/g, "").toUpperCase();

export default function Files() {
  const { encKey, profile } = useSession();
  const identity = useRef(null);
  const mounted = useRef(true);
  const input = useRef(null);
  const [ownFingerprint, setOwnFingerprint] = useState("");
  const [files, setFiles] = useState({
    owned: [],
    received: [],
    max_file_bytes: 10 * 1024 * 1024,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sharing, setSharing] = useState(null);
  const [shares, setShares] = useState([]);
  const [email, setEmail] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [expectedFingerprint, setExpectedFingerprint] = useState("");
  const [deleting, setDeleting] = useState(null);

  const load = useCallback(async () => {
    const [stored, listing] = await Promise.all([
      fetchSharingKeys(),
      fetchFiles(),
    ]);
    const restored = stored
      ? await restoreIdentity(encKey, profile.id, stored)
      : null;
    const own = stored ? await fingerprint(stored.public_key) : "";
    async function decorate(item) {
      try {
        const metadata = await readMetadata(encKey, restored, profile.id, item);
        if (
          typeof metadata.name !== "string" ||
          !Number.isSafeInteger(metadata.size) ||
          metadata.size < 0
        )
          throw new Error();
        return { ...item, metadata };
      } catch {
        return {
          ...item,
          corrupt: true,
          metadata: { name: "Déchiffrement impossible" },
        };
      }
    }
    const owned = await Promise.all(listing.owned.map(decorate));
    const received = await Promise.all(listing.received.map(decorate));
    if (!mounted.current) return;
    identity.current = restored;
    setOwnFingerprint(own);
    setFiles({ ...listing, owned, received });
  }, [encKey, profile.id]);
  useEffect(() => {
    mounted.current = true;
    load()
      .catch((e) => {
        if (mounted.current) setError(e.message);
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      identity.current = null;
    };
  }, [load]);

  async function run(action) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      if (mounted.current)
        setError(
          e.name === "OperationError"
            ? "Déchiffrement impossible : clé incorrecte ou données altérées."
            : e.message,
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function initialize() {
    run(async () => {
      const generated = await createIdentity(encKey, profile.id);
      if (!mounted.current) return;
      try {
        await saveSharingKeys(generated);
      } catch (e) {
        if (e.status !== 409) throw e;
      } // another tab may have initialized first
      await load();
      setNotice(
        "Identité de partage prête. Communiquez votre empreinte à vos correspondants.",
      );
    });
  }
  function upload(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;
    run(async () => {
      if (selected.size > files.max_file_bytes)
        throw new Error(
          `Limite : ${bytesLabel(files.max_file_bytes)} par fichier.`,
        );
      const encrypted = await encryptFile(encKey, selected);
      if (!mounted.current) return;
      await uploadFile(encrypted);
      await load();
      setNotice("Fichier chiffré et enregistré.");
    });
    event.target.value = "";
  }
  function download(item) {
    run(async () => {
      const encrypted = await downloadFile(item.id);
      if (!mounted.current) return;
      const clear = await decryptFile(
        encKey,
        identity.current,
        profile.id,
        item,
        encrypted,
      );
      if (!mounted.current) {
        clear.fill(0);
        return;
      }
      if (clear.length !== item.metadata.size) {
        clear.fill(0);
        throw new Error("Taille du fichier incohérente");
      }
      // Download only: no inline HTML/SVG/PDF execution within the vault origin.
      const blob = new Blob([clear], { type: "application/octet-stream" });
      clear.fill(0);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        Array.from(item.metadata.name, (c) =>
          c.charCodeAt(0) < 32 || c === "/" || c === "\\" ? "_" : c,
        ).join("") || "fichier";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  function openSharing(item) {
    setSharing(item);
    setEmail("");
    setRecipient(null);
    setExpectedFingerprint("");
    run(async () => setShares(await fetchShares(item.id)));
  }
  function lookup(event) {
    event.preventDefault();
    setRecipient(null);
    setExpectedFingerprint("");
    run(async () => {
      if (email.trim().toLowerCase() === profile.email.toLowerCase()) {
        throw new Error("Vous ne pouvez pas partager un fichier avec votre propre compte : il est déjà dans Mes fichiers.");
      }
      let found;
      try {
        found = await findRecipient(email.trim());
      } catch (e) {
        if (e.status === 404) {
          throw new Error(
            "Destinataire indisponible. Vérifiez l’adresse et demandez-lui d’ouvrir son propre compte, puis Fichiers → Activer la réception sécurisée.",
          );
        }
        throw e;
      }
      setRecipient({
        ...found,
        fingerprint: await fingerprint(found.public_key),
      });
    });
  }
  function send() {
    run(async () => {
      const wrapped = await wrapForRecipient(encKey, sharing, recipient);
      if (!mounted.current) return;
      await shareFile(sharing.id, {
        recipient_id: recipient.id,
        recipient_public_key: recipient.public_key,
        wrapped_key: wrapped,
      });
      setShares(await fetchShares(sharing.id));
      setRecipient(null);
      setExpectedFingerprint("");
      setNotice(
        "Partage enregistré. Le destinataire peut déchiffrer ce fichier depuis son espace.",
      );
    });
  }
  const verified =
    recipient &&
    normalizeFingerprint(expectedFingerprint) ===
      normalizeFingerprint(recipient.fingerprint);
  function card(item, received) {
    return (
      <article
        key={item.id}
        className={`${panelClass} flex flex-wrap items-center justify-between gap-4`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <FileLock2 className="shrink-0 text-emerald-400" size={22} />
          <div className="min-w-0">
            <h3 className="break-all text-sm font-medium">
              {item.metadata.name}
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              {item.corrupt
                ? "Données illisibles ou altérées"
                : bytesLabel(item.metadata.size)}{" "}
              · {dateLabel(item.created_at)}
              {received ? ` · de ${item.email}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={busy || item.corrupt}
            onClick={() => download(item)}
          >
            <Download size={15} />
            Télécharger
          </button>
          {!received && (
            <>
              <button
                className={buttonClass}
                disabled={busy || item.corrupt}
                onClick={() => openSharing(item)}
              >
                <Share2 size={15} />
                Partager
              </button>
              <button
                className={buttonClass}
                disabled={busy}
                onClick={() => setDeleting(item)}
                aria-label={`Supprimer ${item.metadata.name}`}
              >
                <Trash2 size={15} />
              </button>
            </>
          )}
        </div>
      </article>
    );
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-emerald-400">COFFRE DE FICHIERS</p>
        <h1 className="mt-2 text-3xl font-semibold">Mes fichiers</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Chiffrement dans votre navigateur, avant chaque envoi. Limite :{" "}
          {bytesLabel(files.max_file_bytes)} par fichier.
        </p>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-200"
        >
          {notice}
        </p>
      )}
      <section className={panelClass}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-emerald-400" size={18} />
          <h2 className="font-medium">Mon identité de partage</h2>
        </div>
        {ownFingerprint ? (
          <>
            <p className="mt-3 text-xs text-zinc-400">
              Communiquez cette empreinte complète par un canal de confiance.
              L’expéditeur doit la comparer avant de vous envoyer un fichier.
            </p>
            <code className="mt-3 block break-all rounded-lg bg-zinc-950 p-3 text-xs text-emerald-300">
              {ownFingerprint}
            </code>
            <button
              className={`${buttonClass} mt-3`}
              onClick={() =>
                run(async () => {
                  await navigator.clipboard.writeText(ownFingerprint);
                  setNotice("Empreinte copiée.");
                })
              }
            >
              Copier l’empreinte
            </button>
          </>
        ) : (
          <>
            <p className="my-3 text-sm text-zinc-400">
              Créez votre identité pour recevoir des fichiers. Votre clé privée
              est sauvegardée sous forme chiffrée dans votre coffre.
            </p>
            <button
              disabled={busy || loading}
              className={buttonClass}
              onClick={initialize}
            >
              Activer la réception sécurisée
            </button>
          </>
        )}
      </section>
      <input
        aria-label="Choisir un fichier à chiffrer"
        className="hidden"
        ref={input}
        type="file"
        onChange={upload}
        disabled={busy || loading}
      />
      <button
        className={`${buttonClass} border-emerald-800 bg-emerald-950`}
        disabled={busy || loading}
        onClick={() => input.current.click()}
      >
        {busy ? "Opération en cours…" : "Ajouter un fichier"}
      </button>
      {loading && (
        <p className="text-sm text-zinc-400">
          Chargement et déchiffrement des métadonnées…
        </p>
      )}
      {deleting && (
        <section
          role="alertdialog"
          aria-label="Confirmer la suppression"
          className={panelClass}
        >
          <p className="text-sm">
            Supprimer « {deleting.metadata.name} » et ses partages ?
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await removeFile(deleting.id);
                  if (sharing?.id === deleting.id) setSharing(null);
                  setDeleting(null);
                  await load();
                })
              }
            >
              Supprimer définitivement
            </button>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => setDeleting(null)}
            >
              Annuler
            </button>
          </div>
        </section>
      )}
      {sharing && (
        <section className={`${panelClass} border-emerald-900`}>
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Partager : {sharing.metadata.name}</h2>
            <button
              className={buttonClass}
              disabled={busy}
              onClick={() => setSharing(null)}
            >
              Fermer
            </button>
          </div>
          <form onSubmit={lookup} className="mt-4 flex gap-2">
            <label className="flex-1 text-xs text-zinc-400">
              Adresse du destinataire
              <input
                required
                type="email"
                className={`${inputClass} mt-1`}
                value={email}
                disabled={busy}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setRecipient(null);
                  setExpectedFingerprint("");
                }}
              />
            </label>
            <button className={`${buttonClass} self-end`} disabled={busy}>
              Rechercher
            </button>
          </form>
          <p className="mt-2 text-xs leading-relaxed text-zinc-500">
            Le destinataire doit activer la réception sécurisée dans son propre
            compte avant le partage. Le bouton en haut de cette page active
            seulement votre réception. Pour tester, choisissez l’adresse d’un autre compte.
          </p>
          {recipient && (
            <div className="mt-4 space-y-3 rounded-xl border border-amber-900 bg-amber-950/20 p-4">
              <p className="text-sm">Destinataire : {recipient.email}</p>
              <p className="text-xs text-zinc-400">
                Demandez au destinataire son empreinte depuis son écran « Mes
                fichiers », par un autre canal de confiance. Comparez les 64
                caractères hexadécimaux.
              </p>
              <code className="block break-all text-xs text-amber-200">
                {recipient.fingerprint}
              </code>
              <label className="block text-xs text-zinc-400">
                Empreinte reçue du destinataire
                <input
                  className={`${inputClass} mt-2`}
                  value={expectedFingerprint}
                  disabled={busy}
                  onChange={(e) => setExpectedFingerprint(e.target.value)}
                  placeholder="Collez l’empreinte reçue par le canal de confiance"
                />
              </label>
              <button
                className={buttonClass}
                disabled={busy || !verified}
                onClick={send}
              >
                Chiffrer la clé et partager
              </button>
            </div>
          )}
          <div className="mt-5">
            <h3 className="text-sm text-zinc-400">Accès accordés</h3>
            {!shares.length && (
              <p className="mt-2 text-xs text-zinc-500">
                Aucun destinataire pour ce fichier.
              </p>
            )}
            {shares.map((s) => (
              <div
                key={s.id}
                className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3 text-sm"
              >
                <span>{s.email}</span>
                <button
                  className={buttonClass}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await revokeShare(sharing.id, s.id);
                      setShares(await fetchShares(sharing.id));
                      setNotice(
                        "Accès révoqué pour les prochains téléchargements.",
                      );
                    })
                  }
                >
                  Révoquer l’accès
                </button>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-amber-200/70">
            Une révocation ne peut pas effacer les copies déjà téléchargées par
            le destinataire.
          </p>
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Mes fichiers ({files.owned.length})
        </h2>
        {!loading && !files.owned.length && (
          <p className="text-sm text-zinc-500">
            Ajoutez votre premier fichier chiffré.
          </p>
        )}
        {files.owned.map((item) => card(item, false))}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Reçus ({files.received.length})</h2>
        {!loading && !files.received.length && (
          <p className="text-sm text-zinc-500">Aucun partage reçu.</p>
        )}
        {files.received.map((item) => card(item, true))}
      </section>
    </div>
  );
}
