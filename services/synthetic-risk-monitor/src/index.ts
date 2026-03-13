// ============================================================================
// synthetic-risk-monitor — Synthetic Asset Exposure Tracking
// ============================================================================
//
// RESPONSIBILITIES:
//   1. Track net synthetic exposure per asset
//   2. Monitor supply vs. max cap utilization
//   3. Track collateral coverage and backing ratio
//   4. Monitor redemption queue depth
//   5. Detect over-exposure conditions and flag for alerts
//   6. Emit Prometheus metrics for synthetic risk dashboards
//
// THRESHOLDS:
//   Utilization > 80%:  Warning
//   Utilization > 95%:  Critical
//   Backing ratio < 1.1: Warning
//   Backing ratio < 1.0: Critical (under-collateralized)
//
// ============================================================================

import Fastify from 'fastify';
import { parseConfig, SyntheticRiskMonitorConfig } from '@dcc/config';
import { createPool, closePool, syntheticExposureRepo } from '@dcc/database';
import {
  createLogger,
  syntheticExposure as syntheticExposureGauge,
  syntheticUtilization as syntheticUtilizationGauge,
  syntheticBackingRatio as syntheticBackingGauge,
} from '@dcc/metrics';

const log = createLogger('synthetic-risk-monitor');

const POLL_INTERVAL_MS = 30_000;

interface RiskAssessment {
  syntheticAssetId: string;
  utilization: number;
  backingRatio: number;
  utilizationLevel: 'normal' | 'warning' | 'critical';
  backingLevel: 'normal' | 'warning' | 'critical';
}

function assessRisk(exposure: {
  current_supply: string;
  max_supply_cap: string;
  backing_ratio: string;
  net_exposure_usd: string;
  synthetic_asset_id: string;
}): RiskAssessment {
  const currentSupply = parseFloat(exposure.current_supply);
  const maxCap = parseFloat(exposure.max_supply_cap);
  const backingRatio = parseFloat(exposure.backing_ratio);

  const utilization = maxCap > 0 ? currentSupply / maxCap : 0;
  let utilizationLevel: RiskAssessment['utilizationLevel'] = 'normal';
  if (utilization > 0.95) utilizationLevel = 'critical';
  else if (utilization > 0.80) utilizationLevel = 'warning';

  let backingLevel: RiskAssessment['backingLevel'] = 'normal';
  if (backingRatio < 1.0) backingLevel = 'critical';
  else if (backingRatio < 1.1) backingLevel = 'warning';

  return {
    syntheticAssetId: exposure.synthetic_asset_id,
    utilization,
    backingRatio,
    utilizationLevel,
    backingLevel,
  };
}

async function evaluateSyntheticRisks(): Promise<RiskAssessment[]> {
  const exposures = await syntheticExposureRepo.findAll();
  const risks: RiskAssessment[] = [];

  for (const exposure of exposures) {
    const risk = assessRisk(exposure);
    risks.push(risk);

    // Update Prometheus
    syntheticExposureGauge.set(
      { synthetic_asset_id: exposure.synthetic_asset_id },
      parseFloat(exposure.net_exposure_usd),
    );
    syntheticUtilizationGauge.set(
      { synthetic_asset_id: exposure.synthetic_asset_id },
      risk.utilization,
    );
    syntheticBackingGauge.set(
      { synthetic_asset_id: exposure.synthetic_asset_id },
      risk.backingRatio,
    );

    if (risk.utilizationLevel !== 'normal' || risk.backingLevel !== 'normal') {
      log.warn('Synthetic risk detected', {
        syntheticAssetId: exposure.synthetic_asset_id,
        utilization: risk.utilization,
        backingRatio: risk.backingRatio,
        utilizationLevel: risk.utilizationLevel,
        backingLevel: risk.backingLevel,
        event: 'synthetic_risk',
      });
    }
  }

  return risks;
}

async function main() {
  const config = parseConfig(SyntheticRiskMonitorConfig);
  log.info('Starting synthetic-risk-monitor', { port: config.PORT });

  createPool({
    connectionString: config.DATABASE_URL,
    poolMin: config.DB_POOL_MIN,
    poolMax: config.DB_POOL_MAX,
  });

  const app = Fastify({ logger: false });

  // Get all synthetic exposure data
  app.get('/synthetic/exposure', async () => {
    const exposures = await syntheticExposureRepo.findAll();
    return { exposures };
  });

  // Get synthetic risk assessments
  app.get('/synthetic/risk', async () => {
    const risks = await evaluateSyntheticRisks();
    return {
      total: risks.length,
      critical: risks.filter((r) => r.utilizationLevel === 'critical' || r.backingLevel === 'critical').length,
      warning: risks.filter((r) => r.utilizationLevel === 'warning' || r.backingLevel === 'warning').length,
      risks,
    };
  });

  // Report exposure snapshot (from mint/burn services)
  app.post('/synthetic/report', async (req) => {
    const data = req.body as Record<string, unknown>;
    await syntheticExposureRepo.upsert(data as any);
    log.info('Synthetic exposure reported', {
      syntheticAssetId: data['synthetic_asset_id'] as string,
      event: 'exposure_report',
    });
    return { ok: true };
  });

  // Background polling
  const pollInterval = setInterval(async () => {
    try {
      await evaluateSyntheticRisks();
    } catch (err) {
      log.error('Synthetic risk evaluation failed', { err: err as Error });
    }
  }, POLL_INTERVAL_MS);

  const shutdown = async () => {
    clearInterval(pollInterval);
    await app.close();
    await closePool();
    log.info('Synthetic risk monitor shut down');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info('Synthetic risk monitor running', { port: config.PORT });
}

main().catch((err) => {
  log.error('Fatal error', { err });
  process.exit(1);
});
