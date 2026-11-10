/** Ports of the two servers `playwright.config.ts` starts (overridable for parallel local runs). */
export const SERVER_PORT = Number(process.env.E2E_SERVER_PORT) || 3101;
export const STATIC_PORT = Number(process.env.E2E_STATIC_PORT) || 3102;
