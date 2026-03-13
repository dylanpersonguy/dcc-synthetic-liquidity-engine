import { useWallet } from '@/stores/wallet';
import { Wallet, LogOut, Copy, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

function truncateAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, openLoginModal, logout } = useWallet();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [address]);

  if (!address) {
    return (
      <button
        onClick={openLoginModal}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Wallet size={14} />
        Connect
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono bg-secondary border border-border hover:border-primary/40 transition-colors"
        title="Copy address"
      >
        {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} className="text-muted-foreground" />}
        {truncateAddress(address)}
      </button>
      <button
        onClick={logout}
        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        title="Disconnect"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
