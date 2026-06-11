/**
 * SDK-backed API client used by the E2E global setup and test helpers.
 *
 * The app consumes `@zkcoins/sdk` for node traffic; the harness does the
 * same so the test-side and app-side wire contracts cannot drift. The
 * helpers touch the unsigned read endpoints directly (info, per-asset
 * balance, portfolio) and drive the creator-signed **create-coin** flow to
 * seed fixtures.
 *
 * ## Create-coin / mint (neutral multi-asset model)
 *
 * There is no faucet under the neutral multi-asset model — funding a
 * fixture wallet means that wallet creating its own asset. So the harness
 * runs the same two-phase, creator-signed mint the app's `createCoin`
 * runs, using the app's own `@zkcoins/wasm` crypto primitives (BIP-32
 * derivation, Schnorr signing, commitment build) plus a local
 * `buildMintMessage` (the installed SDK predates the multi-asset message
 * layout):
 *
 * Crypto MUST go through the wasm, not `@zkcoins/sdk`: the node credits the
 * mint to `owner = Poseidon(creator_pubkey)` and serves the portfolio under
 * that Poseidon address — which is exactly the wallet address the wasm
 * derives (`H(pubkey_0)`). Deriving the fixture account through the wasm is
 * what makes `ownerBalances(account.address)` observe the mint; the SDK's
 * `sha256(pubkey_0)` address is a different, unobserved value (see
 * `_helpers/wasm.ts`).
 *
 *   1. Derive the creator identity key (index 0) from the mnemonic; sign
 *      `SHA256(creator_pubkey ‖ name ‖ [decimals] ‖ amount_le ‖ ts_le)`.
 *   2. `POST /api/jobs/mint` (mandatory `Idempotency-Key`); poll to
 *      `awaiting_signature`.
 *   3. Build the commitment over `account_state_hash ‖ output_coins_root`
 *      with the SAME creator key (index 0); `POST /api/jobs/:id/commit`.
 *   4. Poll to `completed`.
 *
 * Targets `process.env.E2E_API_URL` (default: dev-api.zkcoins.app).
 */

import { createHash } from 'node:crypto';
import {
  ZkCoinsClient,
  newIdempotencyKey,
  type BalanceResponse,
  type InfoResponse,
} from '@zkcoins/sdk';
import { loadWasm } from './wasm';

const API_URL = (process.env.E2E_API_URL ?? 'https://dev-api.zkcoins.app').replace(/\/+$/, '');

/** A `ZkCoinsClient` pointed at the configured E2E API URL. */
const sdkClient = new ZkCoinsClient({ apiUrl: API_URL });

