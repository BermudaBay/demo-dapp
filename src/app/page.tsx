"use client";

export const dynamic = "force-dynamic";

import { useRouter } from "next/navigation";
import { useStore } from "@/store/useStore";
import { getBermuda } from "@/lib/bermuda";
import {
  useConnect,
  useAccount,
  useSwitchChain,
  useDisconnect,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { Wallet, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import PasskeyAuth from "@/components/landing/PasskeyAuth";
import BermudaLogo from "@/components/ui/BermudaLogo";
import ThemeToggle from "@/components/ui/ThemeToggle";

export default function LandingPage() {
  const router = useRouter();
  const { setAuth, setLoading, setSdkReady } = useStore();

  const { connectors, connectAsync } = useConnect();
  const {
    isConnected,
    address: connectedAddress,
    chainId,
    connector: activeConnector,
  } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync } = useDisconnect();

  async function handleWalletConnect(connectorIdx: number) {
    try {
      setLoading(true, "Initializing Bermuda SDK...");
      await getBermuda();
      setSdkReady(true);

      setLoading(true, "Connecting wallet...");
      const connector = connectors[connectorIdx];
      if (!connector) {
        toast.error("No wallet connector available");
        return;
      }

      let address: `0x${string}`;
      let currentChainId: number;

      if (isConnected && connectedAddress) {
        address = connectedAddress;
        currentChainId = chainId ?? 0;
      } else {
        try {
          await disconnectAsync();
        } catch {
          // ignore
        }
        const result = await connectAsync({ connector });
        address = result.accounts[0];
        currentChainId = result.chainId;
      }

      if (currentChainId !== baseSepolia.id) {
        setLoading(true, "Switching to Base Sepolia...");
        await switchChainAsync({ chainId: baseSepolia.id });
      }

      const { createWalletClient, custom, publicActions } = await import("viem");

      const usedConnector = activeConnector ?? connector;
      const provider = await usedConnector.getProvider();
      const walletClient = createWalletClient({
        account: address,
        chain: baseSepolia,
        transport: custom(provider as Parameters<typeof custom>[0]),
      }).extend(publicActions);

      setAuth("wallet", address, walletClient);
      toast.success("Wallet connected");
      router.push("/setup");
    } catch (err: unknown) {
      console.error("Wallet connect failed:", err);
      toast.error(
        `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <LoadingOverlay />

      {/* Navbar */}
      <nav className="h-16 border-b border-[var(--border)] flex items-center px-6 lg:px-10">
        <BermudaLogo height={20} color="var(--text)" />
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2">
            <img
              src="/base-square-blue.svg"
              alt="Base"
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 rounded-none"
            />
            <span className="text-xs font-medium text-[var(--text-secondary)]">
              Base Sepolia
            </span>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex items-center">
        <div className="w-full max-w-6xl mx-auto px-6 lg:px-10 py-16 lg:py-0">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            {/* Left - copy + testnet faucets */}
            <div>
              <h1 className="text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1] mb-5">
                Your private account<br />
                <span className="text-[var(--text-secondary)]">on Ethereum</span>
              </h1>
              <p className="text-[var(--text-secondary)] text-lg leading-relaxed max-w-md mb-5">
                Shield, swap, send, and withdraw on the same chain you already use.
              </p>
              <p className="text-sm text-[var(--text-tertiary)] leading-relaxed max-w-md mb-8">
                Proofs are built in your browser client-side.
              </p>

              <div className="max-w-md">
                <p className="text-xs font-medium text-[var(--text-secondary)] mb-3">
                  Need testnet funds?
                </p>
                <div className="flex flex-col gap-2">
                  <a
                    href="https://www.alchemy.com/faucets/base-sepolia"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-colors"
                  >
                    <img
                      src="/weth-logo.svg"
                      alt=""
                      className="w-9 h-9 rounded-full shrink-0"
                    />
                    <span className="flex-1 min-w-0 font-medium">Base Sepolia ETH</span>
                    <span className="text-xs text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]">
                      Alchemy
                    </span>
                    <ExternalLink size={14} className="text-[var(--text-tertiary)] shrink-0" />
                  </a>
                  <a
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-secondary)] px-3.5 py-2.5 text-sm text-[var(--text)] hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-colors"
                  >
                    <img
                      src="/usdc-logo.png"
                      alt=""
                      className="w-9 h-9 rounded-full shrink-0"
                    />
                    <span className="flex-1 min-w-0 font-medium">Base Sepolia USDC</span>
                    <span className="text-xs text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]">
                      Circle
                    </span>
                    <ExternalLink size={14} className="text-[var(--text-tertiary)] shrink-0" />
                  </a>
                </div>
              </div>
            </div>

            {/* Right - auth */}
            <div className="max-w-sm w-full lg:ml-auto flex flex-col gap-6">
              <div className="space-y-3">
                <PasskeyAuth />

                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-[var(--border)]" />
                  <span className="text-xs text-[var(--text-tertiary)]">or</span>
                  <div className="flex-1 h-px bg-[var(--border)]" />
                </div>

                <button
                  onClick={() => handleWalletConnect(0)}
                  className="w-full h-12 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)] transition-colors"
                >
                  <Wallet size={16} className="text-[var(--text-secondary)]" />
                  Connect wallet
                </button>
              </div>

              <p className="text-xs text-[var(--text-tertiary)] leading-relaxed">
                By connecting, you agree to use this application on the Base
                Sepolia testnet. No real funds are involved.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
