"use client";

export const dynamic = "force-dynamic";

import { useRouter } from "next/navigation";
import { useStore } from "@/store/useStore";
import { getBermuda, makeBermudaSigner, shortenAddress } from "@/lib/bermuda";
import { Check } from "lucide-react";
import toast from "react-hot-toast";
import LoadingOverlay from "@/components/ui/LoadingOverlay";
import NetworkGuard from "@/components/ui/NetworkGuard";
import BermudaLogo from "@/components/ui/BermudaLogo";
import ThemeToggle from "@/components/ui/ThemeToggle";
import { useEffect } from "react";

export default function SetupPage() {
  const router = useRouter();
  const {
    publicAddress,
    walletClient,
    shieldedAccount,
    shieldedAddress,
    setShieldedAccount,
    setLoading,
  } = useStore();

  useEffect(() => {
    if (!publicAddress) {
      router.push("/");
    }
  }, [publicAddress, router]);

  useEffect(() => {
    if (shieldedAccount) {
      router.push("/dashboard");
    }
  }, [shieldedAccount, router]);

  async function handleCreateAccount() {
    if (!walletClient) {
      toast.error("No wallet connected");
      return;
    }

    try {
      setLoading(true, "Accessing shielded account...");
      const bermuda = await getBermuda();
      const account = await bermuda.account({
        signer: makeBermudaSigner(walletClient),
      });
      setShieldedAccount(account);
      toast.success("Shielded account ready");
    } catch (err: unknown) {
      console.error("Account creation failed:", err);
      toast.error(
        `Failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    } finally {
      setLoading(false);
    }
  }

  if (!publicAddress) return null;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <LoadingOverlay />

      {/* Navbar */}
      <nav className="h-16 border-b border-[var(--border)] flex items-center px-6 lg:px-10">
        <BermudaLogo height={20} color="var(--text)" />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </nav>

      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-sm w-full py-16">
          <div className="mb-6">
            <NetworkGuard />
          </div>

          <h1 className="text-xl font-semibold mb-1">Access shielded account</h1>
          <p className="text-sm text-[var(--text-secondary)] mb-8">
            Derive your shielded account to use private payments.
          </p>

          {/* Steps */}
          <div className="space-y-3 mb-8">
            {/* Step 1: connected */}
            <div className="flex items-center gap-3 p-3.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-secondary)]">
              <div className="w-7 h-7 rounded-full bg-[var(--green-bg)] flex items-center justify-center shrink-0">
                <Check size={14} className="text-[var(--green)]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Wallet connected</p>
                <p className="text-xs text-[var(--text-tertiary)] font-mono truncate">
                  {shortenAddress(publicAddress)}
                </p>
              </div>
            </div>

            {/* Step 2: shielded account */}
            <div className={`flex items-center gap-3 p-3.5 rounded-[var(--radius)] border ${
              shieldedAccount
                ? "border-[var(--border)] bg-[var(--bg-secondary)]"
                : "border-[var(--primary)] bg-[var(--bg)]"
            }`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                shieldedAccount
                  ? "bg-[var(--green-bg)]"
                  : "bg-[var(--primary)] text-[var(--on-primary)]"
              }`}>
                {shieldedAccount ? (
                  <Check size={14} className="text-[var(--green)]" />
                ) : (
                  <span className="text-xs font-semibold">2</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {shieldedAccount ? "Shielded account ready" : "Derive shielded account"}
                </p>
                {shieldedAccount ? (
                  <p className="text-xs text-[var(--text-tertiary)] font-mono truncate">
                    {shortenAddress(shieldedAddress || "", 10)}
                  </p>
                ) : (
                  <p className="text-xs text-[var(--text-tertiary)]">
                    Sign a message to derive your private keys
                  </p>
                )}
              </div>
            </div>
          </div>

          {!shieldedAccount && (
            <button
              onClick={handleCreateAccount}
              className="w-full h-11 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center hover:bg-[var(--primary-hover)] transition-colors"
            >
              Access Account
            </button>
          )}

          <button
            onClick={() => {
              useStore.getState().reset();
              router.push("/");
            }}
            className="w-full mt-3 text-sm text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors text-center py-2"
          >
            Back
          </button>
        </div>
      </main>
    </div>
  );
}
