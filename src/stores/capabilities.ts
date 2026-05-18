import { create } from 'zustand';
import type { z } from 'zod';
import { api } from '@/lib/api/client';
import { CapabilitiesSchema } from '@/lib/api/schemas';

export type Capabilities = z.infer<typeof CapabilitiesSchema>;

// Fail-closed default: every server-gated feature is OFF until `/api/info`
// has been parsed and the real capabilities have replaced the defaults.
// A network failure, a Zod error, or a server that pre-dates the
// capabilities discovery patch (zk-coins/server#29) all land here, which
// is the safe outcome — capability-driven UI hides instead of 404-ing.
const FAIL_CLOSED: Capabilities = {
  address_list: false,
  faucet: false,
  usernames: false,
  lnurl: false,
};

interface CapabilitiesState {
  capabilities: Capabilities;
  // `loaded` flips true once a fetch has resolved (success OR fail-closed
  // fallback) so consumers can render a stable UI instead of flickering
  // on first paint. It does NOT mean the fetch succeeded — check the
  // individual capability bools for that.
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useCapabilities = create<CapabilitiesState>((set) => ({
  capabilities: FAIL_CLOSED,
  loaded: false,
  fetch: async () => {
    try {
      const info = await api.info();
      set({
        capabilities: info.capabilities ?? FAIL_CLOSED,
        loaded: true,
      });
    } catch {
      set({ capabilities: FAIL_CLOSED, loaded: true });
    }
  },
}));
