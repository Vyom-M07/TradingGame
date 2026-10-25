import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ command, mode }) => {
  // Empty prefix: .env files plus the build machine's environment.
  const env = loadEnv(mode, '.', '');

  // Vercel sets VERCEL=1 during builds. Deployments must use the production
  // environment (.env.production or the Vercel project's env vars).
  if (env.VERCEL && mode !== 'production') {
    throw new Error(`Vercel builds must run in production mode (got "${mode}")`);
  }

  if (command === 'build' && mode === 'production') {
    if (!env.VITE_SPACETIMEDB_URI?.startsWith('wss://') || !env.VITE_SPACETIMEDB_NAME) {
      throw new Error(
        'Production builds need VITE_SPACETIMEDB_URI (wss://...) and VITE_SPACETIMEDB_NAME; see .env.production'
      );
    }
  }

  return {
    plugins: [react(), tailwindcss()],
  };
});
