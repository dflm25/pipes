import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  root: "client",
  plugins: [react(), tailwind()],
  build: { outDir: "../dist/client", emptyOutDir: true },
  server: { proxy: { "/api": "http://127.0.0.1:3400" } },
});
