/**
 * App API adapter — exclusive v1 surface via `@zkcoins/sdk` `ZkCoinsV1Client`.
 *
 * All node traffic goes through `/v1/*`. There is no legacy API client,
 * no in-tree WASM crypto, and no silent network fallback. Signing stays in
 * the app (custody); pre-sign refusals and delivery checks are SDK-side.
 */

import {
  V1ApiError,
  ZkCoinsV1Client,
  GENESIS_TAG,
  assetIdV1,
  digestToBytes,
  encodeHexLower,
  freshNpkRand,
  issueInvoice,
  placeDeliveryCredential,
  signBodyFromSignature,
  type DeliveryCredential,
  type Network,
  type TransitionRequest,
  type V1Info,
  type V1Job,
  type V1JobAccepted,
  type V1JobStatusValue,
  type V1AccountState,
  type V1PullResult,
} from '@zkcoins/sdk';

import { isV1Network, useNetworkStore } from '@/stores/network';
import {
  accountKeysFromMnemonic,
  invoiceKeysFromMnemonic,
  spendKeyAt,
} from '@/lib/crypto/account-keys';

// ---------------------------------------------------------------------------
// Error surface — keep names the rest of the app already imports.
// ---------------------------------------------------------------------------

/**
 * HTTP / wire error from a node call. Maps both the SDK legacy `ApiError`
 * shape and the v1 `V1ApiError` so existing `instanceof` / `userMessageFor`
 * call sites keep working.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly serverError?: string;
  readonly rawBody?: string;
  readonly code?: string;

  constructor(status: number, serverError?: string, rawBody?: string, code?: string) {
    super(serverError ?? `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.serverError = serverError;
    this.rawBody = rawBody;
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Terminal job failure (`failed` / `cancelled` / timeout / unknown). */
export class JobFailedError extends Error {
  readonly jobId: string;
  readonly status: string;
  readonly serverError?: string;

  constructor(jobId: string, status: string, serverError?: string) {
    super(serverError ?? `job ${jobId} ended in ${status}`);
    this.name = 'JobFailedError';
    this.jobId = jobId;
    this.status = status;
    this.serverError = serverError;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { V1ApiError };

// ---------------------------------------------------------------------------
// Wire / UI types (app-facing; keep prior names where screens depend on them)
// ---------------------------------------------------------------------------

export type JobStatusValue = V1JobStatusValue;
export type JobAccepted = V1JobAccepted;
export type JobStatus = V1Job;
export type InfoResponse = V1Info & {
  /** Optional operator display domain (not on the closed §7.5 core; ignored when absent). */
  username_domain?: string;
  capabilities?: Capabilities;
};

/** v1 closed feature strings (§6.1) plus legacy capability booleans for UI gates. */
export interface Capabilities {
  address_list: boolean;
  username_claim: boolean;
  lnurl: boolean;
  multi_asset: boolean;
}

export interface BalanceResponse {
  balance: number;
  username?: string;
  num_sends: number;
}

export interface AssetBalance {
  asset_id: string;
  name?: string;
  decimals?: number;
  balance: number;
  num_sends: number;
}

export interface OwnerBalanceResponse {
  address: string;
  username?: string;
  assets: AssetBalance[];
}

/**
 * Pull-session history row. Thin locator fields always present from
 * {@link api.getHistory}; richer display fields are optional and only set
 * when a fixture or a future decoder supplies them (never invented here).
 */
export interface HistoryItem {
  id: number | string;
  /** Adapter emits only `mint` or `unknown` (no owner-relative send/receive). */
  kind: string;
  amount?: number;
  asset_id?: string;
  counterparty?: string;
  status?: string;
  /** ISO-8601 or Unix seconds/ms from the pull locator. */
  created_at?: string | number;
  /** Optional on-chain commit reference when known. */
  txid?: string;
  block_height?: number;
  memo?: string;
  address?: string;
  balance_after?: number;
  balance_before?: number;
  num_sends_after?: number;
  commitment_public_key?: string;
  circuit_digest?: string;
  commit_output_value?: number;
}

/** Kinds emitted by the pull-history adapter (`getHistory`). */
export type PullHistoryKind = 'mint' | 'unknown';

/** History row as returned by {@link api.getHistory}. */
export interface PullHistoryItem extends Omit<HistoryItem, 'kind'> {
  kind: PullHistoryKind;
}

export interface HistoryResponse {
  items: PullHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface TxDetail extends HistoryItem {
  proof_id?: string | number;
}

/** Parse `created_at` (ISO string or Unix seconds/ms) into a Date. */
export function historyItemDate(item: Pick<HistoryItem, 'created_at'>): Date {
  const raw = item.created_at;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  if (typeof raw === 'string' && raw.length > 0) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum) && raw.trim() !== '' && !raw.includes('T') && !raw.includes('-')) {
      return new Date(asNum < 1e12 ? asNum * 1000 : asNum);
    }
    return new Date(raw);
  }
  return new Date(NaN);
}

export interface UsernameResponse {
  username: string;
  address: string;
}

export type ResolveUsernameResponse = UsernameResponse;
export type ClaimUsernameResponse = UsernameResponse;

