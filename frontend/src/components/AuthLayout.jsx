import { EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import Logo from './Logo';

const ARGUMENTS = [
  {
    icon: KeyRound,
    title: 'Chiffrement Argon2id + AES-GCM',
    text: 'La clé est dérivée de votre mot de passe maître et ne sort jamais du navigateur.',
  },
  {
    icon: EyeOff,
    title: 'Le serveur ne voit jamais vos secrets',
    text: 'Il ne stocke que des blocs chiffrés qu’il est incapable de déchiffrer.',
  },
  {
    icon: ShieldCheck,
    title: 'Double authentification TOTP',
    text: 'Un second facteur compatible Google Authenticator ou Aegis.',
  },
];

// Coquille commune aux écrans de connexion et d'inscription :
// formulaire à gauche, argumentaire à droite sur grand écran,
// une seule colonne en dessous de lg.
export default function AuthLayout({ children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-md space-y-8">
          <Logo />
          {children}
        </div>
      </div>

      {/* Panneau décoratif : masqué sur mobile, où il repousserait
          le formulaire hors de l'écran sans rien apporter. */}
      <div className="relative hidden overflow-hidden border-l border-zinc-800 bg-linear-to-br from-emerald-950 via-zinc-950 to-zinc-950 lg:flex lg:flex-col lg:justify-center">
        {/* Halos flous : le dégradé seul reste plat, ces taches
            lui donnent la profondeur diffuse des fonds Proton. */}
        <div className="pointer-events-none absolute -top-32 -left-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="pointer-events-none absolute top-1/3 -right-32 h-112 w-112 rounded-full bg-teal-400/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 left-1/4 h-96 w-96 rounded-full bg-emerald-700/20 blur-3xl" />

        <div className="relative space-y-10 px-12 xl:px-16">
          <div className="space-y-3">
            <h2 className="text-3xl font-semibold tracking-tight text-zinc-100">Coffre</h2>
            <p className="text-sm text-zinc-400">
              Vos secrets, chiffrés sur votre appareil avant d’être stockés.
            </p>
          </div>

          <ul className="space-y-6">
            {ARGUMENTS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-800/60 bg-emerald-950/50 text-emerald-400">
                  <Icon size={16} />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-100">{title}</p>
                  <p className="text-xs leading-relaxed text-zinc-400">{text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
