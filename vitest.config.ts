import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/._*"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
