import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { KeyRound, ServerOff, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useCredentialStatus } from "@/hooks/useMetadata";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

function CredentialsBanner() {
  const status = useCredentialStatus();
  const [dismissed, setDismissed] = useState(false);

  if (status.isLoading || status.data?.configured || dismissed) return null;

  // Un errore del backend non significa "credenziali assenti" (stessa regola di
  // App.tsx): il servizio locale non risponde, e il banner lo dice invece di
  // invitare a inserire chiavi che potrebbero già esserci.
  const offline = status.isError;

  return (
    <div
      className={cn(
        "relative z-30 flex items-center gap-3 border-b px-6 py-2.5 backdrop-blur",
        offline
          ? "border-ink-200/70 bg-ink-50/80 dark:border-white/[0.08] dark:bg-white/[0.03]"
          : "border-brand-500/20 bg-gradient-to-r from-brand-500/10 via-brand-500/5 to-transparent dark:border-brand-400/15",
      )}
    >
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
          offline
            ? "bg-ink-200/70 text-ink-600 dark:bg-white/[0.06] dark:text-ink-300"
            : "bg-brand-500/15 text-brand-600 dark:text-brand-300",
        )}
      >
        {offline ? <ServerOff className="h-3.5 w-3.5" /> : <KeyRound className="h-3.5 w-3.5" />}
      </span>
      <p className="min-w-0 flex-1 truncate text-sm text-ink-700 dark:text-ink-200">
        {offline ? (
          <>
            <span className="font-semibold">Local service unreachable.</span>{" "}
            <span className="text-ink-600 dark:text-ink-400">
              Could not check your Terna credentials — the local service is not responding.
            </span>
          </>
        ) : (
          <>
            <span className="font-semibold">No Terna credentials yet.</span>{" "}
            <span className="text-ink-500 dark:text-ink-400">
              Add your free developer keys to start downloading data.
            </span>
          </>
        )}
      </p>
      {offline ? (
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => void status.refetch()}>
          Retry
        </Button>
      ) : (
        <Link to="/credentials" className="shrink-0">
          <Button variant="primary" size="sm">
            Add credentials
          </Button>
        </Link>
      )}
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-white"
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
