import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastVariant = "success" | "error" | "info" | "warning";

interface Toast {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastContextValue {
  show: (t: Omit<Toast, "id">) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 4;
const AUTO_DISMISS_MS = 5200;

const ICONS: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-brand-500" />,
  error: <XCircle className="h-5 w-5 text-rose-500" />,
  info: <Info className="h-5 w-5 text-sky-500" />,
  warning: <TriangleAlert className="h-5 w-5 text-amber-500" />,
};

const ACCENT: Record<ToastVariant, string> = {
  success: "bg-brand-500",
  error: "bg-rose-500",
  info: "bg-sky-500",
  warning: "bg-amber-500",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, number>());

  const remove = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((list) => [...list.slice(-MAX_TOASTS + 1), { ...t, id }]);
      timers.current.set(
        id,
        window.setTimeout(() => remove(id), AUTO_DISMISS_MS),
      );
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (title, description) => show({ title, description, variant: "success" }),
      error: (title, description) => show({ title, description, variant: "error" }),
      info: (title, description) => show({ title, description, variant: "info" }),
      warning: (title, description) => show({ title, description, variant: "warning" }),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2.5 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-md items-stretch overflow-hidden rounded-2xl border border-ink-200/80 bg-white/95 shadow-pop backdrop-blur-xl animate-fade-in dark:border-white/10 dark:bg-ink-900/95"
          >
            <span className={cn("w-1 shrink-0", ACCENT[t.variant])} />
            <div className="mt-0.5 flex shrink-0 items-start gap-0 pl-3.5 pt-3.5">{ICONS[t.variant]}</div>
            <div className="min-w-0 flex-1 px-2.5 py-3">
              <p className="text-sm font-semibold text-ink-900 dark:text-white">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-sm leading-snug text-ink-500 dark:text-ink-400">{t.description}</p>
              )}
            </div>
            <button
              onClick={() => remove(t.id)}
              className="m-2 self-start rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
