import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { FEATURES, useFeatures } from '@/lib/features';
import { useCapabilities } from '@/stores/capabilities';

describe('FEATURES (build-time client flags)', () => {
  it('exposes every build-time flag as a boolean', () => {
    expect(typeof FEATURES.PASSKEY).toBe('boolean');
    expect(typeof FEATURES.APPS_DIRECTORY).toBe('boolean');
    expect(typeof FEATURES.DEV_ROUTES).toBe('boolean');
    expect(typeof FEATURES.AUTO_LOCK).toBe('boolean');
    expect(typeof FEATURES.ADDRESS_ROTATION).toBe('boolean');
    expect(typeof FEATURES.TOR_ROUTING).toBe('boolean');
  });

  it('exposes exactly the six build-time flags — FAUCET / USERNAMES are server-side', () => {
    expect(Object.keys(FEATURES).sort()).toEqual([
      'ADDRESS_ROTATION',
      'APPS_DIRECTORY',
      'AUTO_LOCK',
      'DEV_ROUTES',
      'PASSKEY',
      'TOR_ROUTING',
    ]);
  });
});

describe('useFeatures (build-time + runtime merged)', () => {
  beforeEach(() => {
    useCapabilities.setState({
      capabilities: {
        address_list: false,
        faucet: false,
        usernames: false,
        lnurl: false,
      },
      loaded: false,
    });
  });

  it('exposes all six build-time flags plus FAUCET, USERNAMES, and USERNAME_CLAIM', () => {
    const { result } = renderHook(() => useFeatures());
    expect(Object.keys(result.current).sort()).toEqual([
      'ADDRESS_ROTATION',
      'APPS_DIRECTORY',
      'AUTO_LOCK',
      'DEV_ROUTES',
      'FAUCET',
      'PASSKEY',
      'TOR_ROUTING',
      'USERNAMES',
      'USERNAME_CLAIM',
    ]);
  });

  it('USERNAME_CLAIM is false from the fail-closed default and reflects /api/info', () => {
    const { result, rerender } = renderHook(() => useFeatures());
    expect(result.current.USERNAME_CLAIM).toBe(false);

    useCapabilities.setState({
      capabilities: {
        address_list: false,
        faucet: false,
        usernames: true,
        username_claim: true,
        lnurl: false,
      },
      loaded: true,
    });
    rerender();
    expect(result.current.USERNAME_CLAIM).toBe(true);
  });

  it('USERNAME_CLAIM defaults to false when the server omits the field (pre-PR-#143 node)', () => {
    // Simulate an older node whose `/api/info` does not include
    // `username_claim`. The Zod schema strips the optional, so the
    // store's capability object lacks the key. `useFeatures` must
    // fail-closed rather than coerce undefined to true.
    useCapabilities.setState({
      capabilities: {
        address_list: false,
        faucet: false,
        usernames: true,
        lnurl: false,
        // no username_claim key
      } as never,
      loaded: true,
    });
    const { result } = renderHook(() => useFeatures());
    expect(result.current.USERNAME_CLAIM).toBe(false);
  });

  it('returns FAUCET=false / USERNAMES=false from the fail-closed default', () => {
    const { result } = renderHook(() => useFeatures());
    expect(result.current.FAUCET).toBe(false);
    expect(result.current.USERNAMES).toBe(false);
  });

  it('reflects capability store updates after a successful /api/info load', () => {
    const { result, rerender } = renderHook(() => useFeatures());
    expect(result.current.FAUCET).toBe(false);

    useCapabilities.setState({
      capabilities: { address_list: true, faucet: true, usernames: true, lnurl: true },
      loaded: true,
    });
    rerender();

    expect(result.current.FAUCET).toBe(true);
    expect(result.current.USERNAMES).toBe(true);
  });

  it('returns a stable reference when capability values are unchanged', () => {
    const { result, rerender } = renderHook(() => useFeatures());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
