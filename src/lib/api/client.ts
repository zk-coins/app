import type { ZodType, z } from 'zod';
import { useNetworkStore } from '@/stores/network';
import { initWasm } from '@zkcoins/wasm';
import {
  BalanceResponseSchema,
  ClaimUsernameResponseSchema,
  InfoResponseSchema,
  JobAcceptedSchema,
  JobResultSchema,
  JobStatusSchema,
  ResolveUsernameResponseSchema,
  UsernameResponseSchema,
} from './schemas';

// Response types are inferred from the schemas in `./schemas.ts` so the
// schema is the single source of truth. The public names match the
// pre-Zod interface names callers already import — no churn for them.
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>;
export type UsernameResponse = z.infer<typeof UsernameResponseSchema>;
export type InfoResponse = z.infer<typeof InfoResponseSchema>;
export type JobAccepted = z.infer<typeof JobAcceptedSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;

function getApiUrl(): string {
  return useNetworkStore.getState().apiUrl;
}

const REQUEST_TIMEOUT_MS = 120_000; // 2 minutes (proof generation can be slow)

// Poll loop defaults for `waitForJob`. The node attaches
// `Retry-After: 2` on every non-terminal poll; `POLL_FLOOR_MS` is the
// fallback when the header is absent (or unparseable), `WAIT_TIMEOUT_MS`
// the hard ceiling for the whole wait (proof gen + broadcast).
const POLL_FLOOR_MS = 1_500;
const WAIT_TIMEOUT_MS = 180_000; // 3 minutes

const TERMINAL_STATUSES: ReadonlySet<JobStatus['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Typed error for non-2xx responses from the zkCoins API.
 *
 * The Jobs API serves failures as `4xx`/`5xx` with body
 * `{error: "<string>"}` (`router::JobErrorResponse`); the legacy
 * `{success: false, error}` envelope is also handled. `serverError` is
 * the extracted string (or the raw body if it wasn't JSON); `rawBody` is
 * preserved for diagnostics. Call-sites pass an `ApiError` instance
 * through `userMessageFor` (see `./errorMessages.ts`) to render a
 * translated, user-facing message.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly serverError: string,
    public readonly rawBody?: string,
  ) {
    super(`API error ${status}: ${serverError}`);
    this.name = 'ApiError';
  }
}

/**
 * Thrown when a job reaches a terminal `failed` / `cancelled` state, or
 * when an `awaiting_signature` send job does not surface the commitment
 * material the wallet needs. No-fallback contract: the wallet never
 * fabricates a commitment — a missing field is a hard error.
 */
export class JobFailedError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly jobStatus: JobStatus['status'],
    public readonly detail?: string,
  ) {
    super(`Job ${jobId} ${jobStatus}${detail ? `: ${detail}` : ''}`);
    this.name = 'JobFailedError';
  }
}

/** Pull the human-facing error string out of a non-2xx body. */
function extractServerError(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
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

interface RequestResult<T> {
  data: T;
  headers: Headers;
}

/**
 * Shared `fetch` path. Validates the 2xx body against `schema`; maps
 * non-2xx onto `ApiError`. In `lenient` mode an empty / partial 2xx body
 * (the commit accept envelope `{status:"broadcasting"}`) is allowed
 * through as `{}` — the caller only needs the call to have succeeded;
 * the authoritative state comes from the subsequent poll.
 */
async function requestWithHeaders<T>(
  path: string,
  schema: ZodType<T>,
  options?: RequestInit,
  parse: { lenient?: boolean } = {},
): Promise<RequestResult<T>> {
  const controller = new AbortController();
  /* c8 ignore next — 2-minute timeout callback, not triggered in unit tests */
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${getApiUrl()}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...options,
    });
    if (!res.ok) {
      const rawBody = await res.text();
      throw new ApiError(res.status, extractServerError(rawBody), rawBody);
    }
    if (parse.lenient) {
      const rawText = await res.text();
      const json: unknown = rawText.trim().length > 0 ? JSON.parse(rawText) : {};
      return { data: json as T, headers: res.headers };
    }
    return { data: schema.parse(await res.json()), headers: res.headers };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  options?: RequestInit,
  parse: { lenient?: boolean } = {},
): Promise<T> {
  return (await requestWithHeaders(path, schema, options, parse)).data;
}

