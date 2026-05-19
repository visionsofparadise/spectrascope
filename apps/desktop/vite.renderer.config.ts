import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    'process.platform': JSON.stringify(process.platform),
    'process.arch': JSON.stringify(process.arch),
  },
  optimizeDeps: {
    // @spectrascope/design-system is a workspace package actively edited
    // during development; excluding it from pre-bundling means fresh builds
    // are picked up without restarting the dev server.
    exclude: ["@spectrascope/design-system"],
  },
});
