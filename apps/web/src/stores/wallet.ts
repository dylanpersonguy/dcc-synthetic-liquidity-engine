import { create } from 'zustand';
import { loginWithSeed, logoutSigner } from '@/lib/dcc-signer';

interface WalletState {
  address: string | null;
  publicKey: string | null;
  isConnecting: boolean;
  error: string | null;
  showLoginModal: boolean;

  openLoginModal: () => void;
  closeLoginModal: () => void;
  login: (seedPhrase: string) => Promise<void>;
  logout: () => void;
}

export const useWallet = create<WalletState>((set) => ({
  address: null,
  publicKey: null,
  isConnecting: false,
  error: null,
  showLoginModal: false,

  openLoginModal: () => set({ showLoginModal: true, error: null }),
  closeLoginModal: () => set({ showLoginModal: false, error: null }),

  login: async (seedPhrase: string) => {
    set({ isConnecting: true, error: null });
    try {
      const user = loginWithSeed(seedPhrase);
      set({
        address: user.address,
        publicKey: user.publicKey,
        isConnecting: false,
        showLoginModal: false,
      });
    } catch (err) {
      set({
        isConnecting: false,
        error: err instanceof Error ? err.message : 'Login failed',
      });
    }
  },

  logout: () => {
    logoutSigner();
    set({ address: null, publicKey: null });
  },
}));
