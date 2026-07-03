// The pageview beacon endpoint (workers/beacon — Cloudflare Analytics Engine).
// EMPTY string = beacon disabled (the component no-ops). Fill in the workers.dev
// URL after `npx wrangler@3 deploy` in site/workers/beacon (needs an API token
// with Workers Scripts: Edit; the current token is Pages-scoped).
export const BEACON_URL = "";
