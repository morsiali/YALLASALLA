import { defineConfig } from 'vitest/config';

const base = process.env.TEST_PG_BASE ?? 'localhost:54329';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 120000,
    fileParallelism: false,
    globalSetup: ['test/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: `postgres://yalasala_owner:owner_dev_pw@${base}/yalasala_test`,
      APP_DATABASE_URL: `postgres://yalasala_app:app_dev_pw@${base}/yalasala_test`,
      SERVICE_DATABASE_URL: `postgres://yalasala_service:service_dev_pw@${base}/yalasala_test`,
      STORAGE_DIR: './storage-test',
    },
  },
});
