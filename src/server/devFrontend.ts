/**
 * Vite's dev middlewares for `npm run dev` and `npm run desktop:dev`. Vite is imported dynamically, so
 * the production server, the bundled `dist-server/server.mjs` and the packaged desktop app never load it.
 */
import type { FrontendMiddleware } from './createServer';

export interface DevFrontend {
  middleware: FrontendMiddleware;
  close: () => Promise<void>;
}

export async function createDevFrontend(root: string): Promise<DevFrontend> {
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    server: {
      middlewareMode: true,
      ws: false,
      fs: {
        strict: true,
        deny: ['.env', '.env.*', '*.{crt,pem}'],
      },
    },
    appType: 'spa',
  });
  return { middleware: vite.middlewares, close: () => vite.close() };
}
