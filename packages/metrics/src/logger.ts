// ============================================================================
// Structured JSON Logger
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  service: string;
  event?: string;
  executionId?: string;
  pairId?: string;
  venueId?: string;
  relayerId?: string;
  severity?: string;
  durationMs?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function emit(level: LogLevel, message: string, context: LogContext): void {
  if (!shouldLog(level)) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };

  const output = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

export function createLogger(service: string) {
  const base: LogContext = { service };

  return {
    debug(message: string, ctx?: Partial<LogContext>) {
      emit('debug', message, { ...base, ...ctx });
    },
    info(message: string, ctx?: Partial<LogContext>) {
      emit('info', message, { ...base, ...ctx });
    },
    warn(message: string, ctx?: Partial<LogContext>) {
      emit('warn', message, { ...base, ...ctx });
    },
    error(message: string, ctx?: Partial<LogContext> & { err?: Error }) {
      const { err, ...rest } = ctx ?? {};
      emit('error', message, {
        ...base,
        ...rest,
        ...(err ? { error: err.message, stack: err.stack } : {}),
      });
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
