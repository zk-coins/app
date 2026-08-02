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
  encodeHexLower,
  freshNpkRand,
  placeDeliveryCredential,
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

import { spendKeyAt, seedFromAccountMnemonic } from '@/lib/crypto/account-keys';
import { isV1Network, useNetworkStore } from '@/stores/network';

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

/** Terminal job failure (`failed` / `cancelled` / timeout). */
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
  /** Transition / record kind (`mint` | `send` | `receive` | record_type, …). */
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

export interface HistoryResponse {
  items: HistoryItem[];
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
  amount: number;
  mnemonic: string;
  /** 32-byte nk_commit hex — required for the ownership pull in the sign handshake. */
  nkCommit: string;
  /** Optional self-output only mint needs no delivery; third-party mint needs delivery. */
  delivery?: DeliveryCredential;
  /** Hex asset id for explicit output templates (mint to self uses zeros until node assigns). */
  asset_id?: string;
  accountIndex?: number;
}

export interface SendParams {
  account_address: string;
  /** Recipient Bech32m address (resolved from a name upstream). */
  recipient: string;
  amount: number;
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
  /** Account index under the BIP-43 purpose (default 0). */
  accountIndex?: number;
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
    throw new ApiError(err.status, err.machineCode, err.rawBody, err.machineCode);
  }
  if (err instanceof ApiError || err instanceof JobFailedError) {
    throw err;
  }
  if (err instanceof Error) {
    throw err;
  }
  throw new Error(String(err));
}

const TERMINAL: ReadonlySet<V1JobStatusValue> = new Set(['completed', 'failed', 'cancelled']);

const POLL_FLOOR_MS = 1_500;
const WAIT_TIMEOUT_MS = 180_000;

