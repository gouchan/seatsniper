import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/config/**'],
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
  resolve: {
    alias: {
      '@adapters': resolve(__dirname, 'src/adapters'),
      '@services': resolve(__dirname, 'src/services'),
      '@data': resolve(__dirname, 'src/data'),
      '@notifications': resolve(__dirname, 'src/notifications'),
      '@config': resolve(__dirname, 'src/config'),
      '@utils': resolve(__dirname, 'src/utils'),
      '@venues': resolve(__dirname, 'src/venues'),
    },
  },
});
