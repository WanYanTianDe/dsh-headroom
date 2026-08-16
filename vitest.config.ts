import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The real package ships a browser closure bundle that vitest's ESM
      // loader cannot execute; the controller tests only need the
      // snapshot-store helper.
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(
        new URL('./tests/mocks/runtime-client.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
  },
})
