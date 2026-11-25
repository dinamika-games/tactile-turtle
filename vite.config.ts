/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  // Relative paths, so that the build works from any sub-path (e.g. GitHub Pages).
  base: "./",
  worker: { format: "es" },
  test: {
    include: ["tests/*.test.ts"],
    testTimeout: 120_000,
  },
});
