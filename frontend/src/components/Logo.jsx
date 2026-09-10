import { Lock } from 'lucide-react';

// Identité du produit, réutilisée à l'identique sur les écrans
// d'authentification et dans l'en-tête du coffre.
export default function Logo({ className = '' }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950/50 text-emerald-400">
        <Lock size={16} />
      </span>
      <span className="text-base font-semibold tracking-tight text-zinc-100">Coffre</span>
    </div>
  );
}
