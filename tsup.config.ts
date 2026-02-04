import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  splitting: false,
  treeshake: true,
  // Keep node_modules external — bundling Telegraf breaks its long-polling internals
  external: [
    'telegraf',
    'axios',
    'pg',
    'cockatiel',
    'winston',
    'zod',
    'dotenv',
  ],
});
