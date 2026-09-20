import { Moon, Sun, BookOpen, KeyRound, RefreshCw, LayoutDashboard, Info, Database, ShieldCheck, MonitorSmartphone, CheckCircle2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/context/ThemeContext";
import { usePwaInstall } from "@/hooks/usePwaInstall";
import { APP_VERSION } from "@/lib/version";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: KeyRound,
    title: "Add your credentials",
    text: "Create a free application at developer.terna.it, then paste your Client ID and secret on the Credentials page. They stay on this device.",
  },
  {
    icon: RefreshCw,
    title: "Sync the data",
    text: "On the Data sync page choose the years and start the download: every dataset, source and capacity type is fetched automatically. The first sync may take a few minutes.",
  },
  {
    icon: LayoutDashboard,
    title: "Explore the dashboard",
    text: "Filter by region, source and capacity type. Every chart can be copied or saved as an image for your reports.",
  },
];

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const install = usePwaInstall();

  return (
    <div>
      <Topbar title="Settings" subtitle="Personalise the app and learn how to get started" />
      <div className="mx-auto max-w-3xl animate-fade-in space-y-4 p-6 pt-4">
        <section className="card p-5">
          <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">Appearance</h3>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">Switch between light and dark themes.</p>
          <div className="mt-4 inline-flex rounded-xl border border-ink-200 bg-ink-50 p-1 dark:border-white/10 dark:bg-white/[0.04]">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                aria-pressed={theme === opt.value}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all",
                  theme === opt.value
                    ? "bg-white text-ink-900 shadow-card dark:bg-white/[0.10] dark:text-white"
                    : "text-ink-500 hover:text-ink-800 dark:text-ink-400 dark:hover:text-ink-100",
                )}
              >
                <opt.icon className="h-4 w-4" /> {opt.label}
              </button>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">Getting started</h3>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
                Three steps to explore Italy&apos;s installed renewable capacity.
              </p>
            </div>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <BookOpen className="h-4 w-4" />
            </span>
          </div>
          <div className="mt-5 space-y-5">
            {STEPS.map((s, i) => (
              <div key={s.title} className="flex items-start gap-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-500 dark:bg-white/[0.05] dark:text-ink-300">
                  <s.icon className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink-900 dark:text-ink-100">
                    <span className="mr-2 font-mono text-xs text-brand-600 dark:text-brand-400">0{i + 1}</span>
                    {s.title}
                  </p>
                  <p className="mt-0.5 text-sm leading-relaxed text-ink-500 dark:text-ink-400">{s.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">
                Install as an app
              </h3>
              <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
                Use it in its own window, without browser tabs, with an entry in the Start menu.
              </p>
            </div>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-600 dark:text-brand-300">
              <MonitorSmartphone className="h-4 w-4" />
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {install.installed ? (
              <p className="flex items-center gap-2 text-sm text-brand-700 dark:text-brand-300">
                <CheckCircle2 className="h-4 w-4" /> Running as an installed app
              </p>
            ) : install.canInstall ? (
              <Button onClick={() => void install.install()}>Install as app</Button>
            ) : (
              <p className="text-sm leading-relaxed text-ink-500 dark:text-ink-400">
                Open this page from the address shown by <code className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-xs dark:bg-white/[0.07]">ice</code>{" "}
                (for example <span className="font-mono text-xs">http://127.0.0.1:8731</span>), then use your
                browser&apos;s menu → <em>Install app</em>. Chromium-based browsers only.
              </p>
            )}
          </div>
        </section>

        <section className="card p-5">
          <h3 className="font-display text-sm font-semibold text-ink-900 dark:text-white">About</h3>
          <div className="mt-4 space-y-3.5 text-sm leading-relaxed text-ink-600 dark:text-ink-300">
            <p className="flex items-start gap-2.5">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <span>
                Italian Renewable Capacity Explorer lets you explore <em>installed generation capacity</em> across Italy&apos;s
                regions and provinces — aggregated by the Terna Developer API and stored locally on your machine.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <Database className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <span>
                Data is provided by{" "}
                <a
                  className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                  href="https://developer.terna.it"
                  target="_blank"
                  rel="noreferrer"
                >
                  Terna Developer
                </a>
                . You need your own free credentials to download records.
              </span>
            </p>
            <p className="flex items-start gap-2.5">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" />
              <span>
                Your credentials and data never leave this computer — the app talks only to Terna&apos;s API and its
                local data service.
              </span>
            </p>
          </div>
          <div className="mt-5 flex items-center justify-between border-t border-ink-100 pt-4 dark:border-white/[0.06]">
            <p className="font-mono text-xs text-ink-400">Version {APP_VERSION}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open("https://developer.terna.it", "_blank", "noopener")}
            >
              Visit developer.terna.it
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
