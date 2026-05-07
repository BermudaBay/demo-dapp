"use client";

import { useRouter } from "next/navigation";
import { useStore } from "@/store/useStore";
import { getBermuda } from "@/lib/bermuda";
import {
  usePrivy,
  useWallets,
  useLoginWithPasskey,
  useSignupWithPasskey,
  useCreateWallet,
} from "@privy-io/react-auth";
import { baseSepolia } from "wagmi/chains";
import { Fingerprint, LogOut } from "lucide-react";
import toast from "react-hot-toast";
import { useState, useEffect, useRef, useCallback } from "react";

interface Props {
  onBack: () => void;
}

export default function PasskeyFlow({ onBack }: Props) {
  const router = useRouter();
  const { setAuth, setLoading, setSdkReady } = useStore();
  const { authenticated, ready: privyReady, logout } = usePrivy();
  const { wallets: privyWallets, ready: walletsReady } = useWallets();
  const { createWallet } = useCreateWallet();
  const [waitingForWallet, setWaitingForWallet] = useState(false);
  const [creatingWallet, setCreatingWallet] = useState(false);
  const setupRan = useRef(false);

  const findEmbeddedWallet = useCallback(() => {
    return privyWallets.find((w) => w.walletClientType === "privy");
  }, [privyWallets]);

  const completeWalletSetup = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (embeddedWallet: any) => {
      try {
        setLoading(true, "Initializing Bermuda SDK...");
        await getBermuda();
        setSdkReady(true);

        setLoading(true, "Configuring wallet...");

        if (typeof embeddedWallet.switchChain === "function") {
          await embeddedWallet.switchChain(baseSepolia.id);
        }

        const provider = await embeddedWallet.getEthereumProvider();

        const { createWalletClient, custom, publicActions } = await import("viem");
        const walletClient = createWalletClient({
          account: embeddedWallet.address as `0x${string}`,
          chain: baseSepolia,
          transport: custom(provider),
        }).extend(publicActions);

        setAuth("passkey", embeddedWallet.address, walletClient);
        toast.success("Passkey authenticated");
        router.push("/setup");
      } catch (err: unknown) {
        console.error("Privy wallet setup failed:", err);
        toast.error(
          `Setup failed: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
        setupRan.current = false;
      } finally {
        setLoading(false);
      }
    },
    [setAuth, setLoading, setSdkReady, router],
  );

  useEffect(() => {
    if (!waitingForWallet || setupRan.current || !walletsReady) return;

    const embeddedWallet = findEmbeddedWallet();

    if (embeddedWallet) {
      setupRan.current = true;
      setWaitingForWallet(false);
      completeWalletSetup(embeddedWallet);
      return;
    }

    if (!creatingWallet) {
      setCreatingWallet(true);
      setLoading(true, "Creating embedded wallet...");
      createWallet()
        .then(() => {
          setCreatingWallet(false);
        })
        .catch((err) => {
          console.error("Wallet creation failed:", err);
          toast.error(
            `Wallet creation failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          );
          setCreatingWallet(false);
          setupRan.current = false;
          setWaitingForWallet(false);
          setLoading(false);
        });
    }
  }, [
    waitingForWallet,
    walletsReady,
    creatingWallet,
    findEmbeddedWallet,
    completeWalletSetup,
    createWallet,
    setLoading,
    privyWallets,
  ]);

  useEffect(() => {
    if (!waitingForWallet) return;
    const timer = setTimeout(() => {
      if (waitingForWallet && !setupRan.current) {
        setWaitingForWallet(false);
        setCreatingWallet(false);
        setLoading(false);
        toast.error("Wallet setup timed out — please try again.");
      }
    }, 25000);
    return () => clearTimeout(timer);
  }, [waitingForWallet, setLoading]);

  function onAuthComplete() {
    setLoading(true, "Setting up wallet from passkey...");
    setupRan.current = false;
    setCreatingWallet(false);
    setWaitingForWallet(true);
  }

  const { loginWithPasskey } = useLoginWithPasskey({
    onComplete: onAuthComplete,
    onError: (err) => {
      setLoading(false);
      toast.error(`Passkey login failed: ${String(err)}`);
    },
  });

  const { signupWithPasskey } = useSignupWithPasskey({
    onComplete: onAuthComplete,
    onError: (err) => {
      setLoading(false);
      toast.error(`Passkey signup failed: ${String(err)}`);
    },
  });

  if (privyReady && authenticated) {
    if (!walletsReady) {
      return (
        <p className="text-sm text-[var(--text-tertiary)] text-center py-3">
          Loading wallets...
        </p>
      );
    }

    const embeddedWallet = findEmbeddedWallet();

    return (
      <div className="space-y-2">
        <button
          onClick={() => {
            setupRan.current = false;
            setCreatingWallet(false);
            if (embeddedWallet) {
              completeWalletSetup(embeddedWallet);
            } else {
              setWaitingForWallet(true);
            }
          }}
          className="w-full h-12 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[var(--primary-hover)] transition-colors"
        >
          <Fingerprint size={16} />
          Continue with Passkey
        </button>
        <button
          onClick={async () => {
            await logout();
            toast.success("Logged out");
          }}
          className="w-full h-10 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] text-sm text-[var(--text-secondary)] flex items-center justify-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
        >
          <LogOut size={14} />
          Log out &amp; start fresh
        </button>
        <button
          onClick={onBack}
          className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors py-1.5 w-full text-center"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => {
          setLoading(true, "Creating new passkey...");
          signupWithPasskey();
        }}
        className="w-full h-12 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[var(--primary-hover)] transition-colors"
      >
        Create new Passkey
      </button>
      <button
        onClick={() => {
          setLoading(true, "Authenticating with passkey...");
          loginWithPasskey();
        }}
        className="w-full h-12 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] text-[var(--text)] text-sm font-medium flex items-center justify-center gap-2.5 hover:bg-[var(--bg-hover)] transition-colors"
      >
        Sign in with existing Passkey
      </button>
      <button
        onClick={onBack}
        className="text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors py-1.5 w-full text-center"
      >
        Back
      </button>
    </div>
  );
}
