import { useEffect, useMemo } from 'react';
import zxcvbn from 'zxcvbn';

const LABELS = ['Très faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];
const COLORS = ['#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085'];

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
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 6, background: '#eee', borderRadius: 3 }}>
        <div style={{
          width: `${(result.score + 1) * 20}%`,
          height: '100%',
          background: COLORS[result.score],
          borderRadius: 3,
          transition: 'width .2s',
        }} />
      </div>
      <small style={{ color: COLORS[result.score] }}>{LABELS[result.score]}</small>
      {result.feedback.warning && (
        <div><small>{result.feedback.warning}</small></div>
      )}
    </div>
  );
}