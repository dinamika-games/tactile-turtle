import { defineConfig } from "vitest/config";

// The slow end-to-end tests of every level through the virtual webcam.
export default defineConfig({
  test: {
    include: ["tests/webcam/*.test.ts"],
    testTimeout: 600_000,
  },
});
