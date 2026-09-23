import { useState } from "react";
import { KeyRound, Eye, EyeOff, Lock, ServerOff, ShieldCheck } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useCredentialStatus } from "@/hooks/useMetadata";
import { api, ApiError } from "@/api/client";

export function CredentialsForm() {
  const qc = useQueryClient();
  const toast = useToast();
  const status = useCredentialStatus();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [show, setShow] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.saveCredentials({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
      }),
    onSuccess: () => {
      toast.success("Credentials saved", "They are stored securely on this device.");
      setClientSecret("");
      setClientId("");
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e: Error) => toast.error("Could not save credentials", e.message),
  });

  const test = useMutation({
    mutationFn: () => api.testCredentials(),
    onSuccess: () => toast.success("Connection test passed", "Your Terna credentials work."),
    onError: (e: Error) => {
      const detail = e instanceof ApiError ? e.message : "Test failed";
      toast.error("Connection test failed", detail);
    },
  });

  const del = useMutation({
    mutationFn: () => api.deleteCredentials(),
    onSuccess: () => {
      toast.info("Credentials removed");
      qc.invalidateQueries({ queryKey: ["credentials"] });
    },
    onError: (e: Error) => toast.error("Could not remove credentials", e.message),
  });

  return (
    <section className="card p-6">
      <div className="mb-5 flex items-center gap-3.5">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
          <KeyRound className="h-5 w-5" />
        </span>
        <div>
          <h2 className="font-display text-base font-semibold text-ink-900 dark:text-white">
            Terna Developer credentials
          </h2>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Your <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-xs text-ink-700 dark:bg-white/[0.07] dark:text-ink-200">client_secret</code>{" "}
            stays on this machine.
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200/70 bg-ink-50/60 px-3.5 py-2.5 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <span className="text-sm text-ink-600 dark:text-ink-300">Status:</span>
        {status.isLoading ? (
          <Badge variant="neutral">Checking…</Badge>
        ) : status.isError ? (
          // Un errore del backend non è "non configurato": le chiavi possono
          // esserci, è il servizio locale che non risponde.
          <Badge variant="neutral">
            <ServerOff className="h-3.5 w-3.5" /> Local service unreachable
          </Badge>
        ) : status.data?.configured ? (
          <Badge variant="success">
            <ShieldCheck className="h-3.5 w-3.5" /> Configured
            {status.data.client_id_suffix ? ` (•••${status.data.client_id_suffix})` : ""}
          </Badge>
        ) : (
          <Badge variant="amber">Not configured</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Input
          label="Client ID"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder="your-terna-client-id"
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          label="Client secret"
          type={show ? "text" : "password"}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          placeholder="••••••••••••"
          autoComplete="off"
          spellCheck={false}
          leading={<Lock className="h-4 w-4" />}
          trailing={
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="rounded-lg p-1.5 text-ink-500 transition hover:bg-ink-100 hover:text-ink-700 dark:text-ink-400 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label={show ? "Hide secret" : "Show secret"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          }
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-ink-500 dark:text-ink-400">
        Create your own application at{" "}
        <a
          className="font-medium text-brand-700 hover:underline dark:text-brand-300"
          href="https://developer.terna.it"
          target="_blank"
          rel="noreferrer"
        >
          developer.terna.it
        </a>
        . Credentials are stored securely on this device.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 pt-5 dark:border-white/[0.06]">
        {status.data?.configured && (
          <Button
            variant="danger"
            onClick={() => {
              if (window.confirm("Remove the stored Terna credentials from this device?")) {
                del.mutate();
              }
            }}
            loading={del.isPending}
          >
            Remove
          </Button>
        )}
        <Button variant="outline" onClick={() => test.mutate()} loading={test.isPending} disabled={!status.data?.configured}>
          Test connection
        </Button>
        <Button
          onClick={() => save.mutate()}
          loading={save.isPending}
          disabled={!clientId.trim() || !clientSecret.trim()}
        >
          Save credentials
        </Button>
      </div>
    </section>
  );
}
