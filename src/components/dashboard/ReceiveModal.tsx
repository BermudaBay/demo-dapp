"use client";

import Modal from "@/components/ui/Modal";
import { useStore } from "@/store/useStore";
import { QRCodeSVG } from "qrcode.react";
import { Copy, QrCode, Check } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

interface ReceiveModalProps {
  open: boolean;
  onClose: () => void;
}

export default function ReceiveModal({ open, onClose }: ReceiveModalProps) {
  const { shieldedAddress } = useStore();
  const [showQR, setShowQR] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (!shieldedAddress) return;
    navigator.clipboard.writeText(shieldedAddress);
    toast.success("Address copied");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} onClose={onClose} title="Receive">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-secondary)]">
          Share your shielded address to receive private payments.
        </p>

        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-secondary)] p-3.5">
          <p className="font-mono text-xs break-all leading-relaxed text-[var(--text-secondary)]">
            {shieldedAddress}
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={copyAddress}
            className="flex-1 h-10 rounded-[var(--radius)] bg-[var(--primary)] text-[var(--on-primary)] text-sm font-medium flex items-center justify-center gap-2 hover:bg-[var(--primary-hover)] transition-colors"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => setShowQR(!showQR)}
            className="h-10 px-4 rounded-[var(--radius)] border border-[var(--border)] text-sm font-medium flex items-center gap-2 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <QrCode size={14} />
          </button>
        </div>

        {showQR && shieldedAddress && (
          <div className="flex justify-center p-5 bg-white rounded-[var(--radius-lg)] border border-[var(--border)]">
            <QRCodeSVG
              value={shieldedAddress}
              size={180}
              level="M"
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
