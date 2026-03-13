import { useState, useCallback } from 'react';
import { useWallet } from '@/stores/wallet';
import { Button, Card } from '@/components/ui/primitives';
import { Loader2, ShieldAlert, X, KeyRound } from 'lucide-react';

export function SeedLoginModal() {
  const { showLoginModal, closeLoginModal, login, isConnecting, error } = useWallet();
  const [seed, setSeed] = useState('');

  const handleLogin = useCallback(async () => {
    if (!seed.trim()) return;
    await login(seed.trim());
    setSeed('');
  }, [seed, login]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !isConnecting && seed.trim()) {
        handleLogin();
      }
    },
    [handleLogin, isConnecting, seed],
  );

  if (!showLoginModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <Card className="w-[420px] p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <KeyRound size={16} className="text-primary" />
            <h3 className="font-semibold">Connect Wallet</h3>
          </div>
          <button
            onClick={() => { closeLoginModal(); setSeed(''); }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Warning */}
          <div className="flex gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-400">
            <ShieldAlert size={14} className="shrink-0 mt-0.5" />
            <span>
              Your seed phrase is used locally in-browser to sign transactions.
              It is never sent to any server. For production use, consider a hardware wallet.
            </span>
          </div>

          {/* Seed Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Seed Phrase</label>
            <textarea
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter your 15-word seed phrase..."
              rows={3}
              autoFocus
              className="w-full rounded-lg bg-secondary/50 border border-border px-3 py-2.5 text-sm font-mono placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
              disabled={isConnecting}
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* CTA */}
          <Button
            className="w-full"
            disabled={!seed.trim() || isConnecting}
            onClick={handleLogin}
          >
            {isConnecting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Connecting…
              </>
            ) : (
              'Connect with Seed Phrase'
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
