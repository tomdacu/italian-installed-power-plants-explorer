/**
 * Tema applicato prima del primo paint.
 *
 * Deve stare in un file separato e non inline in `index.html`: la CSP dell'app
 * è `script-src 'self'`, quindi uno script inline viene bloccato dal browser.
 * Stessa chiave e stessa logica di `src/context/ThemeContext.tsx`.
 */
(function () {
  /** Gli stessi due valori di `ThemeContext.tsx`: se cambiano là, cambiano qui. */
  var THEME_COLORS = { dark: "#04130e", light: "#f5f7f9" };
  var dark = true;
  try {
    var stored = localStorage.getItem("terna.theme");
    // Stessa regola di `readStored` in `ThemeContext.tsx`: solo `light` e `dark`
    // sono valori riconosciuti, qualunque altro (anche `"Dark"`, o una stringa
    // scritta da una versione precedente) vale come "nessuna scelta" e lascia
    // decidere la preferenza di sistema. Il confronto secco `stored === "dark"`
    // faceva divergere i due: il pre-paint dipingeva chiaro e il context, al
    // mount, passava a scuro — un lampo visibile.
    dark =
      stored === "light"
        ? false
        : stored === "dark"
          ? true
          : !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  } catch (error) {
    /* localStorage non disponibile: resta il tema chiaro */
  }

  // Anche il colore della barra della finestra segue il tema **prima** del primo
  // paint. Il valore scritto in `index.html` è quello scuro, e il context lo
  // corregge solo dopo il mount: in tema chiaro la finestra restava scura per
  // tutto il tempo di caricamento del bundle.
  var color = dark ? THEME_COLORS.dark : THEME_COLORS.light;

  function applyColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return false;
    if (meta.getAttribute("content") !== color) meta.setAttribute("content", color);
    return true;
  }

  if (!applyColor()) {
    // Lo script può essere spostato prima del `<meta>`: si aspetta che il parser
    // lo crei e poi ci si scollega. Dopo il mount è il context a comandare, e un
    // osservatore ancora attivo riporterebbe indietro il tema al primo toggle.
    var observer = new MutationObserver(function () {
      if (applyColor()) observer.disconnect();
    });
    observer.observe(document.head || document.documentElement, { childList: true, subtree: true });
  }
})();
