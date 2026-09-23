/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#edfcf5",
          100: "#d3f9e7",
          300: "#71e2b5",
          400: "#38cc96",
          500: "#14b07f",
          600: "#0a8f66",
          700: "#097153",
          800: "#0a5a43",
        },
        ink: {
          50: "#f5f7f9",
          100: "#eaeef2",
          200: "#d3dae3",
          300: "#adb9c9",
          400: "#8294ab",
          500: "#637691",
          600: "#4f5d77",
          700: "#414c61",
          800: "#232c3b",
          900: "#161d29",
          950: "#0d1118",
        },
        // Deep evergreen tones for the always-dark app rail & hero surfaces.
        forest: {
          950: "#04130e",
        },
      },
      fontFamily: {
        sans: [
          "'Inter Variable'",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "'Sora Variable'",
          "'Sora'",
          "'Inter Variable'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: [
          "'JetBrains Mono Variable'",
          "'JetBrains Mono'",
          "ui-monospace",
          "SFMono-Regular",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(9,17,14,.05), 0 2px 6px -1px rgba(9,17,14,.08)",
        soft: "0 12px 32px -12px rgba(9,17,14,.22)",
        pop: "0 24px 60px -16px rgba(9,17,14,.35)",
        glow: "0 0 0 1px rgba(20,176,127,.28), 0 8px 28px -8px rgba(20,176,127,.45)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-slow": {
          "0%": { opacity: "0", transform: "translateY(14px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 220ms ease-out both",
        "fade-in-slow": "fade-in-slow 480ms cubic-bezier(.21,.65,.36,1) both",
        "float-slow": "float-slow 7s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
