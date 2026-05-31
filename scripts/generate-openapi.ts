/**
 * Generates `openapi/zkcoins.yaml` from the Zod schemas in
 * `src/lib/api/schemas.ts`. Issue #155.
 *
 * The Zod file is the source of truth for the HTTP boundary; this
 * script turns it into a published OpenAPI 3.0 document that external
 * integrators (Cake, Layerz, future `@zkcoins/sdk`) can use to
 * generate typed clients.
 *
 * Drift between the on-disk YAML and the regenerated output is caught
 * by the `OpenAPI Drift` CI job (`npm run generate:openapi` followed
 * by `git diff --exit-code openapi/`).
 *
 * Out of scope for issue #155: `/api/history` — its Zod schema lands
 * with #153, then this script will pick it up automatically.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { stringify as yamlStringify } from 'yaml';

// Must run before `schemas` is loaded — `registry.register()` calls
// `.openapi(...)` on the supplied schema, which needs the prototype
// extension in place. The `require()` below is deferred so the
// extension wins the race against the schemas module load order.
extendZodWithOpenApi(z);

import { createRequire } from 'node:module';
const requireFn = createRequire(import.meta.url);
const schemas = requireFn('../src/lib/api/schemas') as typeof import('../src/lib/api/schemas');
const {
  BalanceResponseSchema,
  CapabilitiesSchema,
  CapabilityNameSchema,
  ClaimUsernameRequestSchema,
  ClaimUsernameResponseSchema,
  CommitRequestSchema,
  CommitResponseSchema,
  ErrorResponseSchema,
  InfoResponseSchema,
  MintRequestSchema,
  MintResponseSchema,
  ResolveUsernameResponseSchema,
  SendRequestSchema,
  SendResponseSchema,
  UsernameResponseSchema,
} = schemas;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'openapi');
const OUT_FILE = join(OUT_DIR, 'zkcoins.yaml');

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  version: string;
};

const registry = new OpenAPIRegistry();

// --- Components ------------------------------------------------------

const ErrorResponse = registry.register('ErrorResponse', ErrorResponseSchema);
const SendResponse = registry.register('SendResponse', SendResponseSchema);
const MintResponse = registry.register('MintResponse', MintResponseSchema);
const CommitResponse = registry.register('CommitResponse', CommitResponseSchema);
const BalanceResponse = registry.register('BalanceResponse', BalanceResponseSchema);
const InfoResponse = registry.register('InfoResponse', InfoResponseSchema);
const Capabilities = registry.register('Capabilities', CapabilitiesSchema);
const CapabilityName = registry.register('CapabilityName', CapabilityNameSchema);
const UsernameResponse = registry.register('UsernameResponse', UsernameResponseSchema);
const ClaimUsernameResponse = registry.register(
  'ClaimUsernameResponse',
  ClaimUsernameResponseSchema,
);
const ResolveUsernameResponse = registry.register(
  'ResolveUsernameResponse',
  ResolveUsernameResponseSchema,
);
const MintRequest = registry.register('MintRequest', MintRequestSchema);
const SendRequest = registry.register('SendRequest', SendRequestSchema);
const CommitRequest = registry.register('CommitRequest', CommitRequestSchema);
const ClaimUsernameRequest = registry.register('ClaimUsernameRequest', ClaimUsernameRequestSchema);

// Mark unused-by-paths components as referenced so they always appear
// in `components.schemas`. `Capabilities` is referenced by
// `InfoResponse`; the rest are referenced explicitly by the path
// registrations below.
void Capabilities;
void CapabilityName;
void ClaimUsernameResponse;
void ResolveUsernameResponse;

// --- Common error responses ------------------------------------------

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: ErrorResponse } },
});

// --- Paths -----------------------------------------------------------

registry.registerPath({
  method: 'get',
  path: '/api/info',
  summary: 'Node identity and feature capabilities',
  description:
    'Returns the network name and the boolean capability set the binary was built with. Wallets render their UI based on `capabilities.*`.',
  responses: {
    200: {
      description: 'Info envelope',
      content: { 'application/json': { schema: InfoResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/balance',
  summary: 'Authoritative balance + send-counter for an address',
  description:
    'Returns the on-chain balance for the supplied address along with `num_sends`, the BIP-32 index the wallet must use for the next signed request. Always call this immediately before any signed `/api/send` or `/api/commit` — the local store can drift.',
  request: {
    query: z.object({
      address: z.string().openapi({
        description: '32-byte hex (with or without `0x` prefix).',
        example: 'aabbccdd...',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Balance envelope',
      content: { 'application/json': { schema: BalanceResponse } },
    },
    422: errorResponse('Malformed address (not hex / wrong length).'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/mint',
  summary: 'Mint coins to an address (faucet)',
  description:
    'Internal/test environment faucet. Generates a fresh coin and credits the supplied address. On success returns the SendResponse envelope; the matching commitment is broadcast by the node itself (no follow-up `/api/commit` required).',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: MintRequest } },
    },
  },
  responses: {
    200: {
      description: 'Mint accepted',
      content: { 'application/json': { schema: MintResponse } },
    },
    422: errorResponse('Bad mint parameters.'),
    500: errorResponse('Prover or broadcast failure.'),
    503: errorResponse('Concurrent mint in flight.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/send',
  summary: 'Build a send proof for two-step commit/reveal',
  description:
    'Server-side proof generation step. The node builds the ZK proof for the requested transfer and returns `proof_id` plus the hashes the wallet has to sign. The wallet then signs `account_state_hash || output_coins_root` and POSTs the signature to `/api/commit`.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: SendRequest } },
    },
  },
  responses: {
    200: {
      description: 'Proof generated; commit step pending',
      content: { 'application/json': { schema: SendResponse } },
    },
    404: errorResponse('Unknown sender address.'),
    422: errorResponse(
      'Witness-invalid (insufficient funds, in-coin not in source root, signature shape, etc.).',
    ),
    500: errorResponse('Prover internal error.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/commit',
  summary: 'Submit signed commitment for a previously generated proof',
  description:
    'Two-step finaliser for `/api/send`. The wallet signs the hashes returned by `/api/send` with the same key referenced by `public_key`; the node verifies the Schnorr signature, broadcasts the commit/reveal pair as a Taproot inscription, and delivers the coin to the recipient on success.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: CommitRequest } },
    },
  },
  responses: {
    200: {
      description: 'Commit broadcast; coin delivered',
      content: { 'application/json': { schema: CommitResponse } },
    },
    401: errorResponse('Commitment signature invalid.'),
    404: errorResponse('Unknown proof_id.'),
    422: errorResponse('Malformed message or signature hex.'),
    503: errorResponse('Bitcoin broadcast failed.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/receive',
  summary: 'Push a coin proof to the receive flow (reserved)',
  description:
    'Currently unused — the receive path is driven by the on-chain scanner. The endpoint stays in the surface so a future authenticated push flow can land without a wire-level break.',
  request: {
    body: {
      required: false,
      content: {
        'application/json': {
          schema: z.object({ coin_proof: z.unknown() }).openapi('ReceiveCoinRequest'),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Acknowledged',
      content: { 'application/json': { schema: SendResponse } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/proof/{id}',
  summary: 'Download a stored coin proof by id',
  description:
    'Returns the bincode-serialised `CoinProof` for the supplied id. Used by recovery tooling — the wallet does not need this on the hot path.',
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Proof id assigned by the node.', example: '42' }),
    }),
  },
  responses: {
    200: {
      description: 'Binary proof blob',
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
    },
    404: errorResponse('No proof with this id.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/username/claim',
  summary: 'Claim a username for an address (gated)',
  description:
    'Self-host opt-in (Cargo feature `username-claim`). Returns 404 on hosted DEV + PRD nodes. The address signs `"zkcoins:claim_username" || address || username || timestamp_le` with its identity key (`pubkey_0`).',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: ClaimUsernameRequest } },
    },
  },
  responses: {
    200: {
      description: 'Username claimed',
      content: { 'application/json': { schema: ClaimUsernameResponse } },
    },
    401: errorResponse('Signature invalid.'),
    409: errorResponse('Username already taken.'),
    422: errorResponse('Username failed validation.'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/username/resolve/{username}',
  summary: 'Resolve a username to an address',
  description: 'Read-side username lookup. Always available regardless of capability flags.',
  request: {
    params: z.object({
      username: z.string().openapi({ description: 'URL-encoded username.', example: 'alice' }),
    }),
  },
  responses: {
    200: {
      description: 'Resolved address',
      content: { 'application/json': { schema: ResolveUsernameResponse } },
    },
    404: errorResponse('No such username.'),
  },
});

// --- Generate --------------------------------------------------------

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    version: pkg.version,
    title: 'zkCoins Node API',
    description:
      'Public HTTP surface of zk-coins/node. Source of truth for the published TypeScript / Dart / Rust clients consumed by external wallet integrators.\n\nGenerated from `zk-coins/app/src/lib/api/schemas.ts`. Do not hand-edit this file — regenerate via `npm run generate:openapi`.',
    license: {
      name: 'MIT',
      url: 'https://github.com/zk-coins/node/blob/develop/LICENSE',
    },
  },
  servers: [
    { url: 'https://api.zkcoins.app', description: 'Production node (Mainnet)' },
    { url: 'https://dev-api.zkcoins.app', description: 'DEV node (Mutinynet)' },
  ],
});

mkdirSync(OUT_DIR, { recursive: true });
const yaml = yamlStringify(document, { indent: 2, lineWidth: 0 });
writeFileSync(OUT_FILE, yaml);

console.log(`Wrote ${OUT_FILE} (${yaml.length} bytes).`);