export interface MintRequest {
  account_address: string;
  amount: number;
}

export interface SendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  public_key: string;
  next_public_key: string;
  prev_commitment_pubkey?: string;
}

export interface SignedSendRequest extends SendRequest {
  signature: string;
  timestamp: number;
}

export interface ClaimUsernameParams {
  username: string;
  address: string;
  xpriv: string;
}

export interface CommitRequest {
  proof_id: number;
  public_key: string;
  signature: string;
  message: string;
}

/** A `waitForJob` poll observation plus the parsed `Retry-After` hint. */
interface JobPoll {
  status: JobStatus;
  retryAfterMs: number | null;
}

/**
 * Generate a fresh UUID v4 idempotency key. Mints one per logical
 * operation so a retried admit POST never enqueues a duplicate job; the
 * same key is reused across retries of the same operation.
 *
 * Uses WebCrypto `getRandomValues` (always present in the browser
 * runtime the app ships to). The version (`4`) and variant (`8|9|a|b`)
 * nibbles are set per RFC 4122 so the node's `Idempotency-Key` parser
 * accepts it.
 */
export function newIdempotencyKey(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = (n: number): string => n.toString(16).padStart(2, '0');
  const hex = Array.from(b, h).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Sign a send request with Schnorr.
 * Message = SHA256(account_address || recipient || amount_le || timestamp_le)
 */
async function signSendRequest(
  data: SendRequest,
  xpriv: string,
  numPubkeys: number,
): Promise<SignedSendRequest> {
  const timestamp = Math.floor(Date.now() / 1000);

  // Build the message bytes matching server's hash construction
  const encoder = new TextEncoder();
  const addressBytes = encoder.encode(data.account_address);
  const recipientBytes = encoder.encode(data.recipient);
  const amountBytes = new Uint8Array(8);
  new DataView(amountBytes.buffer).setBigUint64(0, BigInt(data.amount), true);
  const timestampBytes = new Uint8Array(8);
  new DataView(timestampBytes.buffer).setBigUint64(0, BigInt(timestamp), true);

  const combined = new Uint8Array(
    addressBytes.length + recipientBytes.length + amountBytes.length + timestampBytes.length,
  );
  let offset = 0;
  combined.set(addressBytes, offset);
  offset += addressBytes.length;
  combined.set(recipientBytes, offset);
  offset += recipientBytes.length;
  combined.set(amountBytes, offset);
  offset += amountBytes.length;
  combined.set(timestampBytes, offset);

  // SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Derive private key at the current index for signing
  const wasm = await initWasm();
  const signingKey = wasm.deriveSigningKey(xpriv, numPubkeys);
  const signature = wasm.signSchnorr(signingKey, hashHex);

  return {
    ...data,
    signature,
    timestamp,
  };
}

/**
 * Sign a username claim request with Schnorr using pubkey_0 (identity key).
 * Message = SHA256("zkcoins:claim_username" || address_hex || username || timestamp_le)
 */
async function signClaimRequest(
  params: ClaimUsernameParams,
): Promise<{ public_key: string; signature: string; timestamp: number }> {
  const timestamp = Math.floor(Date.now() / 1000);
  const wasm = await initWasm();

  const keys = wasm.derivePublicKeys(params.xpriv, 0);
  const signingKey = wasm.deriveSigningKey(params.xpriv, 0);

  const encoder = new TextEncoder();
  const prefix = encoder.encode('zkcoins:claim_username');
  const addressBytes = encoder.encode(params.address);
  const usernameBytes = encoder.encode(params.username);
  const timestampBytes = new Uint8Array(8);
  new DataView(timestampBytes.buffer).setBigUint64(0, BigInt(timestamp), true);

  const combined = new Uint8Array(
    prefix.length + addressBytes.length + usernameBytes.length + timestampBytes.length,
  );
  let offset = 0;
  combined.set(prefix, offset);
  offset += prefix.length;
  combined.set(addressBytes, offset);
  offset += addressBytes.length;
  combined.set(usernameBytes, offset);
  offset += usernameBytes.length;
  combined.set(timestampBytes, offset);

  const hashBuffer = await crypto.subtle.digest('SHA-256', combined);
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  const signature = wasm.signSchnorr(signingKey, hashHex);

  return { public_key: keys.publicKey, signature, timestamp };
}

// ---- Jobs-API primitives --------------------------------------------------

/**
 * Admit a mint job — `POST /api/jobs/mint` → 202 `{job_id, status}`. The
 * `Idempotency-Key` header is mandatory: a retried admit with the same
 * key returns the original job instead of enqueueing a second.
 */
function mintJob(req: MintRequest, idempotencyKey: string): Promise<JobAccepted> {
  return request('/api/jobs/mint', JobAcceptedSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(req),
  });
}

