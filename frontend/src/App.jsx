import { useState } from 'react';
import Register from './pages/register';

export default function App() {
  const [done, setDone] = useState(false);

  if (done) return <h2 style={{ textAlign: 'center' }}>Coffre créé</h2>;

  return <Register onDone={() => setDone(true)} />;
}