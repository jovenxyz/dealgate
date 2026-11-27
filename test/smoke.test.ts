import { describe, expect, it } from "vitest";

// Checks that TypeScript, ES modules and the test runner are wired up correctly.
describe("package entry point", () => {
  it("loads", async () => {
    await expect(import("../src/index.js")).resolves.toBeDefined();
  });
});
