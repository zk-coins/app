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

  it('exposes exactly the six build-time flags — runtime capabilities live on useFeatures()', () => {
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
        username_claim: false,
        lnurl: false,
        multi_asset: false,
      },
      loaded: false,
    });
  });

  it('exposes all six build-time flags plus USERNAME_CLAIM', () => {
    const { result } = renderHook(() => useFeatures());
    expect(Object.keys(result.current).sort()).toEqual([
      'ADDRESS_ROTATION',
      'APPS_DIRECTORY',
      'AUTO_LOCK',
      'DEV_ROUTES',
      'PASSKEY',
      'TOR_ROUTING',
      'USERNAME_CLAIM',
    ]);
  });

  it('USERNAME_CLAIM is false from the fail-closed default and reflects /api/info', () => {
    const { result, rerender } = renderHook(() => useFeatures());
    expect(result.current.USERNAME_CLAIM).toBe(false);

    useCapabilities.setState({
      capabilities: {
        address_list: false,
        username_claim: true,
        lnurl: false,
        multi_asset: false,
      },
      loaded: true,
    });
    rerender();
    expect(result.current.USERNAME_CLAIM).toBe(true);
  });

  it('returns a stable reference when capability values are unchanged', () => {
    const { result, rerender } = renderHook(() => useFeatures());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