function delay(ms: number): Promise<void> {
  /* c8 ignore next — host timer */
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll a job until it hits `stopAt` or a terminal status. Honours
 * `Retry-After`. Throws {@link JobFailedError} on failed/cancelled/timeout.
 */
async function waitForJob(
  client: ZkCoinsV1Client,
  jobId: string,
  stopAt: ReadonlySet<V1JobStatusValue>,
  opts: { onPhase?: (status: V1Job) => void } = {},
): Promise<V1Job> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  let lastPhase: string | undefined;

  for (;;) {
    const { job, retryAfterMs } = await client.getJob(jobId);

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
    /* c8 ignore next 5 — deadline only on a stuck node */
    if (Date.now() >= deadline) {
      throw new JobFailedError(
        jobId,
        'failed',
        `timed out in ${job.status} after ${WAIT_TIMEOUT_MS}ms`,
      );
    }
    if (retryAfterMs === null) {
      throw new JobFailedError(
        jobId,
        'failed',
        `non-terminal status ${job.status} without Retry-After`,
      );
    }
    await delay(Math.max(POLL_FLOOR_MS, retryAfterMs));
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
  const accepted = await client.submitTransition(body, {
    idempotencyKey: newIdempotencyKey(),
    ...(opts.confirmPinMismatch !== undefined
      ? { confirmPinMismatch: opts.confirmPinMismatch }
      : {}),
    ...(opts.pinOnFirstUse !== undefined ? { pinOnFirstUse: opts.pinOnFirstUse } : {}),
  });
  const jobId = accepted.job_id;

  const awaiting = await client.waitForAwaitingSignature(jobId, {
    sleep: (ms) => delay(Math.max(POLL_FLOOR_MS, ms)),
  });
  if (opts.onPhase) opts.onPhase(awaiting);

  if (awaiting.status !== 'awaiting_signature') {
    if (awaiting.status === 'failed' || awaiting.status === 'cancelled') {
      throw new JobFailedError(
        jobId,
        awaiting.status,
        awaiting.error?.message ?? awaiting.error?.error,
      );
    }
    throw new JobFailedError(jobId, 'failed', `job ended in ${awaiting.status} before signature`);
  }
  if (!awaiting.awaiting_signature) {
    throw new JobFailedError(
      jobId,
      'failed',
      'awaiting_signature job did not carry awaiting_signature payload',
    );
  }

  // Ownership pull session → authoritative account head for key-binding check.
  const seed = seedFromAccountMnemonic(signing.mnemonic);
  const sk0 = spendKeyAt(signing.mnemonic, 0, signing.accountIndex);
  const nkCommitBytes = hexToBytesExact(signing.nkCommitHex, 32, 'nkCommit');
  const pull = await client.openOwnershipPullSession({
    subject: signing.subject,
    sk0: sk0.secretKey,
    nkCommit: nkCommitBytes,
  });
  const accountState = await client.getAccountState(pull.session);

  const sendCounter = awaiting.awaiting_signature.send_counter;
  const spend = spendKeyAt(signing.mnemonic, sendCounter, signing.accountIndex);
  const next = spendKeyAt(signing.mnemonic, sendCounter + 1, signing.accountIndex);
  // npk_rand must equal the value supplied on submit — recovered from the body.
  const npkRand = hexToBytesExact(body.npk_rand, 32, 'npk_rand');

  const nodeNetwork = client.network;
  await client.refuseOrSignAndSubmit({
    jobId,
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

  // Silence unused seed warning in case tree-shaking audits care.
  void seed;

  return waitForJob(client, jobId, TERMINAL, opts);
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
      return {
        ...info,
        capabilities: capabilitiesFromV1Features(info.features ?? []),
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
   */
  send: async (
    params: SendParams,
    opts: { onPhase?: (status: V1Job) => void } = {},
  ): Promise<V1Job> => {
    try {
      const client = v1Client();
      const accountIndex = params.accountIndex ?? 0;
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

      const amountStr = String(params.amount);
      const foreignOutput = placeDeliveryCredential(
        {
          recipient: params.recipient,
          asset_id: params.asset_id,
          amount: amountStr,
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
      const client = v1Client();
      const accountIndex = params.accountIndex ?? 0;
      const npkRand = freshNpkRand();

      let sendCounter = 0;
      try {
        const sk0 = spendKeyAt(params.mnemonic, 0, accountIndex);
        const pull = await client.openOwnershipPullSession({
          subject: params.account_address,
          sk0: sk0.secretKey,
          nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
        });
        const head = await client.getAccountState(pull.session);
        sendCounter = head.send_counter;
      } catch {
        // Brand-new account: counter stays 0.
        sendCounter = 0;
      }

      const next = spendKeyAt(params.mnemonic, sendCounter + 1, accountIndex);
      const assetId = params.asset_id ?? '00'.repeat(32);
      const amountStr = String(params.amount);

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
    amount: number = 10_000,
    opts: { onPhase?: (status: V1Job) => void } = {},
  ): Promise<V1Job> =>
    api.createCoin(
      {
        account_address: params.account_address,
        name: `FAUCET-${Date.now()}`,
        decimals: 0,
        amount,
        mnemonic: params.mnemonic,
        nkCommit: params.nkCommit,
      },
      opts,
    ),

  /**
   * Portfolio via ownership pull + account state. The v1 wire does not
   * expose a legacy portfolio route; balances live
   * inside `serialize(AccountState)`. Until a full AccountState decoder
   * ships in the app, this returns the head metadata with an empty asset
   * list when balances cannot be decoded — fail-closed for amounts (0),
   * never invents balances.
   */
  ownerBalances: async (address: string): Promise<OwnerBalanceResponse> => {
    // Without mnemonic/nkCommit the app cannot open a pull session.
    // Callers that only have an address get an empty portfolio rather than
    // a fabricated balance. Screens that need live balances pass through
    // accountState after unlock.
    void address;
    return { address, assets: [] };
  },

  /**
   * Authoritative account head (ownership pull). Requires signing material.
   */
  accountState: async (params: {
    address: string;
    mnemonic: string;
    nkCommit: string;
    accountIndex?: number;
  }): Promise<V1AccountState> => {
    try {
      const client = v1Client();
      const sk0 = spendKeyAt(params.mnemonic, 0, params.accountIndex ?? 0);
      const pull = await client.openOwnershipPullSession({
        subject: params.address,
        sk0: sk0.secretKey,
        nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
      });
      return await client.getAccountState(pull.session);
    } catch (err) {
      mapV1Error(err);
    }
  },

  /**
   * Single-asset balance helper. Without a full AccountState balances
   * decoder this returns `num_sends` from the head and balance `0` when
   * the head is available but balances are not decoded — never a silent
   * non-zero guess.
   */
  walletBalance: async (params: {
    address: string;
    mnemonic: string;
    nkCommit: string;
  }): Promise<BalanceResponse> => {
    try {
      const head = await api.accountState(params);
      return {
        balance: 0,
        num_sends: head.send_counter,
      };
    } catch (err) {
      mapV1Error(err);
    }
  },

  /** Per-asset balance — not available without AccountState decode; fail closed. */
  balance: async (_address: string, _assetId: string): Promise<BalanceResponse> => {
    throw new ApiError(
      501,
      'per-asset balance requires AccountState balances decode (not yet on the thin app surface)',
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
    },
    opts: { limit?: number; offset?: number } = {},
  ): Promise<HistoryResponse> => {
    try {
      const client = v1Client();
      const sk0 = spendKeyAt(params.mnemonic, 0, 0);
      const pull: V1PullResult = await client.openOwnershipPullSession({
        subject: params.address,
        sk0: sk0.secretKey,
        nkCommit: hexToBytesExact(params.nkCommit, 32, 'nkCommit'),
      });
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      const slice = pull.records.slice(offset, offset + limit);
      const items: HistoryItem[] = slice.map((r, i) => ({
        id: r.record_id,
        kind: r.transition_kind ?? r.record_type,
        status: 'completed',
        created_at: r.occurred_at,
        index: offset + i,
      }));
      return {
        items,
        total: pull.records.length,
        limit,
        offset,
      };
    } catch (err) {
      mapV1Error(err);
    }
  },

  getTransaction: async (
    id: number | string,
    params: { address: string; mnemonic: string; nkCommit: string },
  ): Promise<TxDetail> => {
    const history = await api.getHistory(params);
    const found = history.items.find((item) => String(item.id) === String(id));
    if (!found) {
      throw new ApiError(404, 'not_found');
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
