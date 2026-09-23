// Vite inlines __APP_VERSION__ from package.json at build time
// (see `define` in vite.config.ts; type comes from src/vite-env.d.ts).
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : `dev`;
