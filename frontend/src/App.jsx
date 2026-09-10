import { useState } from 'react';
import { SessionProvider, useSession } from './lib/session';
import Register from './pages/Register';
import Login from './pages/Login';
import Vault from './pages/Vault';
import AuthLayout from './components/AuthLayout';

function Router() {
  const { isUnlocked, email, lock } = useSession();
  const [view, setView] = useState('login');

 if (isUnlocked) return <Vault />;

  return (
    <AuthLayout>
      {view === 'login'
        ? <Login />
        : <Register onDone={() => setView('login')} />}

      <p className="text-center">
        <button
          onClick={() => setView(view === 'login' ? 'register' : 'login')}
          className="rounded text-xs text-zinc-500 underline-offset-4 transition-colors duration-150 hover:text-zinc-300 hover:underline focus:outline-none focus:ring-1 focus:ring-zinc-700"
        >
          {view === 'login' ? 'Créer un coffre' : 'J’ai déjà un coffre'}
        </button>
      </p>
    </AuthLayout>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Router />
    </SessionProvider>
  );
}
