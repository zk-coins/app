import { create } from 'zustand';
import { api, type Capabilities, capabilitiesFromV1Features } from '@/lib/api/client';
import { useNetworkStore } from '@/stores/network';

export type { Capabilities };

// Fail-closed default: every opt-in feature bit is OFF until `/v1/info`
// has been parsed. A network failure lands here — the safe outcome.
const FAIL_CLOSED: Capabilities = {
  address_list: false,
  username_claim: false,
  lnurl: false,
  multi_asset: false,
};

interface CapabilitiesState {
  capabilities: Capabilities;
  // `loaded` flips true once a fetch has resolved (success OR fail-closed)
  // so consumers can render a stable UI instead of flickering on first paint.
  loaded: boolean;
  fetch: () => Promise<void>;
}

export const useCapabilities = create<CapabilitiesState>((set) => ({
  capabilities: FAIL_CLOSED,
  loaded: false,
  fetch: async () => {
    const network = useNetworkStore.getState();
    try {
      const info = await api.info();
      network.applyInfo({
        network: info.network,
        features: info.features,
        username_domain: info.username_domain,
      });
      set({
        capabilities: info.capabilities ?? capabilitiesFromV1Features(info.features ?? []),
        loaded: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'failed to load /v1/info';
      network.applyInfoFailure(message);
      set({ capabilities: FAIL_CLOSED, loaded: true });
    }
  },
}));
