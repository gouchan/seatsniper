/**
 * Logger Utility
 * Winston-based structured logging with context support
 */

import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, service, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `${timestamp} [${service || 'seatsniper'}] ${level}: ${message}${metaStr}`;
});

// Create the base logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'seatsniper' },
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' })
  ),
  transports: [
    // Console transport with colors for development
    new winston.transports.Console({
      format: combine(
        colorize(),
        consoleFormat
      ),
    }),
  ],
});

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  logger.add(
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(
        timestamp(),
        winston.format.json()
      ),
    })
  );

  logger.add(
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: combine(
        timestamp(),
        winston.format.json()
      ),
    })
  );
}

/**
 * Create a child logger with additional context
 * @param context Additional context to include in all log messages
 */
export function createLogger(context: Record<string, string>): winston.Logger {
  return logger.child(context);
}

/**
 * Log adapter operations with timing
 */
export function logAdapterOperation(
  adapter: string,
  operation: string,
  startTime: number,
  success: boolean,
  meta?: Record<string, unknown>
): void {
  const duration = Date.now() - startTime;
  const level = success ? 'info' : 'error';

  logger.log(level, `[${adapter}] ${operation}`, {
    adapter,
    operation,
    duration,
    success,
    ...meta,
  });
}

/**
 * Log alert delivery
 */
export function logAlertDelivery(
  channel: string,
  userId: string,
  success: boolean,
  messageId?: string,
  error?: string
): void {
  const level = success ? 'info' : 'error';

  logger.log(level, `Alert delivery via ${channel}`, {
    channel,
    userId,
    success,
    messageId,
    error,
  });
}

export { logger };
