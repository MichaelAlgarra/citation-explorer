import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves a project site from https://<user>.github.io/<repo>/,
// so assets must be requested under that subpath. Set via env in CI (see the
// deploy workflow); defaults to "/" for local dev.
const base = process.env.VITE_BASE || "/";

// The frontend now calls the OpenAlex API directly (see src/api.js), so no
// dev proxy is needed.
export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5199,
  },
});
