import { create } from 'zustand';
import { loadCredential } from '@/lib/crypto/storage';

export type AuthMethod = 'passkey' | 'seed' | null;

interface AuthState {
  authMethod: AuthMethod;
  credentialId: string | null;
  isHydrated: boolean;

  setAuth: (method: AuthMethod, credentialId?: string) => void;
  reset: () => void;
  hydrate: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  authMethod: null,
  credentialId: null,
  isHydrated: false,

  setAuth: (method, credentialId) => {
    set({ authMethod: method, credentialId: credentialId ?? null });
  },

  reset: () => {
    set({ authMethod: null, credentialId: null });
  },

  hydrate: async () => {
    try {
      const credential = await loadCredential();
      if (credential) {
        set({
          authMethod: 'passkey',
          credentialId: credential.credentialId,
          isHydrated: true,
        });
        return;
      }
    } catch {
      // IndexedDB not available
    }
    set({ isHydrated: true });
  },
}));