/**
 * Admit a send job — `POST /api/jobs/send` → 202 `{job_id, status}`. Body
 * is the already-signed send request; the node verifies the signature
 * synchronously before admitting (a bad signature 401s here, before a job
 * row is burned). `Idempotency-Key` mandatory.
 */
function sendJob(req: SignedSendRequest, idempotencyKey: string): Promise<JobAccepted> {
  return request('/api/jobs/send', JobAcceptedSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(req),
  });
}

/**
 * Poll a job — `GET /api/jobs/:id`. Non-terminal states carry a
 * `Retry-After: <seconds>` header; only the integer-seconds form the node
 * emits is honoured (an HTTP-date or malformed value is ignored — the
 * poll loop has its own floor interval to fall back on).
 */
async function getJobWithRetry(id: string): Promise<JobPoll> {
  const { data, headers } = await requestWithHeaders(
    `/api/jobs/${encodeURIComponent(id)}`,
    JobStatusSchema,
  );
  const raw = headers.get('retry-after');
  let retryAfterMs: number | null = null;
  if (raw !== null) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) {
      retryAfterMs = secs * 1000;
    }
  }
  return { status: data, retryAfterMs };
}

/** Poll a job once — `GET /api/jobs/:id`. */
function getJob(id: string): Promise<JobStatus> {
  return getJobWithRetry(id).then((p) => p.status);
}

/**
 * Attach the wallet-signed commitment to a send job that is
 * `awaiting_signature` — `POST /api/jobs/:id/commit` → 200
 * `{status:"broadcasting"}`. Resolves once the node accepts the
 * commitment; the caller then polls the job to `completed`. The accept
 * body is a partial `JobStatus`, so it is parsed leniently.
 */
async function commitJob(id: string, req: CommitRequest): Promise<void> {
  await request(
    `/api/jobs/${encodeURIComponent(id)}/commit`,
    JobStatusSchema,
    {
      method: 'POST',
      body: JSON.stringify(req),
    },
    { lenient: true },
  );
}

/** `setTimeout`-based delay. */
function delay(ms: number): Promise<void> {
  /* c8 ignore next — delegates to a host timer, no logic to cover */
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a job until it reaches one of `stopAt` (always including the
 * terminal set). Respects the node's `Retry-After` backoff; throws
 * `JobFailedError` on `failed` / `cancelled` (no silent fallback).
 */
async function waitForJob(
  jobId: string,
  stopAt: ReadonlySet<JobStatus['status']>,
  opts: { onPhase?: (status: JobStatus) => void } = {},
): Promise<JobStatus> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastPhase: string | undefined;

  for (;;) {
    const { status: job, retryAfterMs } = await getJobWithRetry(jobId);

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
      throw new JobFailedError(jobId, job.status, `timed out after ${WAIT_TIMEOUT_MS}ms`);
    }

    await delay(Math.max(POLL_FLOOR_MS, retryAfterMs ?? 0));
  }
}

