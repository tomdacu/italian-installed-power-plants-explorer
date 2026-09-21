import { KeyRound, ShieldCheck, Globe2, Laptop2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { CredentialsForm } from "@/components/credentials/CredentialsForm";

const FACTS = [
  {
    icon: Globe2,
    title: "Where to get keys",
    text: "Register a free application at developer.terna.it and copy the Client ID and Client secret.",
  },
  {
    icon: Laptop2,
    title: "Stored on this device only",
    text: "Credentials are kept in the encrypted local secret store (DPAPI on Windows, Keychain on macOS, secret-tool on Linux) — they are never sent anywhere except Terna's API.",
  },
  {
    icon: ShieldCheck,
    title: "Revocable anytime",
    text: "Remove the keys from this app (or revoke them on the Terna portal) at any moment.",
  },
];

export function CredentialsPage() {
  return (
    <div>
      <Topbar title="Credentials" subtitle="Manage your Terna Developer credentials" />
      <div className="mx-auto grid max-w-5xl animate-fade-in grid-cols-1 gap-6 p-6 pt-4 lg:grid-cols-[1.25fr_1fr]">
        <CredentialsForm />
        <aside className="space-y-3">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <KeyRound className="h-4 w-4" />
            </span>
            <h2 className="font-display text-sm font-semibold text-ink-900 dark:text-white">
              How credentials work
            </h2>
          </div>
          {FACTS.map((f) => (
            <div key={f.title} className="card card-hover flex items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500 dark:bg-white/[0.05] dark:text-ink-300">
                <f.icon className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-800 dark:text-ink-100">{f.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{f.text}</p>
              </div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
