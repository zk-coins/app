import { create } from 'zustand';

export type AuthMethod = 'passkey' | 'seed' | null;

interface AuthState {
  authMethod: AuthMethod;
  credentialId: string | null;
  isLocked: boolean;

  setAuth: (method: AuthMethod, credentialId?: string) => void;
  lock: () => void;
  unlock: () => void;
  reset: () => void;
  loadFromStorage: () => void;
  saveToStorage: () => void;
}

const AUTH_STORAGE_KEY = 'zkcoins_auth';

export const useAuthStore = create<AuthState>((set, get) => ({
  authMethod: null,
  credentialId: null,
  isLocked: false,

  setAuth: (method, credentialId) => {
    set({ authMethod: method, credentialId: credentialId ?? null, isLocked: false });
    get().saveToStorage();
  },

  lock: () => set({ isLocked: true }),
  unlock: () => set({ isLocked: false }),

  reset: () => {
    set({ authMethod: null, credentialId: null, isLocked: false });
    if (typeof window !== 'undefined') {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  },

  loadFromStorage: () => {
    if (typeof window === 'undefined') return;
    try {
      const stored = localStorage.getItem(AUTH_STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        set({
          authMethod: data.authMethod ?? null,
          credentialId: data.credentialId ?? null,
          isLocked: false,
        });
      }
    } catch {
      // ignore
    }
  },

  saveToStorage: () => {
    if (typeof window === 'undefined') return;
    const { authMethod, credentialId } = get();
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ authMethod, credentialId }));
  },
}));
