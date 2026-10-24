import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // The `server-only` guard throws when imported outside a server bundle.
      // Point it at the package's own empty module so server modules can be
      // imported in unit tests without tripping the client-import guard.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // node_modules are externalized by default, which bypasses the alias above.
    // Inline `server-only` so the alias is applied during test resolution.
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
});
