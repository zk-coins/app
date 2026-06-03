/**
 * App-side API adapter over `@zkcoins/sdk`.
 *
 * The app no longer speaks HTTP directly: every `/api/*` round-trip goes
 * through the SDK's `ZkCoinsClient`. This module is a thin adapter that
 *
 *   1. instantiates a `ZkCoinsClient` pointed at the app-configured
 *      `apiUrl` (from `useNetworkStore`), and
 *   2. composes the SDK's REST primitives with the app's WASM crypto for
 *      the two local-signing steps (send + username claim).
 *
 * ## Crypto choice — WASM stays, REST moves to the SDK
 *
 * The SDK ships pure-TS (@noble) crypto that is byte-equivalent to the
 * Rust WASM module (asserted by the SDK's `test/cross-rust` suite). The
 * app keeps using its existing `@zkcoins/wasm` for the local signing
 * steps — account creation, Schnorr signing, BIP-32 derivation, and the
 * commitment build — because that is the code path the browser bundle
 * and the Playwright E2E suite already exercise end-to-end against a
 * real node. Moving only the REST layer onto the SDK is the
 * minimal-invasive change that satisfies "no direct API calls" while
 * keeping the send/commit correctness guarantees (Schnorr determinism,
 * message-byte layout, the index the send was signed at) untouched.
 *
 * The message-byte layout for the signed requests comes from the SDK's
 * `buildSendMessage` / `buildClaimMessage` — the canonical mirror of the
 * node's construction — so even the pre-hash bytes are sourced from the
 * SDK rather than re-implemented here.
 *
 * ## No-fallback contract
 *
 * `extractCommitInputs` hard-fails if the `awaiting_signature` job does
 * not surface `account_state_hash` / `output_coins_root` as JSON (node
 * #195) — the wallet never fabricates a commitment and never decodes the
 * binary CoinProof. `waitForJob` (in the SDK) throws on a terminal
 * `failed` / `cancelled` rather than returning a non-completed status.
 */

import {
  ZkCoinsClient,
  newIdempotencyKey,
  buildSendMessage,
  buildClaimMessage,
  ApiError,
  JobFailedError,
  type JobStatus,
  type JobAccepted,
  type BalanceResponse,
  type InfoResponse,
  type UsernameResponse,
  type ResolveUsernameResponse,
  type ClaimUsernameResponse,
  type SignedSendRequest,
  type CommitRequest,
} from '@zkcoins/sdk';

import { useNetworkStore } from '@/stores/network';
import { initWasm } from '@zkcoins/wasm';

// Re-export the SDK error classes + the wire types under the names the
// app's call-sites and tests already import. `ApiError` / `JobFailedError`
// keep flowing through `userMessageFor` (see `./errorMessages.ts`) and the
// `instanceof` checks in the send page / wallet screen unchanged.
export { ApiError, JobFailedError, newIdempotencyKey };
export type {
  JobStatus,
  JobAccepted,
  BalanceResponse,
  InfoResponse,
  UsernameResponse,
  ResolveUsernameResponse,
  ClaimUsernameResponse,
};

/**
 * Build a `ZkCoinsClient` pointed at the currently-configured node URL.
 *
 * The app lets the user switch nodes at runtime (the thin-client escape
 * hatch — see `CONTRIBUTING.md`), so the URL is read from the store on
 * every call rather than captured once. Constructing a client is cheap
 * (no network, no state) so this is not a hot-path concern.
 */
function client(): ZkCoinsClient {
  return new ZkCoinsClient({ apiUrl: useNetworkStore.getState().apiUrl });
}

const TERMINAL_STATUSES: ReadonlySet<JobStatus['status']> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

/** Inputs to a mint job. */
export interface MintRequest {
  account_address: string;
  amount: number;
}

/** Inputs to a send job, before signing. */
export interface SendRequest {
  account_address: string;
  recipient: string;
  amount: number;
  public_key: string;
  next_public_key: string;
  prev_commitment_pubkey?: string;
}

/** Inputs to a username claim (xpriv signs locally; never leaves the device). */
export interface ClaimUsernameParams {
  username: string;
  address: string;
  xpriv: string;
}

/**
 * SHA-256 a message and return the hex digest, using the same WebCrypto
 * path the WASM signer expects as input.
 */
