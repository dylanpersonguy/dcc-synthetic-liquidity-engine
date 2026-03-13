import { cn } from '@/lib/utils';
import type { MarketMode } from '@/types';
import { Card, CardHeader, CardTitle } from '@/components/ui/primitives';
import { MarketModeBadge, MODE_CONFIG } from '@/components/shared/MarketModeBadge';
import { Globe, Sparkles, Zap, RotateCcw, ArrowRight } from 'lucide-react';

interface ModeExplainerProps {
  modes: MarketMode[];
  primaryMode: MarketMode;
  className?: string;
}

const EXPLANATIONS: Record<MarketMode, { title: string; description: string; steps: string[] }> = {
  native: {
    title: 'Native On-Chain Swap',
    description: 'Executed entirely on the DecentralChain network using local AMM / orderbook liquidity.',
    steps: ['Submit swap on DCC', 'AMM matches order', 'Tokens settled instantly (~4s)'],
  },
  synthetic: {
    title: 'Synthetic Asset Route',
    description: 'A synthetic representation of the external asset is minted on DCC, backed by oracle price feeds and collateral.',
    steps: ['Price sourced from external oracle', 'Synthetic token minted on DCC', 'Swap via local AMM against synthetic pair'],
  },
  teleport: {
    title: 'Cross-Chain Teleport',
    description: 'Real assets are moved across chains via the protocol relayer. Escrow protects your funds with automatic refund on timeout.',
    steps: ['Local leg executes on DCC (escrow locked)', 'Relayer fills on destination chain', 'Delivery confirmed, escrow released (~2 min)'],
  },
  redeemable: {
    title: 'Synthetic → Real Redemption',
    description: 'Convert a synthetic asset back to its real counterpart on the native chain via the protocol relayer.',
    steps: ['Burn synthetic token on DCC', 'Relayer delivers real asset on external chain', 'Delivery confirmed (~2 min)'],
  },
};

export function ModeExplainer({ modes, primaryMode, className }: ModeExplainerProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <CardHeader className="px-0 pt-0">
        <CardTitle>How This Market Works</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {modes.map((mode) => {
          const info = EXPLANATIONS[mode];
          const isPrimary = mode === primaryMode;
          return (
            <Card key={mode} className={cn('p-4', isPrimary && 'ring-1 ring-primary/30')}>
              <div className="flex items-center gap-2 mb-2">
                <MarketModeBadge mode={mode} size="sm" showIcon />
                {isPrimary && (
                  <span className="text-[10px] text-primary font-semibold uppercase tracking-wider">Primary</span>
                )}
              </div>
              <h4 className="text-sm font-semibold mb-1">{info.title}</h4>
              <p className="text-xs text-muted-foreground mb-3">{info.description}</p>
              <ol className="space-y-1.5">
                {info.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
