import { cn } from '@/lib/utils';
import type { MarketMode } from '@/types';
import {
  Globe,
  Sparkles,
  Zap,
  RotateCcw,
} from 'lucide-react';

const MODE_CONFIG: Record<
  MarketMode,
  { label: string; color: string; bg: string; border: string; icon: typeof Globe; tooltip: string }
> = {
  native: {
    label: 'Native',
    color: 'text-mode-native',
    bg: 'bg-mode-native/10',
    border: 'border-mode-native/30',
    icon: Globe,
    tooltip: 'Settled entirely on DecentralChain — instant, trustless swap',
  },
  synthetic: {
    label: 'Synthetic',
    color: 'text-mode-synthetic',
    bg: 'bg-mode-synthetic/10',
    border: 'border-mode-synthetic/30',
    icon: Sparkles,
    tooltip: 'Receive synthetic exposure asset backed by protocol reserves',
  },
  teleport: {
    label: 'Teleport',
    color: 'text-mode-teleport',
    bg: 'bg-mode-teleport/10',
    border: 'border-mode-teleport/30',
    icon: Zap,
    tooltip: 'Cross-chain delivery via protocol relayer — real asset on destination chain',
  },
  redeemable: {
    label: 'Redeemable',
    color: 'text-mode-redeemable',
    bg: 'bg-mode-redeemable/10',
    border: 'border-mode-redeemable/30',
    icon: RotateCcw,
    tooltip: 'Synthetic asset now, redeemable for the underlying later',
  },
};

interface MarketModeBadgeProps {
  mode: MarketMode;
  size?: 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

export function MarketModeBadge({ mode, size = 'md', showIcon = true, className }: MarketModeBadgeProps) {
  const normalizedMode = (mode?.toLowerCase() ?? 'native') as MarketMode;
  const config = MODE_CONFIG[normalizedMode] ?? MODE_CONFIG.native;
  const Icon = config.icon;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px] gap-1',
    md: 'px-2.5 py-1 text-xs gap-1.5',
    lg: 'px-3 py-1.5 text-sm gap-2',
  };

  const iconSize = { sm: 10, md: 12, lg: 14 };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold border',
        config.color,
        config.bg,
        config.border,
        sizeClasses[size],
        className,
      )}
      title={config.tooltip}
    >
      {showIcon && <Icon size={iconSize[size]} />}
      {config.label}
    </span>
  );
}

export { MODE_CONFIG };
