import { defineConfig } from 'vitest/config';

const isDev =
  process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';

export default defineConfig({
  test: {
    include: ['tests/*.test.{ts,tsx,js}', 'src/**/*.test.{ts,tsx,js}'],
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    testTimeout: 10_000,
    allowOnly: isDev,
  },
});
