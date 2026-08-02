/**
 * Unit tests for the E2E seeding re-mint-rejection guard
 * (`e2e/_helpers/remint.ts`).
 *
 * The guard makes `createCoinWithRetry` in `e2e/_global-setup.ts`
 * idempotent for the deterministic single-asset fixture name: when a
 * previous attempt minted successfully server-side but the client's
 * completed-poll blipped, the retry's re-admit is deterministically
 * rejected by the node — the guard recognises that rejection so the
 * setup falls through to the independent balance poll instead of
 * failing a funded run. Mirrors the precedent of unit-testing E2E
 * infra logic (`scripts/e2e-info-proxy.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import { isReMintRejection, RE_MINT_REJECTION_FRAGMENT } from '../../../e2e/_helpers/remint';

describe('isReMintRejection', () => {
  it('matches the admit-time HTTP rejection wrapped by postJson', () => {
    // `postJson` throws `POST <path> <status>: <body>` with the node's
    // message embedded in the response body.
    const err = new Error(
      'POST /v1/jobs/mint 422: {"error":"Re-mint into an existing asset account is not supported"}',
    );
    expect(isReMintRejection(err)).toBe(true);
  });

  it('matches the failed-job rejection wrapped by the job-poll helpers', () => {
    // `pollToAwaitingSignature` / `pollToCompleted` throw
    // `mint job <id> failed: <error>` with the node's message as <error>.
    const err = new Error(
      'mint job 0f3c failed: Re-mint into an existing asset account is not supported',
    );
    expect(isReMintRejection(err)).toBe(true);
  });

  it('does not match unrelated mint failures', () => {
    expect(isReMintRejection(new Error('mint job 0f3c failed: proof generation error'))).toBe(
      false,
    );
    expect(
      isReMintRejection(new Error('POST /v1/jobs/mint 422: {"error":"invalid signature"}')),
    ).toBe(false);
    expect(isReMintRejection(new Error('fetch failed'))).toBe(false);
  });

  it('does not match non-Error values, even ones carrying the fragment', () => {
    expect(isReMintRejection(RE_MINT_REJECTION_FRAGMENT)).toBe(false);
    expect(isReMintRejection({ message: RE_MINT_REJECTION_FRAGMENT })).toBe(false);
    expect(isReMintRejection(undefined)).toBe(false);
    expect(isReMintRejection(null)).toBe(false);
  });
});
