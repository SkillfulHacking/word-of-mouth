import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Build output and local-only folders can hold copies of test files; they are not ours to run.
    exclude: [...configDefaults.exclude, ".next/**", "docs/**", "session-upload/**"],
  },
});
