/**
 * Tema applicato prima del primo paint.
 *
 * Deve stare in un file separato e non inline in `index.html`: la CSP dell'app
 * è `script-src 'self'`, quindi uno script inline viene bloccato dal browser.
 * Stessa chiave e stessa logica di `src/context/ThemeContext.tsx`.
 */
(function () {
  try {
    var stored = localStorage.getItem("terna.theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (error) {
    /* localStorage non disponibile: resta il tema chiaro */
  }
})();
