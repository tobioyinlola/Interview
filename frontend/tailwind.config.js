/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // The brand palette: 50% canvas, 25% white, 20% ink, 5% accent.
        canvas: "#F7F4FF",
        surface: "#FFFFFF",
        ink: "#1C1B2E",
        accent: { DEFAULT: "#7B47F3", dark: "#6A38DD", soft: "#EFE8FF" },
        // Secondary text and hairlines, derived from the ink so the palette stays one family.
        muted: "#5E5C75",
        // The back office: a cool grey backdrop with white panels floating on it.
        shell: "#EDECF3",
        panel: "#F4F3F9",
        line: "#E6E1F5",
        "line-strong": "#D3CAEB",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderColor: { DEFAULT: "#E6E1F5" },
      boxShadow: {
        card: "0 1px 2px rgba(28,27,46,.04), 0 8px 24px rgba(28,27,46,.06)",
        lift: "0 2px 4px rgba(28,27,46,.06), 0 18px 40px rgba(28,27,46,.12)",
      },
    },
  },
  plugins: [],
};
