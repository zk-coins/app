/**
 * App-side API adapter — neutral multi-asset model.
 *
 * The installed `@zkcoins/sdk` (0.4.0, pinned in `package.json`) predates
 * the node's neutral multi-asset migration: its `ZkCoinsClient.balance`
 * is single-arg, it has no `ownerBalances`, no `buildMintMessage`, and its
 * `MintRequest` is the old faucet shape. Until a multi-asset SDK ships we
 * implement the multi-asset wire bits HERE, in the app's own api layer,
 * mirroring the canonical SDK source layout exactly:
 *
 *   - `buildMintMessage` — byte-for-byte copy of the SDK's
 *     `messages.ts::buildMintMessage` (verified against the node's
 *     `verify_mint_signature_pub`): raw 33-byte creator pubkey ‖ name
 *     UTF-8 ‖ decimals[1] ‖ amount_le8 ‖ timestamp_le8.
 *   - per-asset `balance(address, asset_id)` and the portfolio
 *     `ownerBalances(address)` — mirror `client.ts::{balance,ownerBalances}`.
 *   - two-phase creator-signed `createCoin` (mint) — mirror
 *     `account.ts::mint`.
 *   - `send` carries the (required) `asset_id` — mirror `account.ts::pay`.
 *
 * The wire-compatible endpoints (info, history, getTransaction,
 * claim/resolve username, the Jobs-API send/commit/poll primitives) still
 * route through the SDK's `ZkCoinsClient`, and the SDK error classes
 * (`ApiError`, `JobFailedError`) + `newIdempotencyKey` are re-exported so
 * `userMessageFor` and the `instanceof` checks at the call sites are
 * unchanged.
 *
 * ## Crypto path — reuse the existing WASM signer
 *
 * Every local-signing step (BIP-32 derivation, SHA-256, Schnorr signing,
 * the commitment build) uses the app's existing `@zkcoins/wasm` module —
 * the same code path the browser bundle and the Playwright E2E suite
 * already exercise end-to-end against a real node. No second crypto stack
 * is introduced. Only the message-byte layout is sourced from the SDK
 * mirror (`buildSendMessage` / `buildClaimMessage` / the local
 * `buildMintMessage`), so the pre-hash bytes match the node.
 *
 * ## No-fallback contract
 *
 * `extractCommitInputs` hard-fails if the `awaiting_signature` job does
 * not surface `account_state_hash` / `output_coins_root` as JSON — the
 * wallet never fabricates a commitment. `waitForJob` throws on a terminal
 * `failed` / `cancelled` rather than returning a non-completed status.
 */

import { z } from 'zod';

import {
  ZkCoinsClient,
  newIdempotencyKey,
  buildSendMessage,
  buildClaimMessage,
  ApiError,
  JobFailedError,
  TxItemSchema,
  HistoryResponseSchema,
  JobErrorResponseSchema,
  JobAcceptedSchema,
  JobStatusSchema,
  type JobStatus,
  type JobAccepted,
  type InfoResponse,
  type UsernameResponse,
  type ResolveUsernameResponse,
  type ClaimUsernameResponse,
  type CommitRequest,
  type HistoryResponse,
  type TxItem,
  type TxDetail,
  type JobErrorResponse,
} from '@zkcoins/sdk';

import { useNetworkStore } from '@/stores/network';
import { initWasm } from '@zkcoins/wasm';

// Re-export the SDK error classes + the wire types under the names the
// app's call-sites and tests already import.
export { ApiError, JobFailedError, newIdempotencyKey };
export {
  TxItemSchema as HistoryItemSchema,
  HistoryResponseSchema,
  JobErrorResponseSchema as HistoryErrorResponseSchema,
};
export type {
  JobStatus,
  JobAccepted,
  InfoResponse,
  UsernameResponse,
  ResolveUsernameResponse,
  ClaimUsernameResponse,
  HistoryResponse,
  TxItem as HistoryItem,
  TxDetail,
  JobErrorResponse as HistoryErrorResponse,
};

