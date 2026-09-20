import { useNavigate } from "react-router-dom";
import { ArrowRight, KeyRound, RefreshCw, LayoutDashboard, ChevronRight } from "lucide-react";
import { CredentialsForm } from "@/components/credentials/CredentialsForm";
import { Button } from "@/components/ui/Button";
import { BrandMark } from "@/components/ui/BrandMark";
import { useCredentialStatus } from "@/hooks/useMetadata";
import { ONBOARDING_KEY } from "@/lib/constants";

const STEPS = [
  {
    icon: KeyRound,
    title: "Add credentials",
    text: "Enter your free Terna Developer keys once — they never leave this device.",
  },
  {
    icon: RefreshCw,
    title: "Sync data",
    text: "Choose a year range and let the app download every dataset from Terna.",
  },
  {
    icon: LayoutDashboard,
    title: "Explore",
    text: "Filter, compare sources, regions and provinces, and export beautiful charts.",
  },
];

export function OnboardingPage() {
  const navigate = useNavigate();
  const status = useCredentialStatus();
  const configured = status.data?.configured;

  const finish = () => {
    localStorage.setItem(ONBOARDING_KEY, "1");
    navigate("/dashboard");
  };

  return (
    <div className="app-bg min-h-full">
      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-8 py-12 lg:grid-cols-[1fr_1.15fr]">
        {/* Hero panel */}
        <div className="relative overflow-hidden rounded-3xl bg-forest-950 p-9 shadow-pop">
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div className="absolute -top-24 right-0 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" />
            <div className="absolute -bottom-28 -left-10 h-64 w-64 rounded-full bg-brand-700/25 blur-3xl" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>

          <div className="relative">
            <div className="animate-float-slow">
              <BrandMark className="h-14 w-14 rounded-2xl shadow-glow" />
            </div>
            <h1 className="mt-7 font-display text-[28px] font-semibold leading-tight tracking-tight text-white">
              Welcome to{" "}
              <span className="bg-gradient-to-r from-brand-300 to-emerald-200 bg-clip-text text-transparent">
                Italian Installed Power Plants Explorer
              </span>
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-300">
              A local desktop app to explore Italy&apos;s installed renewable generation capacity — region by
              region, source by source.
            </p>

            <div className="mt-9 space-y-1">
              {STEPS.map((s, i) => (
                <div key={s.title} className="group flex items-start gap-4 rounded-2xl p-3 transition hover:bg-white/[0.04]">
                  <div className="relative flex flex-col items-center">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-brand-400/25 bg-brand-500/15 text-brand-300">
                      <s.icon className="h-5 w-5" />
                    </span>
                    {i < STEPS.length - 1 && (
                      <span className="absolute top-11 h-[calc(100%-1rem)] w-px bg-gradient-to-b from-brand-400/40 to-transparent" />
                    )}
                  </div>
                  <div className="pt-0.5">
                    <p className="text-sm font-semibold text-white">
                      <span className="mr-2 font-mono text-xs text-brand-400/80">0{i + 1}</span>
                      {s.title}
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-400">{s.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-8 border-t border-white/[0.06] pt-5 text-xs text-ink-500">
              Data provided by the{" "}
              <a
                className="font-medium text-brand-300 hover:underline"
                href="https://developer.terna.it"
                target="_blank"
                rel="noreferrer"
              >
                Terna Developer
              </a>{" "}
              open API. Everything runs locally on your machine.
            </p>
          </div>
        </div>

        {/* Form column */}
        <div className="animate-fade-in-slow">
          <div className="mb-5">
            <h2 className="font-display text-lg font-semibold text-ink-900 dark:text-white">
              First, your credentials
            </h2>
            <p className="mt-1 text-sm text-ink-500 dark:text-ink-400">
              Create a free application at{" "}
              <a
                className="font-medium text-brand-700 hover:underline dark:text-brand-300"
                href="https://developer.terna.it"
                target="_blank"
                rel="noreferrer"
              >
                developer.terna.it
              </a>{" "}
              and paste the keys below.
            </p>
          </div>

          <CredentialsForm />

          <div className="mt-6 flex items-center justify-end gap-3">
            <Button disabled={!configured} onClick={finish} size="lg">
              Enter the dashboard <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-3 flex items-center justify-end gap-1.5 text-xs text-ink-400">
            You can change credentials anytime <ArrowRight className="h-3 w-3" /> Settings
          </p>
        </div>
      </div>
    </div>
  );
}
