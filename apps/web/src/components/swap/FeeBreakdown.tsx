import { cn } from '@/lib/utils';
import type { QuoteResponse } from '@/types';
import { Card, Separator } from '@/components/ui/primitives';
import { formatNumber } from '@/lib/utils';

interface FeeBreakdownProps {
  quote: QuoteResponse;
  className?: string;
}

export function FeeBreakdown({ quote, className }: FeeBreakdownProps) {
  const protocolFee = parseFloat(quote.protocolFee);
  const venueFees = parseFloat(quote.venueFees);
  const totalFee = parseFloat(quote.totalFeeEstimate);
  const output = parseFloat(quote.outputAmount);

  return (
    <Card className={cn('space-y-2', className)}>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fee Breakdown</h4>

      <div className="space-y-1.5 text-sm">
        <FeeRow label="Protocol Fee" value={protocolFee} token={quote.outputToken.symbol} />
        <FeeRow label="Venue Fees" value={venueFees} token={quote.outputToken.symbol} />
        {quote.mode === 'teleport' && (
          <FeeRow label="Relayer Fee" value={0} token={quote.outputToken.symbol} sublabel="Included" />
        )}
        {quote.estimatedSlippageBps > 0 && (
          <FeeRow
            label="Est. Slippage"
            value={quote.estimatedSlippageBps}
            sublabel={`${quote.estimatedSlippageBps} bps`}
            isBps
          />
        )}

        <Separator className="my-1" />

        <div className="flex items-center justify-between font-semibold">
          <span className="text-foreground">Total Fees</span>
          <span className="text-foreground">
            {formatNumber(totalFee, 6)} {quote.outputToken.symbol}
          </span>
        </div>

        <Separator className="my-1" />

        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Estimated Received</span>
          <span className="text-foreground font-semibold text-base">
            {formatNumber(output, 6)} {quote.outputToken.symbol}
          </span>
        </div>
      </div>
    </Card>
  );
}

function FeeRow({
  label,
  value,
  token,
  sublabel,
  isBps,
}: {
  label: string;
  value: number;
  token?: string;
  sublabel?: string;
  isBps?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">
        {isBps ? (
          <span className="text-amber-400">{sublabel}</span>
        ) : sublabel ? (
          <span className="text-muted-foreground">{sublabel}</span>
        ) : (
          <>
            {formatNumber(value, 6)} {token}
          </>
        )}
      </span>
    </div>
  );
}
