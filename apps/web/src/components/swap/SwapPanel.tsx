import { useState, useMemo, useCallback, useEffect } from 'react';
import { cn, formatNumber } from '@/lib/utils';
import type { TokenInfo, AdminPool } from '@/types';
import { Button, Card, Skeleton } from '@/components/ui/primitives';
import { usePools } from '@/hooks/use-queries';
import { TOKENS } from '@/config/tokens';
import { useWallet } from '@/stores/wallet';
import { signSwap } from '@/lib/dcc-signer';
import {
  ArrowDownUp,
  ChevronDown,
  Loader2,
  Settings,
  AlertTriangle,
  Wallet,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';

const SCALE8 = 1e8;
const DCC_NODE_URL = import.meta.env['VITE_DCC_NODE_URL'] ?? 'https://mainnet-node.decentralchain.io';

// Find the pool that matches a token pair, returns pool + direction
function findPool(
  pools: AdminPool[],
  symbolIn: string,
  symbolOut: string,
): { pool: AdminPool; isAtoB: boolean } | null {
  for (const p of pools) {
    if (p.tokenASymbol === symbolIn && p.tokenBSymbol === symbolOut) return { pool: p, isAtoB: true };
    if (p.tokenBSymbol === symbolIn && p.tokenASymbol === symbolOut) return { pool: p, isAtoB: false };
  }
  return null;
}

// Calculate AMM output using constant-product formula (mirrors RIDE)
function calcSwapOutput(pool: AdminPool, isAtoB: boolean, amountInRaw: number) {
  const reserveA = Number(pool.reserveA);
  const reserveB = Number(pool.reserveB);
  const virtualA = Number(pool.virtualLiquidityA);
  const virtualB = Number(pool.virtualLiquidityB);
  const feeRate = pool.feeRateBps;

  const resIn = isAtoB ? reserveA : reserveB;
  const resOut = isAtoB ? reserveB : reserveA;
  const vIn = isAtoB ? virtualA : virtualB;
  const vOut = isAtoB ? virtualB : virtualA;

  const fee = Math.floor((amountInRaw * feeRate) / 10000);
  const amountInAfterFee = amountInRaw - fee;
  const effectiveIn = resIn + vIn;
  const effectiveOut = resOut + vOut;
  const amountOut = Math.floor((effectiveOut * amountInAfterFee) / (effectiveIn + amountInAfterFee));

  return { amountOut, fee, priceImpact: amountOut > 0 ? amountInAfterFee / (effectiveIn + amountInAfterFee) : 0 };
}

interface SwapPanelProps {
  className?: string;
}

export function SwapPanel({ className }: SwapPanelProps) {
  const { address, openLoginModal } = useWallet();
  const { data: pools, isLoading: poolsLoading } = usePools();

  const [tokenIn, setTokenIn] = useState<TokenInfo>(TOKENS.sXRP!);
  const [tokenOut, setTokenOut] = useState<TokenInfo>(TOKENS.sDOGE!);
  const [amountIn, setAmountIn] = useState('');
  const [slippageBps, setSlippageBps] = useState(50);
  const [showSettings, setShowSettings] = useState(false);
  const [showTokenSelect, setShowTokenSelect] = useState<'in' | 'out' | null>(null);
  const [dccBalance, setDccBalance] = useState<number | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapResult, setSwapResult] = useState<{ txId: string } | null>(null);
  const [swapError, setSwapError] = useState<string | null>(null);

  // Build list of tokens that appear in active pools
  // Only show tokens that exist in real on-chain pools
  const swappableTokens = useMemo(() => {
    if (!pools?.length) return [];
    const symbols = new Set<string>();
    for (const p of pools) {
      symbols.add(p.tokenASymbol);
      symbols.add(p.tokenBSymbol);
    }
    return Object.values(TOKENS).filter(t => symbols.has(t.symbol));
  }, [pools]);

  // Auto-select first pool's tokens when pools load
  useEffect(() => {
    if (pools?.length && pools[0]) {
      const a = TOKENS[pools[0].tokenASymbol];
      const b = TOKENS[pools[0].tokenBSymbol];
      if (a) setTokenIn(a);
      if (b) setTokenOut(b);
    }
  }, [pools]);

  // Fetch DCC balance when wallet connected
  useEffect(() => {
    if (!address) { setDccBalance(null); return; }
    let cancelled = false;
    fetch(`${DCC_NODE_URL}/addresses/balance/${encodeURIComponent(address)}`)
      .then(r => r.json())
      .then((data) => { if (!cancelled) setDccBalance(data.balance / SCALE8); })
      .catch(() => { if (!cancelled) setDccBalance(null); });
    return () => { cancelled = true; };
  }, [address]);

  // Find matching pool for current pair
  const match = useMemo(() => {
    if (!pools?.length) return null;
    return findPool(pools, tokenIn.symbol, tokenOut.symbol);
  }, [pools, tokenIn, tokenOut]);

  // Calculate output amount
  const swapCalc = useMemo(() => {
    if (!match || !amountIn || parseFloat(amountIn) <= 0) return null;
    const rawIn = Math.round(parseFloat(amountIn) * SCALE8);
    return calcSwapOutput(match.pool, match.isAtoB, rawIn);
  }, [match, amountIn]);

  const outputDisplay = useMemo(() => {
    if (!swapCalc || swapCalc.amountOut <= 0) return '';
    return formatNumber(swapCalc.amountOut / SCALE8, 6);
  }, [swapCalc]);

  const priceDisplay = useMemo(() => {
    if (!swapCalc || swapCalc.amountOut <= 0 || !amountIn) return null;
    const price = (swapCalc.amountOut / SCALE8) / parseFloat(amountIn);
    return `1 ${tokenIn.symbol} = ${formatNumber(price, 6)} ${tokenOut.symbol}`;
  }, [swapCalc, amountIn, tokenIn, tokenOut]);

  const feeDisplay = useMemo(() => {
    if (!swapCalc) return null;
    return formatNumber(swapCalc.fee / SCALE8, 6);
  }, [swapCalc]);

  const handleSwitch = useCallback(() => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn('');
    setSwapResult(null);
    setSwapError(null);
  }, [tokenIn, tokenOut]);

  const handleTokenSelect = (token: TokenInfo) => {
    if (showTokenSelect === 'in') {
      if (token.symbol === tokenOut.symbol) handleSwitch();
      else setTokenIn(token);
    } else {
      if (token.symbol === tokenIn.symbol) handleSwitch();
      else setTokenOut(token);
    }
    setShowTokenSelect(null);
    setSwapResult(null);
    setSwapError(null);
  };

  const handleSwap = async () => {
    if (!match || !swapCalc || !amountIn) return;
    setSwapping(true);
    setSwapError(null);
    setSwapResult(null);
    try {
      const rawIn = Math.round(parseFloat(amountIn) * SCALE8);
      const minOut = Math.floor(swapCalc.amountOut * (1 - slippageBps / 10000));
      const txId = await signSwap(match.pool.poolId, tokenIn.symbol, rawIn, minOut);
      setSwapResult({ txId });
      setAmountIn('');
    } catch (err: unknown) {
      setSwapError(err instanceof Error ? err.message : String(err));
    } finally {
      setSwapping(false);
    }
  };

  const noPool = !poolsLoading && !match;
  const insufficientReserves = swapCalc && match
    ? swapCalc.amountOut > Number(match.isAtoB ? match.pool.reserveB : match.pool.reserveA)
    : false;

  return (
    <div className={cn('w-full max-w-md mx-auto space-y-3', className)}>
      <Card className="space-y-1 p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Swap</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full border border-green-500/50 text-green-400 font-medium">
              ⊕ On-Chain AMM
            </span>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
            >
              <Settings size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Slippage Settings */}
        {showSettings && (
          <div className="p-3 rounded-lg bg-secondary/50 mb-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Max Slippage</span>
              <div className="flex items-center gap-1">
                {[25, 50, 100, 200].map((bps) => (
                  <button
                    key={bps}
                    onClick={() => setSlippageBps(bps)}
                    className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium transition-colors',
                      slippageBps === bps ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {(bps / 100).toFixed(2)}%
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Token In */}
        <div className="rounded-xl bg-secondary/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">You pay</span>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Wallet size={10} />
              {address && dccBalance != null
                ? <>{`Balance: ${formatNumber(dccBalance, 2)}`}
                    <button
                      onClick={() => setAmountIn(String(dccBalance))}
                      className="text-primary text-[10px] font-semibold ml-1 hover:underline"
                    >
                      MAX
                    </button>
                  </>
                : 'Balance: —'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amountIn}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d*\.?\d*$/.test(v)) {
                  setAmountIn(v);
                  setSwapResult(null);
                  setSwapError(null);
                }
              }}
              className="flex-1 bg-transparent text-2xl font-semibold outline-none placeholder:text-muted-foreground/40"
            />
            <button
              onClick={() => setShowTokenSelect('in')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background border border-border hover:border-primary/50 transition-colors"
            >
              <span className="font-semibold text-sm">{tokenIn.symbol}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Switch */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={handleSwitch}
            className="p-2 rounded-xl bg-secondary border border-border hover:border-primary/50 hover:bg-accent transition-all"
          >
            <ArrowDownUp size={16} />
          </button>
        </div>

        {/* Token Out */}
        <div className="rounded-xl bg-secondary/50 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">You receive</span>
          </div>
          <div className="flex items-center gap-3">
            {poolsLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <span className={cn('text-2xl font-semibold', !outputDisplay && 'text-muted-foreground/40')}>
                {outputDisplay || '0.00'}
              </span>
            )}
            <button
              onClick={() => setShowTokenSelect('out')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-background border border-border hover:border-primary/50 transition-colors ml-auto"
            >
              <span className="font-semibold text-sm">{tokenOut.symbol}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Price + Fee Info */}
        {priceDisplay && (
          <div className="flex items-center justify-between px-1 py-1">
            <span className="text-xs text-muted-foreground">{priceDisplay}</span>
            {feeDisplay && match && (
              <span className="text-xs text-muted-foreground">
                Fee: {feeDisplay} {tokenIn.symbol} ({match.pool.feeRateBps / 100}%)
              </span>
            )}
          </div>
        )}

        {/* Pool Info */}
        {match && (
          <div className="flex items-center justify-between px-1 py-0.5">
            <span className="text-[10px] text-muted-foreground/70">
              Pool: {match.pool.poolId}
            </span>
            <span className="text-[10px] text-muted-foreground/70">
              Reserves: {formatNumber(Number(match.pool.reserveA) / SCALE8, 2)} / {formatNumber(Number(match.pool.reserveB) / SCALE8, 2)}
            </span>
          </div>
        )}

        {/* Warnings */}
        {noPool && amountIn && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 mt-2">
            <AlertTriangle size={14} className="text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-300">
              No liquidity pool for {tokenIn.symbol}/{tokenOut.symbol}. Try a different pair.
            </span>
          </div>
        )}

        {insufficientReserves && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 mt-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-xs text-red-300">Amount exceeds pool reserves.</span>
          </div>
        )}

        {swapError && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 mt-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0" />
            <span className="text-xs text-red-300 break-all">{swapError}</span>
          </div>
        )}

        {swapResult && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/30 mt-2">
            <CheckCircle2 size={14} className="text-green-400 shrink-0" />
            <span className="text-xs text-green-300">
              Swap confirmed!{' '}
              <a
                href={`https://mainnet-node.decentralchain.io/transactions/info/${swapResult.txId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline inline-flex items-center gap-0.5"
              >
                {swapResult.txId.slice(0, 8)}… <ExternalLink size={10} />
              </a>
            </span>
          </div>
        )}

        {/* CTA */}
        {!address ? (
          <Button size="lg" className="w-full mt-3" onClick={openLoginModal}>
            <Wallet size={16} />
            Connect Wallet
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full mt-3"
            disabled={!match || !swapCalc || swapping || !amountIn || insufficientReserves || false}
            onClick={handleSwap}
          >
            {swapping ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Swapping…
              </>
            ) : !amountIn ? (
              'Enter an amount'
            ) : noPool ? (
              <>
                <AlertTriangle size={16} />
                No Pool Available
              </>
            ) : insufficientReserves ? (
              'Exceeds Reserves'
            ) : (
              `Swap ${tokenIn.symbol} → ${tokenOut.symbol}`
            )}
          </Button>
        )}
      </Card>

      {/* Token Selector Modal */}
      {showTokenSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <Card className="w-80 p-0 overflow-hidden">
            <div className="p-4 border-b border-border">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Select Token</h3>
                <button onClick={() => setShowTokenSelect(null)} className="text-muted-foreground hover:text-foreground">
                  ✕
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {swappableTokens.map((token) => (
                <button
                  key={token.id}
                  onClick={() => handleTokenSelect(token)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-xs font-bold">
                    {token.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{token.symbol}</div>
                    <div className="text-xs text-muted-foreground">{token.name}</div>
                  </div>
                  {token.isSynthetic && (
                    <span className="ml-auto text-[10px] text-mode-synthetic font-medium">Synthetic</span>
                  )}
                </button>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
