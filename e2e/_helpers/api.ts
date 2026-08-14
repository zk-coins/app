/**
 * SDK-backed v1 API client used by the E2E global setup and test helpers.
 *
 * All node traffic goes through `/v1/*` via `ZkCoinsV1Client`. Key material
 * is derived with the pure-TS v1 helpers (see `./keys.ts`) — the in-tree
 * WASM package is gone.
 *
 * ## Fixture mint
 *
 * Uses the same creator-signed mint handshake the app's `api.createCoin`
 * runs (`POST /v1/tx` kind=mint → await signature → ownership pull → sign).
 *
 * ## Portfolio / balance reads
 *
 * AccountState balances decode is not on the thin surface yet. Read
 * helpers refuse with a clear error rather than inventing an empty wallet.
 */

import {
  V1ApiError,
  ZkCoinsV1Client,
  deriveSpendKey,
  encodeHexLower,
  freshNpkRand,
  seedFromMnemonicV1,
  type Network,
  type TransitionRequest,
  type V1Info,
  type V1Job,
  type V1JobStatusValue,
} from '@zkcoins/sdk';
import { accountFromMnemonic } from './keys';

const API_URL = (process.env.E2E_API_URL ?? 'https://dev-api.zkcoins.app').replace(/\/+$/, '');

/** Default supply minted into a fixture wallet's own asset (wire digit string). */
const MINT_AMOUNT = '100000';
/** Decimals for the fixture asset (0 = whole units). */
const FIXTURE_DECIMALS = 0;

const POLL_FLOOR_MS = 2_000;
const WAIT_TIMEOUT_MS = 240_000;
const TERMINAL: ReadonlySet<V1JobStatusValue> = new Set(['completed', 'failed', 'cancelled']);

