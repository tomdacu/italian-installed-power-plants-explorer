import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { KeyRound, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useCredentialStatus } from "@/hooks/useMetadata";
import { Button } from "@/components/ui/Button";

function CredentialsBanner() {
  const status = useCredentialStatus();
  const [dismissed, setDismissed] = useState(false);

  if (status.isLoading || status.data?.configured || dismissed) return null;

  return (
    <div className="relative z-30 flex items-center gap-3 border-b border-brand-500/20 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-transparent px-6 py-2.5 backdrop-blur dark:border-brand-400/15">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-500/15 text-brand-600 dark:text-brand-300">
        <KeyRound className="h-3.5 w-3.5" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-ink-700 dark:text-ink-200">
        <span className="font-semibold">No Terna credentials yet.</span>{" "}
        <span className="text-ink-500 dark:text-ink-400">
          Add your free developer keys to start downloading data.
        </span>
      </p>
      <Link to="/credentials" className="shrink-0">
        <Button variant="primary" size="sm">
          Add credentials
        </Button>
      </Link>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-white"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function Shell() {
  return (
    <div className="app-bg flex h-full w-full overflow-hidden">
      <Sidebar />
      <main className="flex h-full min-w-0 flex-1 flex-col">
        <CredentialsBanner />
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
