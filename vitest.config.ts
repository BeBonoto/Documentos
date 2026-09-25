import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Valores fictícios para que src/config/env.ts valide nos testes.
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      WEBHOOK_TOKEN: 'test-token-1234567890',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://invalid:invalid@127.0.0.1:1/invalid',
      EVOLUTION_API_URL: 'http://evolution.test',
      EVOLUTION_API_KEY: 'test',
      EVOLUTION_INSTANCE: 'test',
      OPENAI_API_KEY: 'sk-test',
      FILE_URL_SECRET: 'file-secret-1234567890',
      LOCAL_STORAGE_DIR: './data/test-uploads',
    },
  },
});