/** 4xx that prove the node refused the request before admitting a job. */
function isProvenPreAdmitRejection(err: unknown): boolean {
  if (!(err instanceof V1ApiError)) return false;
  return (
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 409 &&
    err.status !== 429
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error('delay: aborted'));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
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

function v1Client(network: Network): ZkCoinsV1Client {
  return new ZkCoinsV1Client({ apiUrl: API_URL, network });
}

/** Resolve network from /v1/info (required before signed calls). */
async function resolveNetwork(): Promise<Network> {
  const info = await api.info();
  const network = info.network as Network;
  if (network !== 'mainnet' && network !== 'testnet' && network !== 'regtest') {
    // Fail closed rather than inventing a network tag.
    // Note: CI nodes may report "signet" as a bitcoin network — v1 tags
    // are mainnet|testnet|regtest only; map signet → testnet is forbidden
    // here (no silent coercion). Surface the raw value so operators fix
    // the node advertisement.
    throw new Error(`e2e api: unsupported network from /v1/info: ${String(info.network)}`);
  }
  return network;
}

async function waitForJob(
  client: ZkCoinsV1Client,
  jobId: string,
  signal: AbortSignal,
  deadline: number,
): Promise<V1Job> {
  for (;;) {
    const { job, retryAfterMs } = await client.getJob(jobId, signal);
    if (job.status === 'failed' || job.status === 'cancelled') {
      const detail = job.error?.message ?? job.error?.error;
      if (detail === undefined || detail === '') {
        throw new Error(`job ${jobId} ${job.status}: error payload missing`);
      }
      throw new Error(`job ${jobId} ${job.status}: ${detail}`);
    }
    if (TERMINAL.has(job.status)) return job;
    if (Date.now() >= deadline || signal.aborted) {
      throw new Error(`job ${jobId} stuck at ${job.status}`);
    }
    if (retryAfterMs === null) {
      throw new Error(`job ${jobId} non-terminal ${job.status} without Retry-After`);
    }
    await delay(Math.max(POLL_FLOOR_MS, retryAfterMs), signal);
    if (signal.aborted) {
      throw new Error(`job ${jobId} stuck at ${job.status}`);
    }
  }
}

/** Per-`(owner, asset)` balance shape (multi-asset; mirrors the node). */
export interface AssetBalanceEntry {
  asset_id: string;
  name?: string;
  decimals?: number;
  balance: number;
  num_sends: number;
}
export interface OwnerBalance {
  address: string;
  username?: string;
  assets: AssetBalanceEntry[];
}

export const api = {
  info: async (): Promise<
    V1Info & { capabilities?: { multi_asset?: boolean; username_claim?: boolean } }
  > => {
    // Construction placeholder network — info is network-agnostic.
    const client = new ZkCoinsV1Client({ apiUrl: API_URL, network: 'regtest' });
    const info = await client.info();
    if (!Array.isArray(info.features)) {
      throw new Error('e2e api: features missing or not an array');
    }
    const features = new Set(info.features);
    return {
      ...info,
      capabilities: {
        multi_asset: true,
        username_claim: features.has('wallet'),
      },
    };
  },

  /**
   * Portfolio read — not available without AccountState balances decode.
   * Throws rather than inventing an empty wallet.
   */
  ownerBalances: async (_address: string): Promise<OwnerBalance> => {
    throw new Error(
      'e2e api: portfolio not available in this build — AccountState balances decode is not wired yet',
    );
  },

  /** Per-asset balance — same unavailability as portfolio. */
  walletBalance: async (
    _address: string,
    _assetId: string,
  ): Promise<{ balance: number; num_sends: number }> => {
    throw new Error(
      'e2e api: wallet balance not available in this build — AccountState balances decode is not wired yet',
    );
  },

  /** Derive the fixture account via pure-TS v1 keys (same as app onboarding). */
  account: async (mnemonic: string): Promise<{ address: string; nkCommit: string }> => {
    const keys = accountFromMnemonic(mnemonic);
    return { address: keys.address, nkCommit: keys.nkCommit };
  },

  /**
   * Creator-signed mint via `POST /v1/tx` kind=mint. Returns the minted
   * amount plus the wallet address so callers can track the fixture.
   * Does NOT poll portfolio (read path unavailable).
   *
   * Pre-sign transients may retry (same name). Once submitTransition has
   * returned, failures rethrow — never start a second mint handshake.
   */
  createCoin: async (
    mnemonic: string,
    opts: { name?: string; decimals?: number; amount?: string } = {},
  ): Promise<{ name: string; decimals: number; amount: string; address: string }> => {
    // Hoist once so pre-sign retries never invent a new random name.
    const name = opts.name ?? `E2E-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const decimals = opts.decimals ?? FIXTURE_DECIMALS;
    const amount = opts.amount !== undefined ? opts.amount : MINT_AMOUNT;
    if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) {
      throw new Error(
        `createCoin: amount must be a digit string, got ${String(amount)} ${JSON.stringify(amount)}`,
      );
    }

    const keys = accountFromMnemonic(mnemonic);
    const maxAttempts = 3;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let handshakeSubmitted = false;
      try {
        const network = await resolveNetwork();
        const client = v1Client(network);
        const seed = seedFromMnemonicV1(mnemonic);
        const npkRand = freshNpkRand();

        // One deadline/signal for the whole handshake — waitForJob reuses it.
        const deadline = Date.now() + WAIT_TIMEOUT_MS;
        const signal = AbortSignal.timeout(WAIT_TIMEOUT_MS);

        let sendCounter = 0;
        try {
          const sk0 = deriveSpendKey(seed, 0, 0);
          const pull = await client.openOwnershipPullSession(
            {
              subject: keys.address,
              sk0: sk0.secretKey,
              nkCommit: hexToBytesExact(keys.nkCommit, 32, 'nkCommit'),
            },
            signal,
          );
          const head = await client.getAccountState(pull.session, signal);
          sendCounter = head.send_counter;
        } catch (err) {
          // Only typed HTTP 404 + machineCode not_found means "account does not
          // exist yet". Network/auth/parse/5xx and untyped wrappers must abort
          // before /v1/tx — never invent sendCounter=0 for a live account.
          if (
            !(err instanceof V1ApiError) ||
            err.status !== 404 ||
            err.machineCode !== 'not_found'
          ) {
            throw err;
          }
          sendCounter = 0;
        }

        const next = deriveSpendKey(seed, 0, sendCounter + 1);
        const body: TransitionRequest = {
          kind: 'mint',
          subject: keys.address,
          next_pubkey: encodeHexLower(next.publicKey),
          npk_rand: encodeHexLower(npkRand),
          output_templates: [
            {
              recipient: keys.address,
              asset_id: '00'.repeat(32),
              amount,
            },
          ],
          issuance: {
            name,
            decimals,
            issuance_version: 1,
            amount,
            creator_pubkey: keys.pk0,
          },
        };

        const accepted = await client.submitTransition(body, {
          idempotencyKey: crypto.randomUUID(),
          signal,
        });
        // Transition admitted — do not retry as a new handshake from here on.
        handshakeSubmitted = true;
        const jobId = accepted.job_id;

        const awaiting = await client.waitForAwaitingSignature(jobId, {
          sleep: (ms) => delay(Math.max(POLL_FLOOR_MS, ms), signal),
          signal,
        });
        if (awaiting.status !== 'awaiting_signature' || !awaiting.awaiting_signature) {
          throw new Error(`createCoin: job ${jobId} ended in ${awaiting.status} before signature`);
        }

        let accountState: { current_pubkey: string; send_counter: number };
        try {
          const sk0 = deriveSpendKey(seed, 0, 0);
          const pull = await client.openOwnershipPullSession(
            {
              subject: keys.address,
              sk0: sk0.secretKey,
              nkCommit: hexToBytesExact(keys.nkCommit, 32, 'nkCommit'),
            },
            signal,
          );
          accountState = await client.getAccountState(pull.session, signal);
        } catch (err) {
          if (
            signal.aborted ||
            (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))
          ) {
            throw err;
          }
          if (
            !(err instanceof V1ApiError) ||
            err.status !== 404 ||
            err.machineCode !== 'not_found'
          ) {
            throw err;
          }
          const jobCounter = awaiting.awaiting_signature.send_counter;
          if (jobCounter !== 0) {
            throw new Error(
              `createCoin: account not found but job awaiting_signature.send_counter is ${jobCounter} (non-genesis); refusing to sign`,
            );
          }
          accountState = {
            send_counter: jobCounter,
            current_pubkey: keys.pk0, // already lowercase hex
          };
        }
        const sendCounterFromAwaiting = awaiting.awaiting_signature.send_counter;
        const spend = deriveSpendKey(seed, 0, sendCounterFromAwaiting);
        const nextAfter = deriveSpendKey(seed, 0, sendCounterFromAwaiting + 1);

        if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
        await client.refuseOrSignAndSubmit({
          jobId,
          localPubkey: spend.publicKey,
          secretKey: spend.secretKey,
          accountState: {
            current_pubkey: accountState.current_pubkey,
            send_counter: accountState.send_counter,
          },
          awaiting: awaiting.awaiting_signature,
          nextPubkey: nextAfter.publicKey,
          npkRand,
          nodeNetwork: client.network,
          signal,
        });

        await waitForJob(client, jobId, signal, deadline);
        return { name, decimals, amount, address: keys.address };
      } catch (err) {
        // Post-submit/post-sign: never start a brand-new mint.
        if (handshakeSubmitted) throw err;
        // Only proven pre-admit 4xx may retry; unsafe submit outcomes must not
        // mint again under a new idempotency key.
        if (!isProvenPreAdmitRejection(err)) throw err;
        lastErr = err;
        if (attempt >= maxAttempts) throw err;
        const wait = 1_000 * 2 ** (attempt - 1);
        console.warn(
          `createCoin: pre-sign failure (attempt ${attempt}/${maxAttempts}), retrying in ${wait}ms`,
        );
        await delay(wait);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  },
};

/**
 * Session-scoped cache for the server-reported `username_domain`.
 */
let cachedUsernameDomain: string | null = null;

export async function getUsernameDomain(): Promise<string> {
  if (cachedUsernameDomain !== null) return cachedUsernameDomain;
  const info = await api.info();
  const domain = (info as { username_domain?: string }).username_domain;
  if (!domain) {
    throw new Error(
      `api helper: /v1/info (${API_URL}) did not return username_domain. ` +
        'The frontend renders address chips as {8hex}@<username_domain> and the e2e ' +
        'helpers derive their locators from it.',
    );
  }
  cachedUsernameDomain = domain;
  return domain;
}

/**
 * Build the wallet-chip regex for a given username domain.
 */
export function zkAddressRegex(domain: string): RegExp {
  const escaped = domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`[0-9a-f]{8}@${escaped}`);
}
