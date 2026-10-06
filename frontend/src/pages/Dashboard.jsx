import { useEffect, useState } from "react";
import { fetchDashboard } from "../lib/api";
import { useSession } from "../lib/session";
import MfaSetup from "../components/MfaSetup";
import { Stat, Activity, ErrorNotice } from "../components/DashboardUI";
import { bytesLabel, dateLabel, panelClass, buttonClass } from "../lib/display";

export default function Dashboard({ navigate }) {
  const { profile } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetchDashboard()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [profile?.mfa_enabled]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-emerald-400">MON ESPACE</p>
        <h1 className="mt-2 text-3xl font-semibold">Tableau de bord</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Votre sécurité, vos fichiers et les dernières opérations de votre
          compte.
        </p>
      </div>
      <ErrorNotice>{error}</ErrorNotice>
      {!data && !error && <p>Chargement…</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Secrets" value={data.secrets} />
            <Stat label="Fichiers" value={data.files} />
            <Stat label="Partages envoyés" value={data.sent_shares} />
            <Stat label="Partages reçus" value={data.received_shares} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <section className={panelClass}>
              <h2 className="font-medium">Stockage chiffré</h2>
              <p className="mt-3 text-sm text-zinc-400">
                {bytesLabel(data.storage_bytes)} /{" "}
                {bytesLabel(data.quota_bytes)}
              </p>
              <progress
                aria-label="Stockage utilisé"
                max={data.quota_bytes}
                value={data.storage_bytes}
                className="mt-3 w-full accent-emerald-500"
              />
              <button
                onClick={() => navigate("files")}
                className={`${buttonClass} mt-4`}
              >
                Ouvrir mes fichiers
              </button>
            </section>
            <section className={panelClass}>
              <h2 className="font-medium">Protection du compte</h2>
              <p className="mt-3 text-sm">
                MFA :{" "}
                <span
                  className={
                    profile.mfa_enabled ? "text-emerald-400" : "text-amber-400"
                  }
                >
                  {profile.mfa_enabled ? "activé" : "à activer"}
                </span>
              </p>
              <p className="mt-3 text-xs text-zinc-400">
                Dernière connexion : {dateLabel(data.last_login_at)}
              </p>
              <p className="mt-2 text-xs text-zinc-400">
                Compte créé le {dateLabel(profile.created_at)}
              </p>
            </section>
          </div>
          <div className={panelClass}>
            <MfaSetup />
          </div>
          <section className={panelClass}>
            <h2 className="mb-3 font-medium">Activité récente</h2>
            <Activity events={data.activity} />
            <p className="mt-3 text-xs text-zinc-500">
              Les 30 dernières opérations serveur. Les consultations hors ligne
              ne sont pas enregistrées.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