async function sha256Hex(message: Uint8Array): Promise<string> {
  // Copy into a fresh, ArrayBuffer-backed view so the WebCrypto
  // `BufferSource` typing is satisfied (the SDK's message builders
  // return a generic `Uint8Array<ArrayBufferLike>`).
  const bytes = new Uint8Array(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign a send request with Schnorr (WASM) over the SDK-built message.
 * Message layout = `buildSendMessage` (SDK), hashed with SHA-256, signed
 * at the BIP-32 child index `numPubkeys`.
 */
async function signSendRequest(
  data: SendRequest,
  xpriv: string,
  numPubkeys: number,
): Promise<SignedSendRequest> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = buildSendMessage({
    accountAddress: data.account_address,
    recipient: data.recipient,
    amount: data.amount,
    timestamp,
  });
  const hashHex = await sha256Hex(message);

  const wasm = await initWasm();
  const signingKey = wasm.deriveSigningKey(xpriv, numPubkeys);
  const signature = wasm.signSchnorr(signingKey, hashHex);

  return { ...data, signature, timestamp };
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

  mintJob: (req: MintRequest, idempotencyKey: string): Promise<JobAccepted> =>
    client().mintJob(req, idempotencyKey),

  sendJob: (req: SignedSendRequest, idempotencyKey: string): Promise<JobAccepted> =>
    client().sendJob(req, idempotencyKey),

  getJob: (id: string): Promise<JobStatus> => client().getJob(id),

  commitJob: (id: string, req: CommitRequest): Promise<void> => client().commitJob(id, req),

  /**
   * Poll a job until it reaches one of `stopAt` (always including the
   * terminal set). Delegates to the SDK's `waitForJob`, which respects
   * the node's `Retry-After` backoff and throws `JobFailedError` on
   * `failed` / `cancelled`. A standalone `ZkCoinsAccount` is not needed
   * for the poll loop, so this reuses the client-level wait via a
   * throwaway account-less helper on the SDK client.
   */
  waitForJob: (
    jobId: string,
    stopAt: ReadonlySet<JobStatus['status']>,
    opts: { onPhase?: (status: JobStatus) => void } = {},
  ): Promise<JobStatus> => waitForJob(client(), jobId, stopAt, opts),

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
    const c = client();
    const accepted = await c.mintJob({ account_address: address, amount }, newIdempotencyKey());
    // `waitForJob` throws on failed/cancelled, so reaching here is `completed`.
    return waitForJob(c, accepted.job_id, TERMINAL_STATUSES, opts);
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
    const c = client();

    // 1. Thin-client invariant — hydrate the derivation index from the
    // server's authoritative send counter before signing anything.
    const balance = await c.balance(params.account_address);
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
    const accepted = await c.sendJob(signed, newIdempotencyKey());
    const jobId = accepted.job_id;

    // 4. Poll to `awaiting_signature` (or a terminal state — waitForJob
    // throws on failed/cancelled).
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
    await c.commitJob(jobId, {
      proof_id: proofId,
      public_key: commitment.publicKey,
      signature: commitment.signature,
      message: commitment.message,
    });

    // 7. Poll to `completed`.
    return waitForJob(c, jobId, TERMINAL_STATUSES, opts);
  },

  balance: (address: string): Promise<BalanceResponse> => client().balance(address),

  info: (): Promise<InfoResponse> => client().info(),

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
 * `getJobWithRetry`. Mirrors `ZkCoinsAccount.waitForJob` but operates on
 * a bare `ZkCoinsClient` (the app composes the lifecycle itself so its
 * WASM signs the commitment — it does not derive a full
 * `ZkCoinsAccount`). Respects the node's `Retry-After` backoff and
 * throws `JobFailedError` on `failed` / `cancelled` (no silent fallback).
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

// Poll loop defaults for `waitForJob`. The node attaches
// `Retry-After: 2` on every non-terminal poll; `POLL_FLOOR_MS` is the
// fallback when the header is absent (or unparseable), `WAIT_TIMEOUT_MS`
// the hard ceiling for the whole wait (proof gen + broadcast).
const POLL_FLOOR_MS = 1_500;
const WAIT_TIMEOUT_MS = 180_000; // 3 minutes

/** `setTimeout`-based delay. */
function delay(ms: number): Promise<void> {
  /* c8 ignore next — delegates to a host timer, no logic to cover */
  return new Promise((resolve) => setTimeout(resolve, ms));
}
