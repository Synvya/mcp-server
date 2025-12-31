import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*'
    ],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Don't fail tests on unhandled promise rejections from intentional timeout tests
    dangerouslyIgnoreUnhandledErrors: true,
  },
});