// ---------------------------------------------------------------------------
// Multi-asset wire schemas (mirrored from the SDK's `schemas.ts`).
//
// The installed SDK still ships the single-asset `BalanceResponseSchema`,
// so the per-asset shapes live here until a multi-asset SDK lands. Strip
// mode (the Zod default) keeps forward-compat with new server fields.
// ---------------------------------------------------------------------------

/** `GET /api/balance?address=&asset_id=` — per-`(owner, asset)` balance. */
export const BalanceResponseSchema = z.object({
  balance: z.number(),
  username: z.string().optional(),
  num_sends: z.number(),
});
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;

/** One asset entry of the portfolio. `asset_id` is the trust anchor and
 *  is always present; `name` / `decimals` are display metadata that are
 *  elided for received-only assets. */
export const AssetBalanceSchema = z.object({
  asset_id: z.string(),
  name: z.string().optional(),
  decimals: z.number().optional(),
  balance: z.number(),
  num_sends: z.number(),
});
export type AssetBalance = z.infer<typeof AssetBalanceSchema>;

/** `GET /api/balance/:address` — the cross-asset portfolio. An
 *  unobserved address returns `assets: []` (canonical, not a 404). */
export const OwnerBalanceResponseSchema = z.object({
  address: z.string(),
  username: z.string().optional(),
  assets: z.array(AssetBalanceSchema),
});
export type OwnerBalanceResponse = z.infer<typeof OwnerBalanceResponseSchema>;

/**
 * Build a `ZkCoinsClient` pointed at the currently-configured node URL.
 * The URL is read from the store on every call so a runtime node switch
 * is honoured.
 */
function client(): ZkCoinsClient {
  return new ZkCoinsClient({ apiUrl: useNetworkStore.getState().apiUrl });
}

/** The base URL the app currently talks to. */
function apiUrl(): string {
  return useNetworkStore.getState().apiUrl.replace(/\/+$/, '');
}

