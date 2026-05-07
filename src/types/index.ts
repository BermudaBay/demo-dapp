export type AuthMethod = "passkey" | "wallet";

export type SessionState = {
  authMethod: AuthMethod;
  publicAddress: string;
  shieldedAddress?: string;
  bermudaReady: boolean;
};

export type TokenSymbol = "USDC" | "WETH";

export type Balances = {
  publicUSDC: bigint;
  shieldedUSDC: bigint;
  publicETH: bigint;
  publicWETH: bigint;
  shieldedWETH: bigint;
};

export type TxDirection = "incoming" | "outgoing";
export type TxType = "shield" | "private-transfer" | "public-withdraw" | "swap";
export type TxStatus = "pending" | "confirmed" | "failed";

export type ComplianceStatus = {
  isFullyCompliant: boolean;
  compliantAmount: bigint;
  uncompliantAmount: bigint;
  checked: boolean;
};

export type TxHistoryItem = {
  id: string;
  direction: TxDirection;
  type: TxType;
  token: TokenSymbol;
  amount: bigint;
  counterparty?: string;
  txHash?: string;
  note?: string;
  timestamp: number;
  status: TxStatus;
  toToken?: TokenSymbol;
  toAmount?: bigint;
};
