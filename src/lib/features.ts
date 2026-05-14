// Build-time feature flags. `process.env.NEXT_PUBLIC_*` is inlined by Next.js,
// so `if (FEATURES.X)` branches against `false` are removed by dead-code
// elimination — the gated code does not ship in the bundle.
//
// All flags default off (fail-closed). Set the env var to the literal string
// "true" at build time to opt in. Any other value, including missing, leaves
// the flag off.

const on = (value: string | undefined): boolean => value === 'true';

export const FEATURES = {
  PASSKEY: on(process.env.NEXT_PUBLIC_ENABLE_PASSKEY),
  FAUCET: on(process.env.NEXT_PUBLIC_ENABLE_FAUCET),
  USERNAMES: on(process.env.NEXT_PUBLIC_ENABLE_USERNAMES),
  APPS_DIRECTORY: on(process.env.NEXT_PUBLIC_ENABLE_APPS_DIRECTORY),
  DEV_ROUTES: on(process.env.NEXT_PUBLIC_ENABLE_DEV_ROUTES),
} as const;