const TERMINAL_STATUSES: ReadonlySet<JobStatus['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

// ---------------------------------------------------------------------------
// Mint-message byte layout (byte-for-byte copy of the SDK `buildMintMessage`).
// ---------------------------------------------------------------------------

/** Inputs to a creator-signed mint signature. */
export interface MintMessageParams {
  /** Compressed secp256k1 creator pubkey — 33 bytes hex (66 chars). */
  creatorPubkey: string;
  /** Raw asset name (UTF-8); folded into the asset_id by the node. */
  name: string;
  /** Asset decimals — a single byte (`u8`). */
  decimals: number;
  /** Amount to mint into the creator's own balance, atomic units. */
  amount: number;
  /** Unix timestamp in seconds. */
  timestamp: number;
}

/** Hex string → bytes (mirror of `@noble/hashes` `hexToBytes`, kept local
 *  so the message layout has no run-time dependency surprise). */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${hex.length})`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`hexToBytes: invalid hex at byte ${i}`);
    }
    out[i] = byte;
  }
  return out;
}

/** Encode a non-negative integer as 8 bytes little-endian. */
function uint64LE(value: number): Uint8Array {
  const big = BigInt(value);
  if (big < 0n || big > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`uint64LE: value ${big} is out of u64 range`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, big, true);
  return out;
}

/**
 * Concatenate the creator-signed mint-message bytes:
 *
 * ```text
 * SHA256( creator_pubkey[33] ‖ name_utf8 ‖ decimals[1] ‖ amount_le[8] ‖ timestamp_le[8] )
 * ```
 *
 * Byte-for-byte mirror of the SDK's `messages.ts::buildMintMessage` and
 * the node's `verify_mint_signature_pub`. Note the asymmetry with the
 * send layout (which UTF-8-encodes the hex *string* of each address): the
 * mint layout commits to the **raw** pubkey/name bytes. Does NOT hash —
 * the caller hashes + Schnorr-signs the digest with the creator key.
 */
export function buildMintMessage(params: MintMessageParams): Uint8Array {
  const creatorBytes = hexToBytes(params.creatorPubkey);
  if (creatorBytes.length !== 33) {
    throw new Error(
      `buildMintMessage: creatorPubkey must be a 33-byte compressed pubkey (66 hex chars), got ${creatorBytes.length} bytes`,
    );
  }
  if (!Number.isInteger(params.decimals) || params.decimals < 0 || params.decimals > 255) {
    throw new RangeError(
      `buildMintMessage: decimals must be a single byte (integer 0–255), got ${params.decimals}`,
    );
  }
  const nameBytes = new TextEncoder().encode(params.name);
  const decimalsBytes = Uint8Array.of(params.decimals);
  const amountBytes = uint64LE(params.amount);
  const timestampBytes = uint64LE(params.timestamp);

  const out = new Uint8Array(
    creatorBytes.length +
      nameBytes.length +
      decimalsBytes.length +
      amountBytes.length +
      timestampBytes.length,
  );
  let offset = 0;
  out.set(creatorBytes, offset);
  offset += creatorBytes.length;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  out.set(decimalsBytes, offset);
  offset += decimalsBytes.length;
  out.set(amountBytes, offset);
  offset += amountBytes.length;
  out.set(timestampBytes, offset);
  return out;
}

// ---------------------------------------------------------------------------
// Wire requests.
// ---------------------------------------------------------------------------

/** Inputs to a creator-signed mint job (`POST /api/jobs/mint`). */
export interface MintRequest {
  creator_pubkey: string;
  name: string;
  decimals: number;
  amount: number;
  next_public_key: string;
  signature: string;
  timestamp: number;
}

/** Inputs to a signed send request (`POST /api/jobs/send`). */
export interface SignedSendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  asset_id: string;
  public_key: string;
  next_public_key: string;
  prev_commitment_pubkey?: string;
  signature: string;
  timestamp: number;
}

/** Inputs to a username claim (xpriv signs locally; never leaves the device). */
export interface ClaimUsernameParams {
  username: string;
  address: string;
  xpriv: string;
}

/** Parameters for the high-level create-coin / mint helper. */
export interface CreateCoinParams {
  account_address: string;
  name: string;
  decimals: number;
  amount: number;
  xpriv: string;
}

/** Parameters for the high-level send helper. */
export interface SendParams {
  account_address: string;
  recipient: string;
  amount: number;
  asset_id: string;
  xpriv: string;
}

/**
 * SHA-256 a message and return the hex digest, using the same WebCrypto
 * path the WASM signer expects as input.
 */
async function sha256Hex(message: Uint8Array): Promise<string> {
  const bytes = new Uint8Array(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign a username claim with Schnorr (WASM) using pubkey_0 (identity key)
 * over the SDK-built claim message.
 */
async function signClaimRequest(
  params: ClaimUsernameParams,
): Promise<{ public_key: string; signature: string; timestamp: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const wasm = await initWasm();

  const keys = wasm.derivePublicKeys(params.xpriv, 0);
  const signingKey = wasm.deriveSigningKey(params.xpriv, 0);

  const message = buildClaimMessage({
    address: params.address,
    username: params.username,
    timestamp,
  });
  const hashHex = await sha256Hex(message);
  const signature = wasm.signSchnorr(signingKey, hashHex);

  return { public_key: keys.publicKey, signature, timestamp };
}

/**
 * Pull `account_state_hash` + `output_coins_root` off an
 * `awaiting_signature` job so the wallet can sign the commitment. Hard-
 * fails (no fabricated commitment) when absent.
 */
function extractCommitInputs(
  job: JobStatus,
  jobId: string,
): { accountStateHash: string; outputCoinsRoot: string } {
  const ash = job.result?.account_state_hash;
  const ocr = job.result?.output_coins_root;
  if (typeof ash === 'string' && typeof ocr === 'string') {
    return { accountStateHash: ash, outputCoinsRoot: ocr };
  }
  throw new JobFailedError(
    jobId,
    'failed',
    'awaiting_signature job did not surface account_state_hash / output_coins_root as JSON ' +
      '(node must carry them on the JobStatus result; the wallet does not decode the binary proof)',
  );
}

/**
 * POST a JSON body to the node and parse the 2xx response against
 * `schema`, mapping a non-2xx onto `ApiError`. Used for the multi-asset
 * endpoints the installed SDK does not yet speak. Mirrors the SDK's
 * `request` error contract (`ApiError(status, serverError, rawBody)`).
 */
async function postJson<T>(
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, extractServerError(rawText), rawText);
  }
  return schema.parse(JSON.parse(rawText));
}

/** GET a JSON resource and parse it against `schema`. */
async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${apiUrl()}${path}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, extractServerError(rawText), rawText);
  }
  return schema.parse(JSON.parse(rawText));
}

/** Pull the human-facing error string out of a failure body. */
function extractServerError(rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'error' in parsed &&
      typeof (parsed as { error: unknown }).error === 'string'
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Body wasn't JSON — keep the raw text as the error message.
  }
  return rawBody;
}

export const api = {
  newIdempotencyKey,

  sendJob: (req: SignedSendRequest, idempotencyKey: string): Promise<JobAccepted> =>
    postJson('/api/jobs/send', req, JobAcceptedSchema, { 'Idempotency-Key': idempotencyKey }),

  mintJob: (req: MintRequest, idempotencyKey: string): Promise<JobAccepted> =>
    postJson('/api/jobs/mint', req, JobAcceptedSchema, { 'Idempotency-Key': idempotencyKey }),

  getJob: (id: string): Promise<JobStatus> => client().getJob(id),

  commitJob: (id: string, req: CommitRequest): Promise<void> => client().commitJob(id, req),

  waitForJob: (
    jobId: string,
    stopAt: ReadonlySet<JobStatus['status']>,
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => waitForJob(client(), jobId, stopAt, opts),

  /**
   * Create / mint a coin. Neutral, permissionless, two-phase and
   * creator-signed — mirrors the SDK `account.ts::mint`:
   *
   *   1. Derive the creator identity pubkey (index 0) + the next rotation
   *      key (index 1); sign the mint message with the creator key.
   *   2. Admit `POST /api/jobs/mint` (mandatory `Idempotency-Key`); poll
   *      to `awaiting_signature`.
   *   3. Build the commitment over `account_state_hash ‖ output_coins_root`
   *      with the SAME creator key (index 0 — the soundness gate binds
   *      the commitment key to the creator); attach it.
   *   4. Poll to `completed`.
   *
   * The owner (`H(creator_pubkey)`) and asset_id are derived node-side.
   */
  createCoin: async (
    params: CreateCoinParams,
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => {
    const c = client();
    const timestamp = Math.floor(Date.now() / 1000);

    const wasm = await initWasm();
    // The creator key is the identity key at index 0; `next_public_key`
    // is the index-1 rotation key (like a send).
    const keys = wasm.derivePublicKeys(params.xpriv, 0);
    const messageBytes = buildMintMessage({
      creatorPubkey: keys.publicKey,
      name: params.name,
      decimals: params.decimals,
      amount: params.amount,
      timestamp,
    });
    const hashHex = await sha256Hex(messageBytes);
    const signingKey = wasm.deriveSigningKey(params.xpriv, 0);
    const signature = wasm.signSchnorr(signingKey, hashHex);

    const accepted = await api.mintJob(
      {
        creator_pubkey: keys.publicKey,
        name: params.name,
        decimals: params.decimals,
        amount: params.amount,
        next_public_key: keys.nextPublicKey,
        signature,
        timestamp,
      },
      newIdempotencyKey(),
    );
    const jobId = accepted.job_id;

    const awaiting = await waitForJob(
      c,
      jobId,
      new Set<JobStatus['status']>(['awaiting_signature', ...TERMINAL_STATUSES]),
      opts,
    );
    if (awaiting.status !== 'awaiting_signature') {
      throw new JobFailedError(
        jobId,
        'failed',
        `mint job ended in ${awaiting.status} before commit`,
      );
    }
    const proofId = awaiting.proof_id;
    if (proofId === null || proofId === undefined) {
      throw new JobFailedError(
        jobId,
        'failed',
        'awaiting_signature mint job did not carry a proof_id',
      );
    }

    const { accountStateHash, outputCoinsRoot } = extractCommitInputs(awaiting, jobId);
    // The commitment is signed with the creator key (index 0) — the gate
    // requires commitment.public_key == account.public_key == creator_pubkey.
    const commitment = wasm.createCommitment(params.xpriv, 0, accountStateHash, outputCoinsRoot);
    await c.commitJob(jobId, {
      proof_id: proofId,
      public_key: commitment.publicKey,
      signature: commitment.signature,
      message: commitment.message,
    });

    return waitForJob(c, jobId, TERMINAL_STATUSES, opts);
  },

  /**
   * Two-phase send of `amount` of `asset_id` to `recipient`. Mirrors the
   * SDK `account.ts::pay`:
   *
   *   1. Re-fetch the portfolio (thin-client invariant); confirm the
   *      asset balance covers the amount; hydrate the global send index
   *      from the SUM of every asset's `num_sends` (the commitment SMT is
   *      keyed by pubkey across all assets, so the index is wallet-global,
   *      not per-asset).
   *   2. Derive `public_key` at the index, `next_public_key` at index+1,
   *      `prev_commitment_pubkey` at index-1 when the wallet has sent.
   *   3. Sign + admit the send job (`Idempotency-Key`).
   *   4. Poll to `awaiting_signature`; read ash/ocr from the JSON result.
   *   5. Build + attach the commitment (WASM, same index).
   *   6. Poll to `completed`.
   */
  send: async (
    params: SendParams,
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => {
    const c = client();

    // 1. Thin-client invariant: hydrate the global send index from the
    // server. The commitment pubkey must be unique across the WHOLE wallet
    // (SMT keyed by pubkey, shared across assets), so the index is the sum
    // of every asset's num_sends, not the per-asset counter.
    const owned = await api.ownerBalances(params.account_address);
    const asset = owned.assets.find((a) => a.asset_id === params.asset_id);
    const assetBalance = asset?.balance ?? 0;
    if (assetBalance < params.amount) {
      throw new ApiError(
        422,
        'Insufficient funds',
        JSON.stringify({ error: 'Insufficient funds' }),
      );
    }
    const numPubkeys = owned.assets.reduce((sum, a) => sum + a.num_sends, 0);

    // 2. Derive the pubkey pair (+ prev pubkey) for this send.
    const wasm = await initWasm();
    const keys = wasm.derivePublicKeys(params.xpriv, numPubkeys);
    const prevPk =
      numPubkeys > 0 ? wasm.derivePublicKeys(params.xpriv, numPubkeys - 1).publicKey : undefined;

    // 3. Sign + admit.
    const timestamp = Math.floor(Date.now() / 1000);
    const messageBytes = buildSendMessage({
      accountAddress: params.account_address,
      recipient: params.recipient,
      amount: params.amount,
      timestamp,
    });
    const hashHex = await sha256Hex(messageBytes);
    const signingKey = wasm.deriveSigningKey(params.xpriv, numPubkeys);
    const signature = wasm.signSchnorr(signingKey, hashHex);

    const signed: SignedSendRequest = {
      account_address: params.account_address,
      recipient: params.recipient,
      amount: params.amount,
      asset_id: params.asset_id,
      public_key: keys.publicKey,
      next_public_key: keys.nextPublicKey,
      ...(prevPk !== undefined ? { prev_commitment_pubkey: prevPk } : {}),
      signature,
      timestamp,
    };
    const accepted = await api.sendJob(signed, newIdempotencyKey());
    const jobId = accepted.job_id;

    // 4. Poll to `awaiting_signature`.
    const awaiting = await waitForJob(
      c,
      jobId,
      new Set<JobStatus['status']>(['awaiting_signature', ...TERMINAL_STATUSES]),
      opts,
    );
    if (awaiting.status !== 'awaiting_signature') {
      throw new JobFailedError(
        jobId,
        'failed',
        `send job ended in ${awaiting.status} before commit`,
      );
    }
    const proofId = awaiting.proof_id;
    if (proofId === null || proofId === undefined) {
      throw new JobFailedError(jobId, 'failed', 'awaiting_signature job did not carry a proof_id');
    }

    // 5. Build + attach the commitment.
    const { accountStateHash, outputCoinsRoot } = extractCommitInputs(awaiting, jobId);
    const commitment = wasm.createCommitment(
      params.xpriv,
      numPubkeys,
      accountStateHash,
      outputCoinsRoot,
    );
    await c.commitJob(jobId, {
      proof_id: proofId,
      public_key: commitment.publicKey,
      signature: commitment.signature,
      message: commitment.message,
    });

    // 6. Poll to `completed`.
    return waitForJob(c, jobId, TERMINAL_STATUSES, opts);
  },

  /** Per-`(owner, asset)` balance — `GET /api/balance?address=&asset_id=`. */
  balance: (address: string, assetId: string): Promise<BalanceResponse> =>
    getJson(
      `/api/balance?address=${encodeURIComponent(address)}&asset_id=${encodeURIComponent(assetId)}`,
      BalanceResponseSchema,
    ),

  /** The owner's cross-asset portfolio — `GET /api/balance/:address`. */
  ownerBalances: (address: string): Promise<OwnerBalanceResponse> =>
    getJson(`/api/balance/${encodeURIComponent(address)}`, OwnerBalanceResponseSchema),

  info: (): Promise<InfoResponse> => client().info(),

  getHistory: (
    address: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<HistoryResponse> => client().history(address, opts),

  getTransaction: (id: number, address: string): Promise<TxDetail> =>
    client().getTransaction(id, address),

  claimUsername: async (params: ClaimUsernameParams): Promise<ClaimUsernameResponse> => {
    const signed = await signClaimRequest(params);
    return client().claimUsername({
      username: params.username,
      address: params.address,
      public_key: signed.public_key,
      signature: signed.signature,
      timestamp: signed.timestamp,
    });
  },

  resolveUsername: (username: string): Promise<ResolveUsernameResponse> =>
    client().resolveUsername(username),
};

/**
 * Poll a job to a target status set via the SDK client's
 * `getJobWithRetry`. Respects the node's `Retry-After` backoff and throws
 * `JobFailedError` on `failed` / `cancelled` (no silent fallback).
 */
async function waitForJob(
  c: ZkCoinsClient,
  jobId: string,
  stopAt: ReadonlySet<JobStatus['status']>,
  opts: { onPhase?: (status: JobStatus) => void } = {},
): Promise<JobStatus> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastPhase: string | undefined;

  for (;;) {
    const { status: job, retryAfterMs } = await c.getJobWithRetry(jobId);

    if (opts.onPhase && job.phase !== lastPhase) {
      lastPhase = job.phase;
      opts.onPhase(job);
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new JobFailedError(jobId, job.status, job.error ?? undefined);
    }
    if (stopAt.has(job.status)) {
      return job;
    }
    /* c8 ignore next 5 — the deadline guard only fires on a stuck node;
       unit tests reach a terminal state on the first or second poll. */
    if (Date.now() >= deadline) {
      throw new JobFailedError(
        jobId,
        'failed',
        `timed out in ${job.status} after ${WAIT_TIMEOUT_MS}ms`,
      );
    }

    await delay(Math.max(POLL_FLOOR_MS, retryAfterMs ?? 0));
  }
}

const POLL_FLOOR_MS = 1_500;
const WAIT_TIMEOUT_MS = 180_000; // 3 minutes

/** `setTimeout`-based delay. */
function delay(ms: number): Promise<void> {
  /* c8 ignore next — delegates to a host timer, no logic to cover */
  return new Promise((resolve) => setTimeout(resolve, ms));
}
