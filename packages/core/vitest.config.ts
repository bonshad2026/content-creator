import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/globalSetup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://cc:cc@localhost:5433/content_creator_test",
      STORAGE_DIR: "storage-test",
    },
  },
});
