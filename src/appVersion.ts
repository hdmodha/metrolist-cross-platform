/** The app version (package.json), injected at build time by Vite (`define` in vite.config.ts). */
declare const __APP_VERSION__: string | undefined;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
