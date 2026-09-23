import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

type Theme = "light" | "dark";
interface ThemeContextValue {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const STORAGE_KEY = "terna.theme";

function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — fall back to the OS preference.
  }
  return null;
}

function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStored() ?? systemTheme());
  const [explicit, setExplicit] = useState(() => readStored() !== null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    // `theme.js` scrive `color-scheme` inline prima del primo paint, e uno stile
    // inline vince sulla regola `.dark` del foglio: senza questa riga i widget
    // nativi (menu dei `select`, scrollbar) restavano chiari dopo un cambio di
    // tema a pagina viva.
    root.style.colorScheme = theme === "dark" ? "dark" : "light";
    // La barra del titolo della finestra e del browser seguono il tema scelto:
    // il valore scritto in `index.html` è solo il punto di partenza.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#04130e" : "#f5f7f9");
  }, [theme]);

  useEffect(() => {
    if (explicit) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setThemeState(e.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [explicit]);

  const setTheme = useCallback((t: Theme) => {
    setExplicit(true);
    try {
      localStorage.setItem(STORAGE_KEY, t);
    } catch {
      // ignore persistence errors
    }
    setThemeState(t);
  }, []);

  const toggle = useCallback(
    () => setTheme(theme === "dark" ? "light" : "dark"),
    [theme, setTheme],
  );

  const value = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
