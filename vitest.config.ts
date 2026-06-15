import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure-logic tests run in node; store tests opt into jsdom with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