export interface ClaimUsernameParams {
  username: string;
  address: string;
  /** BIP-39 mnemonic (replaces legacy xpriv). */
  mnemonic: string;
}

export interface CreateCoinParams {
  account_address: string;
  name: string;
  decimals: number;
  /** Decimal digit string in atomic units (arbitrary precision). Never converted through
   *  Number()/String(number). */
  amount: string;
  mnemonic: string;
  /** 32-byte nk_commit hex — required for the ownership pull in the sign handshake. */
  nkCommit: string;
  /** Optional self-output only mint needs no delivery; third-party mint needs delivery. */
  delivery?: DeliveryCredential;
  /** Hex asset id for explicit output templates (mint to self uses zeros until node assigns). */
  asset_id?: string;
  accountIndex: number;
}

export interface SendParams {
  account_address: string;
  /** Recipient Bech32m address (resolved from a name upstream). */
  recipient: string;
  /** Decimal digit string in atomic units (arbitrary precision). Never converted through
   *  Number()/String(number). */
  amount: string;
  asset_id: string;
  mnemonic: string;
  /** Required for every non-self output (§7.5 delivery presence rule). */
  delivery: DeliveryCredential;
  /** Coin identifiers spent as inputs (node-owned inventory). */
  input_coins: string[];
  /** Optional fee-less external publisher (§7.5 case (c)). */
  publisher_pubkey?: string;
  /** Explicit user confirmation after a §4.3 pin-mismatch warning. */
  confirmPinMismatch?: boolean;
  /** Record a pin on first successful credential verification. */
  pinOnFirstUse?: boolean;
  /** Account index under the BIP-43 purpose. */
  accountIndex: number;
  /** nk_commit hex for pull-session ownership proofs when needed. */
  nkCommit: string;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

function apiUrl(): string {
  return useNetworkStore.getState().apiUrl.replace(/\/+$/, '');
}

/**
 * Build a `ZkCoinsV1Client` for the configured node.
 * Requires a known v1 network tag — never invents one.
 */
function v1Client(networkOverride?: Network): ZkCoinsV1Client {
  const network = networkOverride ?? useNetworkStore.getState().network;
  if (!isV1Network(network)) {
    throw new ApiError(
      0,
      'network not resolved from GET /v1/info — refuse to call the node with an assumed network',
    );
  }
  return new ZkCoinsV1Client({ apiUrl: apiUrl(), network });
}

/** RFC-4122 v4 UUID for Idempotency-Key headers. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fail closed rather than inventing a weak id.
  throw new Error('newIdempotencyKey: crypto.randomUUID is unavailable');
}

function mapV1Error(err: unknown): never {
  if (err instanceof V1ApiError) {
    const prefix = `zkCoins v1 API error ${err.status} ${err.machineCode}: `;
    const human = err.message.slice(prefix.length);
    const serverError = human.length > 0 ? human : err.machineCode;
    throw new ApiError(err.status, serverError, err.rawBody, err.machineCode);
  }
  if (err instanceof ApiError || err instanceof JobFailedError) {
    throw err;
  }
  if (err instanceof Error) {
    throw err;
  }
  throw new Error(String(err));
}

function isMissingAccountStateMessage(message: string): boolean {
  return /no indexed AccountState|Account state unavailable/i.test(message);
}

/**
 * Closed v1 GetAccountState has no `not_found` in its reason allow-list, so a
 * never-minted subject arrives as HTTP 500 `internal_error`. Treat that as
 * genesis on createCoin pre-pull and on the sign-path rehydrate, but only
 * after the job's awaiting_signature.send_counter is checked (must be 0).
 */
function isClosedSurfaceMissingAccount(err: unknown): boolean {
  if (err instanceof V1ApiError) {
    return (
      err.status === 500 &&
      err.machineCode === 'internal_error' &&
      (isMissingAccountStateMessage(err.message) || /an internal error occurred/i.test(err.message))
    );
  }
  if (err instanceof ApiError) {
    return (
      err.status === 500 &&
      (isMissingAccountStateMessage(err.message) ||
        (err.code === 'internal_error' && /an internal error occurred/i.test(err.message)))
    );
  }
  return false;
}

/**
 * True only for an unambiguously typed "account does not exist yet" signal:
 * HTTP 404 with the generic `not_found` machine code. Other 404s (e.g.
 * `job_not_found`) and network/auth/parse/5xx failures must NOT be treated
 * as a new account with sendCounter=0 — that would risk a double-spend
 * nonce reuse. Create-coin pre-pull also accepts
 * {@link isClosedSurfaceMissingAccount} because GetAccountState has no
 * `not_found` on the closed surface.
 */
export function isAccountNotFoundError(err: unknown): boolean {
  if (err instanceof V1ApiError) {
    return err.status === 404 && err.machineCode === 'not_found';
  }
  if (err instanceof ApiError) {
    return err.status === 404 && err.code === 'not_found';
  }
  return false;
}

const TERMINAL: ReadonlySet<V1JobStatusValue> = new Set(['completed', 'failed', 'cancelled']);

const POLL_FLOOR_MS = 1_500;
const WAIT_TIMEOUT_MS = 180_000;
/** Prove + finalize after signature; local remint takes several minutes. */
const PROVE_TIMEOUT_MS = 900_000;
const MAX_POLL_SLEEP_MS = 600_000;

async function pollJobUntilAwaiting(
  client: ZkCoinsV1Client,
  jobId: string,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal,
  onPhase?: (status: V1Job) => void,
): Promise<V1Job> {
  const deadline = Date.now() + PROVE_TIMEOUT_MS;
  let last: V1Job | undefined;
  let lastPhase: string | undefined;
  while (Date.now() < deadline && !signal.aborted) {
    const { job } = await client.getJob(jobId, signal);
    last = job;
    const phase = job.phase ?? job.status;
    if (onPhase && phase !== lastPhase) {
      lastPhase = phase;
      onPhase({ ...job, phase });
    }
    if (job.status === 'awaiting_signature' || TERMINAL.has(job.status)) {
      return job;
    }
    await sleep(POLL_FLOOR_MS);
  }
  throw new JobFailedError(
    jobId,
    'timeout',
    `timed out waiting for awaiting_signature after ${PROVE_TIMEOUT_MS}ms` +
      (last ? ` (last status ${last.status})` : ''),
  );
}

/** Sleep that rejects on abort and always clears its timer. */
function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function cleanup() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal.removeEventListener('abort', onAbort);
    }
    function onAbort() {
      cleanup();
      reject(signal.reason instanceof Error ? signal.reason : new Error('abortableSleep: aborted'));
    }

    if (signal.aborted) {
      onAbort();
      return;
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Poll a job until it hits `stopAt` or a terminal status. Honours
 * `Retry-After`, caps sleep to the remaining deadline, and aborts both
 * `getJob` and sleep via the required shared deadline signal. Throws
 * {@link JobFailedError} on failed/cancelled/timeout.
 */
async function waitForJob(
  client: ZkCoinsV1Client,
  jobId: string,
  stopAt: ReadonlySet<V1JobStatusValue>,
  opts: { onPhase?: (status: V1Job) => void; signal: AbortSignal; deadline: number },
): Promise<V1Job> {
  // opts.deadline is the shared handshake start; opts.signal is the abort
  // authority (same AbortSignal.timeout from runTransitionHandshake).
  const deadlineSignal = opts.signal;
  let lastPhase: string | undefined;
  let lastStatus: V1JobStatusValue | undefined;

  for (;;) {
    const remaining = Math.max(0, opts.deadline - Date.now());
    if (remaining === 0) {
      throw new JobFailedError(
        jobId,
        'timeout',
        `timed out in ${lastStatus} after ${WAIT_TIMEOUT_MS}ms`,
      );
    }

    let job: V1Job;
    let retryAfterMs: number | null;
    try {
      ({ job, retryAfterMs } = await client.getJob(jobId, deadlineSignal));
    } catch (err) {
      if (err instanceof JobFailedError) {
        throw err;
      }
      if (isAbortLike(err, deadlineSignal)) {
        throw new JobFailedError(
          jobId,
          'timeout',
          `timed out in ${lastStatus} after ${WAIT_TIMEOUT_MS}ms`,
        );
      }
      throw err;
    }
    lastStatus = job.status;

    if (opts.onPhase && job.phase !== lastPhase) {
      lastPhase = job.phase;
      opts.onPhase(job);
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new JobFailedError(jobId, job.status, job.error?.message ?? job.error?.error);
    }
    if (stopAt.has(job.status)) {
      return job;
    }
    if (retryAfterMs === null) {
      // Closed API omits Retry-After on `accepted`/`proving`. Poll locally.
      retryAfterMs = POLL_FLOOR_MS;
    }

    const remainingForSleep = Math.max(0, opts.deadline - Date.now());
    if (remainingForSleep === 0) {
      throw new JobFailedError(
        jobId,
        'timeout',
        `timed out in ${lastStatus} after ${WAIT_TIMEOUT_MS}ms`,
      );
    }
    const sleepMs = Math.min(
      Math.max(POLL_FLOOR_MS, retryAfterMs),
      MAX_POLL_SLEEP_MS,
      remainingForSleep,
    );
    try {
      await abortableSleep(sleepMs, deadlineSignal);
    } catch (err) {
      /* v8 ignore next -- abortableSleep rejects only when deadlineSignal aborts */
      if (deadlineSignal.aborted) {
        throw new JobFailedError(
          jobId,
          'timeout',
          `timed out in ${lastStatus} after ${WAIT_TIMEOUT_MS}ms`,
        );
      }
      /* v8 ignore next -- abortableSleep rejects only via signal abort */
      throw err;
    }
  }
}

/** True when the handshake signal aborted or the SDK threw AbortError/TimeoutError. */
function isAbortLike(err: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted === true ||
    (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
  );
}

/** 4xx that prove the node refused the request before admitting a job. */
function isProvenPreAdmitRejection(err: unknown): boolean {
  const status =
    err instanceof V1ApiError ? err.status : err instanceof ApiError ? err.status : undefined;
  if (status === undefined) return false;
  return status >= 400 && status < 500 && status !== 408 && status !== 409 && status !== 429;
}

/**
 * Map handshake abort/deadline to JobFailedError(status: 'timeout').
 * Existing JobFailedError instances pass through unchanged.
 */
function mapHandshakeAbort(
  err: unknown,
  jobId: string,
  signal: AbortSignal,
  phase: 'submit' | 'rehydrate' | 'sign',
): never {
  if (err instanceof JobFailedError) {
    throw err;
  }
  if (isAbortLike(err, signal)) {
    throw new JobFailedError(
      jobId,
      'timeout',
      `timed out waiting for ${phase} after ${WAIT_TIMEOUT_MS}ms`,
    );
  }
  if (jobId === '' && isProvenPreAdmitRejection(err)) {
    throw err;
  }
  throw new JobFailedError(
    jobId,
    'unknown',
    'submit outcome unknown, do not retry as a new transition',
  );
}

/**
 * After signature submit was attempted, abort/timeout must not discard the job:
 * re-poll the same jobId with a fresh deadline until a terminal status is known.
 * Non-terminal failures surface as `unknown` so callers do not start a new mint.
 */
async function reconcileSignedJob(
  client: ZkCoinsV1Client,
  jobId: string,
  opts: { onPhase?: (status: V1Job) => void },
): Promise<V1Job> {
  const reconcileSignal = AbortSignal.timeout(PROVE_TIMEOUT_MS);
  const reconcileDeadline = Date.now() + PROVE_TIMEOUT_MS;
  try {
    return await waitForJob(client, jobId, TERMINAL, {
      ...opts,
      signal: reconcileSignal,
      deadline: reconcileDeadline,
    });
  } catch (err) {
    if (err instanceof JobFailedError && (err.status === 'failed' || err.status === 'cancelled')) {
      throw err;
    }
    throw new JobFailedError(
      jobId,
      'unknown',
      'signature submit outcome unknown, do not retry as a new transition',
    );
  }
}

/**
 * Full §7.5 handshake: submit → await signature → refuse-or-sign → POST /sign
 * → wait for terminal. Custody signature is produced only after SDK refusals.
 */
async function runTransitionHandshake(
  client: ZkCoinsV1Client,
  body: TransitionRequest,
  signing: {
    mnemonic: string;
    accountIndex: number;
    nkCommitHex: string;
    subject: string;
  },
  opts: {
    onPhase?: (status: V1Job) => void;
    confirmPinMismatch?: boolean;
    pinOnFirstUse?: boolean;
  } = {},
): Promise<V1Job> {
  const deadline = Date.now() + PROVE_TIMEOUT_MS;
  const signal = AbortSignal.timeout(PROVE_TIMEOUT_MS);
  const sleep = (ms: number): Promise<void> => {
    const remainingToDeadline = Math.max(0, deadline - Date.now());
    const capped = Math.min(Math.max(POLL_FLOOR_MS, ms), MAX_POLL_SLEEP_MS, remainingToDeadline);
    return abortableSleep(capped, signal);
  };

  // Key gen must stay outside the submit catch: missing UUID is pre-admit, not JobFailedError unknown.
  const idempotencyKey = (() => {
    try {
      return newIdempotencyKey();
    } catch (err) {
      throw new ApiError(0, err instanceof Error ? err.message : 'idempotency key unavailable');
    }
  })();

  let jobId = '';
  try {
    const accepted = await client.submitTransition(body, {
      idempotencyKey,
      signal,
      ...(opts.confirmPinMismatch !== undefined
        ? { confirmPinMismatch: opts.confirmPinMismatch }
        : {}),
      ...(opts.pinOnFirstUse !== undefined ? { pinOnFirstUse: opts.pinOnFirstUse } : {}),
    });
    jobId = accepted.job_id;
    if (opts.onPhase) {
      opts.onPhase({
        job_id: jobId,
        kind: body.kind,
        status: 'accepted',
        phase: 'accepted',
      } as V1Job);
    }
  } catch (err) {
    mapHandshakeAbort(err, jobId, signal, 'submit');
  }

  // Do not use SDK waitForAwaitingSignature: Retry-After: 0 on `accepted`
  // busy-loops and misses the awaiting_signature transition.
  let awaiting: V1Job;
  try {
    awaiting = await pollJobUntilAwaiting(client, jobId, sleep, signal, opts.onPhase);
  } catch (err) {
    if (err instanceof JobFailedError) {
      throw err;
    }
    if (isAbortLike(err, signal)) {
      throw new JobFailedError(
        jobId,
        'timeout',
        `timed out waiting for awaiting_signature after ${PROVE_TIMEOUT_MS}ms`,
      );
    }
    throw new JobFailedError(
      jobId,
      'unknown',
      'submit outcome unknown, do not retry as a new transition',
    );
  }
  if (opts.onPhase) opts.onPhase(awaiting);

  if (awaiting.status !== 'awaiting_signature') {
    if (awaiting.status === 'failed' || awaiting.status === 'cancelled') {
      throw new JobFailedError(
        jobId,
        awaiting.status,
        awaiting.error?.message ?? awaiting.error?.error,
      );
    }
    throw new JobFailedError(jobId, 'protocol', `job ended in ${awaiting.status} before signature`);
  }
  if (!awaiting.awaiting_signature) {
    throw new JobFailedError(
      jobId,
      'protocol',
      'awaiting_signature job did not carry awaiting_signature payload',
    );
  }

  // Authoritative account head for key-binding: always re-hydrate immediately
  // before sign. Typed account-404 + job counter 0 → Genesis from job field;
  // any other error aborts (including 404 with non-genesis job counter).
  let accountState: { current_pubkey: string; send_counter: number };
  try {
    const sk0 = spendKeyAt(signing.mnemonic, 0, signing.accountIndex);
    const nkCommitBytes = hexToBytesExact(signing.nkCommitHex, 32, 'nkCommit');
    const pull = await client.openOwnershipPullSession(
      {
        subject: signing.subject,
        sk0: sk0.secretKey,
        nkCommit: nkCommitBytes,
      },
      signal,
    );
    accountState = await client.getAccountState(pull.session, signal);
  } catch (err) {
    // Abort wins over 404-genesis: a deadline/abort must not fall through
    // isAccountNotFoundError into the genesis fallback.
    if (isAbortLike(err, signal)) {
      mapHandshakeAbort(err, jobId, signal, 'rehydrate');
    }
    if (!isAccountNotFoundError(err) && !isClosedSurfaceMissingAccount(err)) {
      mapHandshakeAbort(err, jobId, signal, 'rehydrate');
    }
    // Counter from the node job field — not a local invention.
    const jobCounter = awaiting.awaiting_signature.send_counter;
    if (jobCounter !== 0) {
      throw new JobFailedError(
        jobId,
        'protocol',
        `account not found but job awaiting_signature.send_counter is ${jobCounter} (non-genesis); refusing to sign`,
      );
    }
    accountState = {
      send_counter: jobCounter,
      current_pubkey: encodeHexLower(
        spendKeyAt(signing.mnemonic, 0, signing.accountIndex).publicKey,
      ),
    };
  }

  const sendCounter = awaiting.awaiting_signature.send_counter;
  const spend = spendKeyAt(signing.mnemonic, sendCounter, signing.accountIndex);
  const next = spendKeyAt(signing.mnemonic, sendCounter + 1, signing.accountIndex);
  // npk_rand must equal the value supplied on submit — recovered from the body.
  let npkRand: Uint8Array;
  try {
    npkRand = hexToBytesExact(body.npk_rand, 32, 'npk_rand');
  } catch (err) {
    throw new JobFailedError(jobId, 'protocol', (err as Error).message);
  }

  if (signal.aborted) {
    throw new JobFailedError(
      jobId,
      'timeout',
      `timed out waiting for sign after ${WAIT_TIMEOUT_MS}ms`,
    );
  }

  const nodeNetwork = client.network;
  let signature: ReturnType<ZkCoinsV1Client['signAwaiting']>;
  try {
    signature = client.signAwaiting({
      localPubkey: spend.publicKey,
      secretKey: spend.secretKey,
      accountState: {
        current_pubkey: accountState.current_pubkey,
        send_counter: accountState.send_counter,
      },
      awaiting: awaiting.awaiting_signature,
      nextPubkey: next.publicKey,
      npkRand,
      nodeNetwork,
    });
  } catch (err) {
    if (err instanceof JobFailedError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new JobFailedError(jobId, 'unknown', message);
  }
  try {
    await client.signJob(jobId, signBodyFromSignature(signature), signal);
  } catch {
    return reconcileSignedJob(client, jobId, opts);
  }
  return reconcileSignedJob(client, jobId, opts);
}

function hexToBytesExact(hex: string, len: number, label: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len * 2) {
    throw new Error(`${label}: expected ${len} bytes hex, got length ${hex.length}`);
  }
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Map closed v1 `features` strings into the UI capability booleans the
 * existing screens read. Multi-asset is always on in v1; username claim
 * is available when the node advertises `wallet`.
 */
export function capabilitiesFromV1Features(features: string[]): Capabilities {
  const set = new Set(features);
  return {
    address_list: set.has('explorer'),
    username_claim: set.has('wallet'),
    lnurl: set.has('lightning_bridge'),
    multi_asset: true,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const MAX_ISSUANCE_DECIMALS = 18;

export function isCanonicalIssuanceAmount(amount: string): boolean {
  return /^(0|[1-9][0-9]*)$/.test(amount) && amount !== '0';
}
export function parseIssuanceDecimals(raw: string): number | null {
  const dec = Number.parseInt(raw, 10);
  if (!Number.isInteger(dec) || dec < 0 || dec > MAX_ISSUANCE_DECIMALS) return null;
  return dec;
}

export const api = {
  newIdempotencyKey,

  /**
   * `GET /v1/info`. Does not require a pre-resolved network (the response
   * is what establishes it). Uses a temporary client with a placeholder
   * network only for construction — the request path is network-agnostic.
   */
  info: async (): Promise<InfoResponse> => {
    // ZkCoinsV1Client requires a network for signing; info itself does not.
    // Use regtest as a construction placeholder — never used for m_state here.
    const client = new ZkCoinsV1Client({ apiUrl: apiUrl(), network: 'regtest' });
    try {
      const info = await client.info();
      if (!Array.isArray(info.features)) {
        throw new Error('GET /v1/info: features missing or not an array');
      }
      return {
        ...info,
        capabilities: capabilitiesFromV1Features(info.features),
      };
    } catch (err) {
      mapV1Error(err);
    }
  },

  /** Low-level job poll. */
  getJob: async (id: string): Promise<V1Job> => {
    try {
      const { job } = await v1Client().getJob(id);
      return job;
    } catch (err) {
      mapV1Error(err);
    }
  },

  /**
   * Send with §7.5 delivery credential at output position 0 (and optional
   * change self-output without delivery). Signs via the custody handshake.
   *
   * Fail-closed when `input_coins` is empty: coin inventory selection is
   * not available on the thin app surface until AccountState coin decoding
   * ships. Never POST /v1/tx with an empty input list.
   */
  send: async (
    params: SendParams,
    opts: { onPhase?: (status: V1Job) => void } = {},
  ): Promise<V1Job> => {
    if (!Array.isArray(params.input_coins) || params.input_coins.length === 0) {
      throw new ApiError(
        501,
        'send not available yet — input coin selection requires AccountState coin inventory decode',
      );
    }
    if (typeof params.amount !== 'string' || !/^(0|[1-9][0-9]*)$/.test(params.amount)) {
      throw new Error(
        `send: amount must be a non-empty unsigned decimal digit string, got ${JSON.stringify(params.amount)}`,
      );
    }
    try {
      const client = v1Client();
      const accountIndex = params.accountIndex;
      const npkRand = freshNpkRand();
      // send_counter comes from the authoritative head after pull; for the
      // request we still need next_pubkey at counter+1. Hydrate counter from
      // a pull session first.
      const sk0 = spendKeyAt(params.mnemonic, 0, accountIndex);
      const nkCommitBytes = hexToBytesExact(params.nkCommit, 32, 'nkCommit');
      const pull = await client.openOwnershipPullSession({
        subject: params.account_address,
        sk0: sk0.secretKey,
        nkCommit: nkCommitBytes,
      });
      const head = await client.getAccountState(pull.session);
      const sendCounter = head.send_counter;
      const next = spendKeyAt(params.mnemonic, sendCounter + 1, accountIndex);

      const foreignOutput = placeDeliveryCredential(
        {
          recipient: params.recipient,
          asset_id: params.asset_id,
          amount: params.amount,
        },
        params.delivery,
        {
          network: client.network,
          pinStore: client.pinStore,
          ...(params.confirmPinMismatch !== undefined
            ? { confirmPinMismatch: params.confirmPinMismatch }
            : {}),
          ...(params.pinOnFirstUse !== undefined ? { pinOnFirstUse: params.pinOnFirstUse } : {}),
        },
      );

      const body: TransitionRequest = {
        kind: 'send',
        subject: params.account_address,
        next_pubkey: encodeHexLower(next.publicKey),
        npk_rand: encodeHexLower(npkRand),
        input_coins: params.input_coins,
        output_templates: [foreignOutput],
        ...(params.publisher_pubkey !== undefined
          ? { publisher_pubkey: params.publisher_pubkey }
          : {}),
      };

      return await runTransitionHandshake(
        client,
        body,
        {
          mnemonic: params.mnemonic,
          accountIndex,
          nkCommitHex: params.nkCommit,
          subject: params.account_address,
        },
        {
          ...opts,
          ...(params.confirmPinMismatch !== undefined
            ? { confirmPinMismatch: params.confirmPinMismatch }
            : {}),
          ...(params.pinOnFirstUse !== undefined ? { pinOnFirstUse: params.pinOnFirstUse } : {}),
        },
      );
    } catch (err) {
      mapV1Error(err);
    }
  },

  /**
   * Single-asset send surface — same v1 path as {@link api.send}.
   * Callers must supply delivery + input_coins (no legacy hex-only recipient).
   */
  walletSend: async (
    params: SendParams,
    opts: { onPhase?: (status: V1Job) => void } = {},
  ): Promise<V1Job> => api.send(params, opts),

  /**
   * Creator-signed mint via `POST /v1/tx` kind=mint. Self-output may omit
   * delivery; third-party outputs require a credential.
   */
  createCoin: async (
    params: CreateCoinParams,
    opts: { onPhase?: (status: V1Job) => void } = {},
  ): Promise<V1Job> => {
    try {
      if (typeof params.name !== 'string' || params.name.trim() === '') {
        throw new Error(
          `createCoin: name must be a non-empty string, got ${JSON.stringify(params.name)}`,
        );
      }
      if (
        !Number.isInteger(params.decimals) ||
        params.decimals < 0 ||
        params.decimals > MAX_ISSUANCE_DECIMALS
      ) {
        throw new Error(
          `createCoin: decimals must be an integer in 0..18, got ${JSON.stringify(params.decimals)}`,
        );
      }
      if (typeof params.amount !== 'string' || !isCanonicalIssuanceAmount(params.amount)) {
        throw new Error(
          `createCoin: amount must be a positive unsigned decimal digit string, got ${JSON.stringify(params.amount)}`,
        );
      }
      const amountStr = params.amount;

      const client = v1Client();
      const accountIndex = params.accountIndex;
      const npkRand = freshNpkRand();

      // Pre-pull only seeds next_pubkey / request sendCounter. The sign path
      // re-hydrates the head itself immediately before refuse-or-sign.
      let sendCounter: number;
      try {
        const sk0 = spendKeyAt(params.mnemonic, 0, accountIndex);
        const pull = await client.openOwnershipPullSession({
          subject: params.account_address,
          sk0: sk0.secretKey,
          nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
        });
        const head = await client.getAccountState(pull.session);
        sendCounter = head.send_counter;
      } catch (err) {
        // Node 404 = no account. sendCounter 0 only derives next_pubkey for the mint
        // request (protocol genesis). Signing still requires awaiting.send_counter === 0.
        // Other pre-pull failures wrap as ApiError so page-lock unlocks (ApiError = unlock).
        if (isAccountNotFoundError(err) || isClosedSurfaceMissingAccount(err)) {
          sendCounter = 0;
        } else if (err instanceof ApiError) {
          throw err;
        } else if (err instanceof V1ApiError) {
          mapV1Error(err);
        } else if (err instanceof JobFailedError) {
          throw err;
        } else if (err instanceof Error) {
          throw new ApiError(0, err.message);
        } else {
          throw new ApiError(0, String(err));
        }
      }

      const next = spendKeyAt(params.mnemonic, sendCounter + 1, accountIndex);
      const derived = accountKeysFromMnemonic(params.mnemonic, accountIndex);
      const nameHash = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(params.name.trim())),
      );
      const computedAssetId = encodeHexLower(
        digestToBytes(
          assetIdV1(
            GENESIS_TAG,
            spendKeyAt(params.mnemonic, 0, accountIndex).publicKey,
            nameHash,
            params.decimals,
            1,
          ),
        ),
      );
      const assetId = params.asset_id ?? computedAssetId;

      let output = {
        recipient: params.account_address,
        asset_id: assetId,
        amount: amountStr,
      } as {
        recipient: string;
        asset_id: string;
        amount: string;
        delivery?: DeliveryCredential;
      };
      if (params.delivery) {
        output = placeDeliveryCredential(output, params.delivery, {
          network: client.network,
          pinStore: client.pinStore,
        });
      } else if (derived.address === params.account_address) {
        const info = await client.info();
        const relayRaw = (info as unknown as { relay_url?: unknown }).relay_url;
        const relayUrl = typeof relayRaw === 'string' ? relayRaw : '';
        if (!relayUrl.startsWith('ws://') && !relayUrl.startsWith('wss://')) {
          throw new ApiError(0, 'createCoin: GET /v1/info.relay_url missing or not a ws URL');
        }
        const invoiceKeys = invoiceKeysFromMnemonic(params.mnemonic, accountIndex);
        const selfInvoice = await issueInvoice({
          amount: amountStr,
          assetId,
          relays: [relayUrl.endsWith('/') ? relayUrl : `${relayUrl}/`],
          sk0Secret: invoiceKeys.sk0Secret,
          nkCommit: invoiceKeys.nkCommit,
          ivpk: invoiceKeys.ivpk,
          opSecret: invoiceKeys.opSecret,
        });
        output = placeDeliveryCredential(
          output,
          { type: 'invoice', invoice: selfInvoice },
          { network: client.network, pinStore: client.pinStore },
        );
      }

      const body: TransitionRequest = {
        kind: 'mint',
        subject: params.account_address,
        next_pubkey: encodeHexLower(next.publicKey),
        npk_rand: encodeHexLower(npkRand),
        output_templates: [output],
        issuance: {
          name: params.name,
          decimals: params.decimals,
          issuance_version: 1,
          amount: amountStr,
          creator_pubkey: encodeHexLower(spendKeyAt(params.mnemonic, 0, accountIndex).publicKey),
        },
      };

      return await runTransitionHandshake(
        client,
        body,
        {
          mnemonic: params.mnemonic,
          accountIndex,
          nkCommitHex: params.nkCommit,
          subject: params.account_address,
        },
        opts,
      );
    } catch (err) {
      mapV1Error(err);
    }
  },

  /** Faucet-style self-mint on non-mainnet. */
  mint: async (
    params: {
      account_address: string;
      mnemonic: string;
      nkCommit: string;
    },
    amount: string,
    opts?: { onPhase?: (status: V1Job) => void },
  ): Promise<V1Job> =>
    api.createCoin(
      {
        account_address: params.account_address,
        name: `FAUCET-${Date.now()}`,
        decimals: 0,
        amount,
        mnemonic: params.mnemonic,
        nkCommit: params.nkCommit,
        accountIndex: 0,
      },
      opts,
    ),

  /**
   * Portfolio via ownership pull + account state. Balances live inside
   * `serialize(AccountState)`. Until a full AccountState balances decoder
   * ships in the app, refuse rather than inventing an empty wallet.
   * Empty `assets: []` would look like a funded wallet with nothing in it
   * — that is a silent falsehood and is not returned here.
   */
  ownerBalances: async (_address: string): Promise<OwnerBalanceResponse> => {
    throw new ApiError(
      501,
      'portfolio not available in this build — AccountState balances decode is not wired yet',
    );
  },

  /**
   * Authoritative account head (ownership pull). Requires signing material.
   * Exposes send_counter / current_pubkey only — not coin balances.
   */
  accountState: async (
    params: {
      address: string;
      mnemonic: string;
      nkCommit: string;
      accountIndex: number;
    },
    opts?: { signal?: AbortSignal },
  ): Promise<V1AccountState> => {
    try {
      const client = v1Client();
      const sk0 = spendKeyAt(params.mnemonic, 0, params.accountIndex);
      const pull = await client.openOwnershipPullSession(
        {
          subject: params.address,
          sk0: sk0.secretKey,
          nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
        },
        opts?.signal,
      );
      return await client.getAccountState(pull.session, opts?.signal);
    } catch (err) {
      mapV1Error(err);
    }
  },

  /**
   * Single-asset balance helper. Without a full AccountState balances
   * decoder this refuses rather than returning balance `0` (which would
   * look like an empty wallet). Callers that only need `send_counter`
   * must use {@link api.accountState}.
   */
  walletBalance: async (_params: {
    address: string;
    mnemonic: string;
    nkCommit: string;
  }): Promise<BalanceResponse> => {
    throw new ApiError(
      501,
      'wallet balance not available in this build — AccountState balances decode is not wired yet',
    );
  },

  /** Per-asset balance — not available without AccountState decode; fail closed. */
  balance: async (_address: string, _assetId: string): Promise<BalanceResponse> => {
    throw new ApiError(
      501,
      'per-asset balance not available in this build — AccountState balances decode is not wired yet',
    );
  },

  /**
   * History from pull records. Maps Private record refs into the UI list
   * shape; amounts are not in the locator and stay absent (thin client —
   * full plaintext is node-side after decrypt).
   */
  getHistory: async (
    params: {
      address: string;
      mnemonic: string;
      nkCommit: string;
      accountIndex: number;
    },
    opts: { limit?: number; offset?: number; signal?: AbortSignal } = {},
  ): Promise<HistoryResponse> => {
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    try {
      const client = v1Client();
      const sk0 = spendKeyAt(params.mnemonic, 0, params.accountIndex);
      const pull: V1PullResult = await client.openOwnershipPullSession(
        {
          subject: params.address,
          sk0: sk0.secretKey,
          nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
        },
        opts.signal,
      );
      const slice = pull.records.slice(offset, offset + limit);
      const items: PullHistoryItem[] = slice.map((r) => ({
        id: r.record_id,
        kind: r.transition_kind === 'mint' ? 'mint' : 'unknown',
        created_at: r.occurred_at,
      }));
      return {
        items,
        total: pull.records.length,
        limit,
        offset,
      };
    } catch (err) {
      if (isAccountNotFoundError(err)) {
        return { items: [], total: 0, limit, offset };
      }
      mapV1Error(err);
    }
  },

  getTransaction: async (
    id: number | string,
    params: { address: string; mnemonic: string; nkCommit: string; accountIndex: number },
    opts?: { signal?: AbortSignal },
  ): Promise<TxDetail> => {
    // pull.records is already fully resident after a single pull session —
    // request everything so a deep link past the default page size never
    // false-404s.
    const history = await api.getHistory(params, {
      limit: Number.MAX_SAFE_INTEGER,
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    });
    const found = history.items.find((item) => String(item.id) === String(id));
    if (!found) {
      throw new ApiError(404, 'transaction not found', undefined, 'transaction_not_found');
    }
    return found;
  },

  /**
   * Name resolution is NIP-05 / name-provider owned (§4.3), not a closed
   * `/v1` REST route. The thin app refuses to invent a resolver that
   * hits a legacy username route. Call sites that still need resolution
   * must supply a resolved delivery credential (invoice) or a contact pin.
   */
  resolveUsername: async (_username: string): Promise<ResolveUsernameResponse> => {
    throw new ApiError(
      501,
      'name resolution is not a /v1 REST route — pay from a name via NIP-05/name provider or an Invoice',
    );
  },

  /**
   * Name claim / issuance is API+name-provider owned. The app produces
   * `name_sig` when a full name-setup flow is wired; until then refuse.
   */
  claimUsername: async (_params: ClaimUsernameParams): Promise<ClaimUsernameResponse> => {
    throw new ApiError(
      501,
      'name claim is not wired on the closed /v1 surface yet — setup must verify NIP-05 resolution before complete',
    );
  },

  /**
   * Place a delivery credential on an output template at position `index`
   * in a templates array (position binding is normative §7.5).
   */
  placeDeliveryAt(
    outputTemplates: Array<{ recipient: string; asset_id: string; amount: string }>,
    index: number,
    delivery: DeliveryCredential,
    network: Network,
  ): Array<{
    recipient: string;
    asset_id: string;
    amount: string;
    delivery?: DeliveryCredential;
  }> {
    if (!Number.isInteger(index) || index < 0 || index >= outputTemplates.length) {
      throw new Error(
        `placeDeliveryAt: index ${index} out of range for ${outputTemplates.length} outputs`,
      );
    }
    const client = new ZkCoinsV1Client({ apiUrl: apiUrl(), network });
    const placed = placeDeliveryCredential(outputTemplates[index]!, delivery, {
      network,
      pinStore: client.pinStore,
    });
    return outputTemplates.map((tpl, i) => (i === index ? placed : { ...tpl }));
  },
};