/**
 * Pull `account_state_hash` + `output_coins_root` off an
 * `awaiting_signature` send job so the wallet can sign the commitment.
 *
 * The node surfaces these on the job's `result` once it carries them
 * (node #195). If they are absent the commit cannot be built, and we
 * fail hard (no fabricated commitment): the only correct recovery is the
 * node populating them. The wallet deliberately does NOT decode the
 * binary CoinProof at `GET /api/proof/:id` — that is not a pure-TS path.
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

export const api = {
  // Low-level Jobs-API primitives — exposed for the E2E harness and
  // advanced callers. The high-level `mint` / `send` below compose them.
  newIdempotencyKey,
  mintJob,
  sendJob,
  getJob,
  waitForJob,
  commitJob,

  /**
   * Faucet / authorised mint. Server-mediated end-to-end: admit the job
   * (mandatory `Idempotency-Key`) and poll to `completed`. Throws
   * `JobFailedError` on a terminal `failed` / `cancelled`, `ApiError`
   * on a non-2xx admit (e.g. mainnet, where the faucet is not served).
   */
  mint: async (
    address: string,
    amount: number = 10_000,
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => {
    const accepted = await mintJob({ account_address: address, amount }, newIdempotencyKey());
    // `waitForJob` throws on failed/cancelled, so reaching here is `completed`.
    return waitForJob(accepted.job_id, TERMINAL_STATUSES, opts);
  },

  /**
   * Two-phase send. All steps server-mediated except the local signing:
   *
   *   1. Re-fetch balance — thin-client invariant — and hydrate the
   *      BIP-32 child index forward from the authoritative `num_sends`.
   *   2. Derive `public_key` at the index, `next_public_key` at index+1,
   *      and `prev_commitment_pubkey` at index-1 when the account has sent.
   *   3. Sign + admit the send job (`Idempotency-Key`).
   *   4. Poll to `awaiting_signature`.
   *   5. Read `account_state_hash` / `output_coins_root` from the job's
   *      `result` (JSON; no binary decode — hard-fail if absent).
   *   6. Build the commitment with the existing WASM and attach it.
   *   7. Poll to `completed`.
   *
   * Returns the completed send `JobStatus`. The caller advances its
   * local counter and re-syncs from `/api/balance` afterwards.
   */
  send: async (
    params: { account_address: string; recipient: string; amount: number; xpriv: string },
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => {
    // 1. Thin-client invariant — hydrate the derivation index from the
    // server's authoritative send counter before signing anything.
    const balance = await request(
      `/api/balance?address=${encodeURIComponent(params.account_address)}`,
      BalanceResponseSchema,
    );
    const numPubkeys = balance.num_sends;

    // 2. Derive the pubkey pair (+ prev pubkey) for this send.
    const wasm = await initWasm();
    const keys = wasm.derivePublicKeys(params.xpriv, numPubkeys);
    const prevPk =
      numPubkeys > 0 ? wasm.derivePublicKeys(params.xpriv, numPubkeys - 1).publicKey : undefined;

    // 3. Sign + admit.
    const signed = await signSendRequest(
      {
        account_address: params.account_address,
        recipient: params.recipient,
        amount: params.amount,
        public_key: keys.publicKey,
        next_public_key: keys.nextPublicKey,
        ...(prevPk !== undefined ? { prev_commitment_pubkey: prevPk } : {}),
      },
      params.xpriv,
      numPubkeys,
    );
    const accepted = await sendJob(signed, newIdempotencyKey());
    const jobId = accepted.job_id;

    // 4. Poll to `awaiting_signature` (or a terminal state — waitForJob
    // throws on failed/cancelled).
    const awaiting = await waitForJob(
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

    // 5. Read ash/ocr from the JSON result (hard-fail if absent).
    const { accountStateHash, outputCoinsRoot } = extractCommitInputs(awaiting, jobId);

    // 6. Build + attach the commitment. The WASM signs at the same index
    // the send was signed with; a mismatched index would surface as a
    // 401 "Commitment signature invalid" from the node.
    const commitment = wasm.createCommitment(
      params.xpriv,
      numPubkeys,
      accountStateHash,
      outputCoinsRoot,
    );
    await commitJob(jobId, {
      proof_id: proofId,
      public_key: commitment.publicKey,
      signature: commitment.signature,
      message: commitment.message,
    });

    // 7. Poll to `completed`.
    return waitForJob(jobId, TERMINAL_STATUSES, opts);
  },

  balance: (address: string) =>
    request(`/api/balance?address=${encodeURIComponent(address)}`, BalanceResponseSchema),

  info: () => request('/api/info', InfoResponseSchema),

  claimUsername: async (params: ClaimUsernameParams) => {
    const signed = await signClaimRequest(params);
    return request('/api/username/claim', ClaimUsernameResponseSchema, {
      method: 'POST',
      body: JSON.stringify({
        username: params.username,
        address: params.address,
        public_key: signed.public_key,
        signature: signed.signature,
        timestamp: signed.timestamp,
      }),
    });
  },

  resolveUsername: (username: string) =>
    request(`/api/username/resolve/${encodeURIComponent(username)}`, ResolveUsernameResponseSchema),
};