/** Default supply minted into a fixture wallet's own asset. */
const MINT_AMOUNT = 100_000;
/** Decimals for the fixture asset (0 = whole units). */
const FIXTURE_DECIMALS = 0;

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
  info: (): Promise<InfoResponse> => sdkClient.info(),

  /** The owner's cross-asset portfolio — `GET /api/balance/:address`. */
  ownerBalances: (address: string): Promise<OwnerBalance> =>
    getJson<OwnerBalance>(`/api/balance/${encodeURIComponent(address)}`),

  /**
   * Single-asset balance — `GET /api/balance?address=` (no `asset_id`).
   * This is the EXACT read the single-asset UI performs, so the FALSE
   * (single-asset) globalSetup leg polls it to observe what the app will
   * observe. The multi-asset node itself 422s the parameterless form
   * (`asset_id` is required — there is no native asset); on the
   * single-asset leg the request goes through the CI info-proxy, which
   * translates it into a `GET /api/balance/:address` portfolio aggregate
   * (see `scripts/e2e-info-proxy.mjs`). The multi-asset leg uses
   * `ownerBalances` directly instead.
   */
  walletBalance: (address: string): Promise<BalanceResponse> => sdkClient.balance(address),

  /**
   * Derive the fixture account from `mnemonic` via the app's `@zkcoins/wasm`
   * module — the SAME path the app's onboarding uses. The returned `address`
   * is `H(pubkey_0)` (Poseidon), which is the owner the node credits and the
   * address the live wallet polls. Use THIS for `ownerBalances`, never the
   * SDK's `sha256(pubkey_0)` address.
   */
  account: async (mnemonic: string): Promise<{ address: string; xpriv: string }> => {
    const wasm = await loadWasm();
    const acct = wasm.account(mnemonic);
    return { address: acct.address, xpriv: acct.xpriv };
  },

  /**
   * Create / mint an asset into the wallet derived from `mnemonic`. Returns
   * the minted `amount` plus the wallet `address` (Poseidon owner) so the
   * caller can poll the portfolio for it.
   */
  createCoin: async (
    mnemonic: string,
    opts: { name?: string; decimals?: number; amount?: number } = {},
  ): Promise<{ name: string; decimals: number; amount: number; address: string }> => {
    const name = opts.name ?? `E2E-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const decimals = opts.decimals ?? FIXTURE_DECIMALS;
    const amount = opts.amount ?? MINT_AMOUNT;

    const wasm = await loadWasm();
    const { address, xpriv } = wasm.account(mnemonic);
    const { publicKey, nextPublicKey } = wasm.publicKeys(xpriv, 0);
    const timestamp = Math.floor(Date.now() / 1000);

    const messageBytes = buildMintMessage({
      creatorPubkey: publicKey,
      name,
      decimals,
      amount,
      timestamp,
    });
    const digestHex = sha256Hex(messageBytes);
    const signingKey = wasm.signingKey(xpriv, 0);
    const signature = wasm.sign(signingKey, digestHex);

    const accepted = await postJson<{ job_id: string }>(
      '/api/jobs/mint',
      {
        creator_pubkey: publicKey,
        name,
        decimals,
        amount,
        next_public_key: nextPublicKey,
        signature,
        timestamp,
      },
      { 'Idempotency-Key': newIdempotencyKey() },
    );
    const jobId = accepted.job_id;

    const awaiting = await pollToAwaitingSignature(jobId);
    const ash = awaiting.result?.account_state_hash;
    const ocr = awaiting.result?.output_coins_root;
    if (typeof ash !== 'string' || typeof ocr !== 'string') {
      throw new Error(`createCoin: awaiting_signature job ${jobId} did not carry ash/ocr`);
    }
    const commitment = wasm.commitment(xpriv, 0, ash, ocr);
    await sdkClient.commitJob(jobId, {
      proof_id: awaiting.proof_id as number,
      public_key: commitment.publicKey,
      signature: commitment.signature,
      message: commitment.message,
    });
    await pollToCompleted(jobId);

    return { name, decimals, amount, address };
  },
};

// 4 minutes: the local multi-asset node's prover can sit a mint in `queued`
// for a while under back-to-back fixture mints before it reaches
// `awaiting_signature` (Mutinynet proof gen + scanner). 120 s occasionally
// timed out the globalSetup seed under that congestion; 240 s absorbs it
// without masking a genuinely wedged job.
const POLL_TIMEOUT_MS = 240_000;
const POLL_FLOOR_MS = 2_000;

interface PolledJob {
  status: string;
  proof_id?: number | null;
  result?: { account_state_hash?: string; output_coins_root?: string } | null;
  error?: string | null;
}

async function pollToAwaitingSignature(jobId: string): Promise<PolledJob> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const job = (await sdkClient.getJob(jobId)) as unknown as PolledJob;
    if (job.status === 'awaiting_signature') return job;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`mint job ${jobId} ${job.status}: ${job.error ?? 'unknown'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`mint job ${jobId} stuck at ${job.status} (awaiting_signature)`);
    }
    await new Promise((r) => setTimeout(r, POLL_FLOOR_MS));
  }
}

async function pollToCompleted(jobId: string): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const job = (await sdkClient.getJob(jobId)) as unknown as PolledJob;
    if (job.status === 'completed') return;
    if (job.status === 'failed' || job.status === 'cancelled') {
      throw new Error(`mint job ${jobId} ${job.status}: ${job.error ?? 'unknown'}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`mint job ${jobId} did not complete in ${POLL_TIMEOUT_MS}ms (${job.status})`);
    }
    await new Promise((r) => setTimeout(r, POLL_FLOOR_MS));
  }
}

// ---- Wire helpers (Node fetch) --------------------------------------------

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${path} ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function postJson<T>(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${path} ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

// ---- Mint-message byte layout (mirror of the SDK `buildMintMessage`) -------

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function uint64LE(value: number): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), true);
  return out;
}

function buildMintMessage(params: {
  creatorPubkey: string;
  name: string;
  decimals: number;
  amount: number;
  timestamp: number;
}): Uint8Array {
  const creatorBytes = hexToBytes(params.creatorPubkey);
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

/**
 * Session-scoped cache for the server-reported `username_domain`.
 */
let cachedUsernameDomain: string | null = null;

export async function getUsernameDomain(): Promise<string> {
  if (cachedUsernameDomain !== null) return cachedUsernameDomain;
  const info = await api.info();
  const domain = info.username_domain;
  if (!domain) {
    throw new Error(
      `api helper: /api/info (${API_URL}) did not return \`username_domain\`. ` +
        'The frontend renders address chips as `{8hex}@<username_domain>` and the e2e ' +
        'helpers derive their locators from it — a missing field means the server ' +
        'is older than PR #98 or the API URL is wrong.',
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
