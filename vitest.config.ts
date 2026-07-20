import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Parser + pure modules run in Node (D-009). No DOM/LLM tests.
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next'],
  },
});
