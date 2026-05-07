import { create } from "zustand";
import type { TxHistoryItem, Balances, AuthMethod, ComplianceStatus } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WalletClientAny = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyPairAny = any;

interface AppState {
  authMethod: AuthMethod | null;
  publicAddress: string | null;
  walletClient: WalletClientAny;
  shieldedAccount: KeyPairAny;
  shieldedAddress: string | null;
  balances: Balances;
  history: TxHistoryItem[];
  compliance: ComplianceStatus;
  sdkReady: boolean;
  loading: boolean;
  loadingMessage: string;

  setAuth: (method: AuthMethod, address: string, wc: WalletClientAny) => void;
  setShieldedAccount: (account: KeyPairAny) => void;
  setBalances: (b: Partial<Balances>) => void;
  setHistory: (items: TxHistoryItem[]) => void;
  addHistoryItem: (item: TxHistoryItem) => void;
  updateHistoryItem: (id: string, updates: Partial<TxHistoryItem>) => void;
  setCompliance: (status: ComplianceStatus) => void;
  setSdkReady: (ready: boolean) => void;
  setLoading: (loading: boolean, message?: string) => void;
  reset: () => void;
}

const initialState = {
  authMethod: null as AuthMethod | null,
  publicAddress: null as string | null,
  walletClient: null as WalletClientAny,
  shieldedAccount: null as KeyPairAny,
  shieldedAddress: null as string | null,
  balances: { publicUSDC: 0n, shieldedUSDC: 0n, publicETH: 0n, publicWETH: 0n, shieldedWETH: 0n },
  history: [] as TxHistoryItem[],
  compliance: {
    isFullyCompliant: true,
    compliantAmount: 0n,
    uncompliantAmount: 0n,
    checked: false,
  } as ComplianceStatus,
  sdkReady: false,
  loading: false,
  loadingMessage: "",
};

export const useStore = create<AppState>((set, get) => ({
  ...initialState,

  setAuth: (method, address, wc) =>
    set({ authMethod: method, publicAddress: address, walletClient: wc }),

  setShieldedAccount: (account) =>
    set({ shieldedAccount: account, shieldedAddress: account.address() }),

  setBalances: (b) =>
    set((state) => ({ balances: { ...state.balances, ...b } })),

  setHistory: (items) => set({ history: items }),

  addHistoryItem: (item) =>
    set({ history: [item, ...get().history] }),

  updateHistoryItem: (id, updates) =>
    set({
      history: get().history.map((h) =>
        h.id === id ? { ...h, ...updates } : h,
      ),
    }),

  setCompliance: (status) => set({ compliance: status }),

  setSdkReady: (ready) => set({ sdkReady: ready }),

  setLoading: (loading, message = "") =>
    set({ loading, loadingMessage: message }),

  reset: () => set(initialState),
}));
