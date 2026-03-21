import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        night: "#12031E",
        cobalt: "#6E82FF",
        cyan: "#7AF7FF",
        coral: "#FF5EC9",
        gold: "#FFD37B",
        mint: "#8EFFD1",
        ink: "#FFF6F4",
        peach: "#FFB6E3",
        sunset: "#FF8AD8",
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(255,255,255,0.14), 0 0 34px rgba(122,247,255,0.14), 0 26px 90px rgba(8, 3, 22, 0.52)",
      },
      backgroundImage: {
        grid: "linear-gradient(rgba(122,247,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(122,247,255,0.1) 1px, transparent 1px)",
      },
      fontFamily: {
        sans: ["var(--font-space-grotesk)", "sans-serif"],
        display: ["var(--font-orbitron)", "sans-serif"],
        mono: ["var(--font-vt323)", "monospace"],
      },
      animation: {
        float: "float 12s ease-in-out infinite",
        pulseSlow: "pulseSlow 6s ease-in-out infinite",
      },
      keyframes: {
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-18px)" },
        },
        pulseSlow: {
          "0%, 100%": { opacity: "0.45" },
          "50%": { opacity: "0.95" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
