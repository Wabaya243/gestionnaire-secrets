import { useState } from "react";
import { SessionProvider, useSession } from "./lib/session";
import Register from "./pages/Register";
import Login from "./pages/Login";
import Vault from "./pages/Vault";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";
import Files from "./pages/Files";
import Logo from "./components/Logo";
import {
  LayoutDashboard,
  KeyRound,
  FileLock2,
  Shield,
  Lock,
} from "lucide-react";
import { buttonClass } from "./lib/display";
import AuthLayout from "./components/AuthLayout";

function Router() {
  const { isUnlocked } = useSession();
  const [view, setView] = useState("login");

  if (isUnlocked) return <Workspace />;

  return (
    <AuthLayout>
      {view === "login" ? (
        <Login />
      ) : (
        <Register onDone={() => setView("login")} />
      )}

      <p className="text-center">
        <button
          onClick={() => setView(view === "login" ? "register" : "login")}
          className="rounded text-xs text-zinc-500 underline-offset-4 transition-colors duration-150 hover:text-zinc-300 hover:underline focus:outline-none focus:ring-1 focus:ring-zinc-700"
        >
          {view === "login" ? "Créer un coffre" : "J’ai déjà un coffre"}
        </button>
      </p>
    </AuthLayout>
  );
}

function Workspace() {
  const { profile, email, lock } = useSession();
  const [view, setView] = useState("dashboard");
  const tabs = [
    ["dashboard", "Tableau de bord", LayoutDashboard],
    ["vault", "Secrets", KeyRound],
    ["files", "Fichiers", FileLock2],
  ];
  if (profile?.is_admin) tabs.push(["admin", "Administration", Shield]);
  return (
    <div className="min-h-screen bg-linear-to-br from-emerald-950/40 via-zinc-950 to-zinc-950">
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
          <Logo />
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate text-xs text-zinc-400">{email}</span>
            <button className={buttonClass} onClick={lock}>
              <Lock size={15} />
              Verrouiller
            </button>
          </div>
        </div>
        <nav
          aria-label="Navigation du coffre"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3"
        >
          {tabs.map(([id, label, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              aria-current={view === id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm ${view === id ? "bg-emerald-950 text-emerald-300" : "text-zinc-400 hover:bg-zinc-900"}`}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {view === "dashboard" && <Dashboard navigate={setView} />}
        {view === "vault" && <Vault embedded />}
        {view === "files" && <Files />}
        {view === "admin" && profile?.is_admin && <Admin navigate={setView} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Router />
    </SessionProvider>
  );
}
