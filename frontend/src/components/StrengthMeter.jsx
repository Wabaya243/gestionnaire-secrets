import { useEffect, useMemo } from 'react';
import zxcvbn from 'zxcvbn';


const LABELS = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];

// La couleur suit le seuil d'acceptation (MIN_SCORE = 3) plutôt qu'un
// dégradé décoratif : rouge tant que le mot de passe serait refusé,
// emerald dès qu'il passe. Classes écrites en entier, sinon Tailwind
// ne les voit pas au moment où il scanne les sources.
const BARS = [
  'w-1/5 bg-red-600',
  'w-2/5 bg-red-500',
  'w-3/5 bg-red-400',
  'w-4/5 bg-emerald-600',
  'w-full bg-emerald-500',
];
const TEXTS = [
  'text-red-400',
  'text-red-400',
  'text-red-300',
  'text-emerald-400',
  'text-emerald-400',
];

export default function StrengthMeter({ password, onScore }) {
  // useMemo : zxcvbn est coûteux, on ne recalcule que si le mot de passe change.
  const result = useMemo(
    () => (password ? zxcvbn(password) : null),
    [password],
  );

  // useEffect : remonte le score APRÈS le rendu, jamais pendant.
  // C'est ce qui corrige l'avertissement React.
  useEffect(() => {
    onScore?.(result ? result.score : 0);
  }, [result, onScore]);

  if (!result) return null;

  return (
    <div className="mt-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full transition-all duration-200 ${BARS[result.score]}`} />
      </div>

      <small className={`mt-1.5 block text-xs ${TEXTS[result.score]}`}>
        {LABELS[result.score]}
      </small>

      {result.feedback.warning && (
        <div>
          <small className="text-xs text-zinc-400">{result.feedback.warning}</small>
        </div>
      )}
    </div>
  );
}
