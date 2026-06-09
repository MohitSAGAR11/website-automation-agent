/**
 * logger.js
 * Centralized logging utility using Winston.
 * Outputs colorized logs to console and structured JSON to file.
 */

const winston = require('winston');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const LOG_DIR = process.env.LOG_DIR || './logs';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Custom console format with chalk colors
const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const ts = chalk.gray(`[${timestamp}]`);
  let levelTag;

  switch (level) {
    case 'error':   levelTag = chalk.red.bold('[ERROR]');   break;
    case 'warn':    levelTag = chalk.yellow.bold('[WARN]');  break;
    case 'info':    levelTag = chalk.cyan.bold('[INFO]');    break;
    case 'debug':   levelTag = chalk.magenta('[DEBUG]');     break;
    default:        levelTag = chalk.white(`[${level.toUpperCase()}]`);
  }

  // Pretty-print metadata if present
  const metaStr = Object.keys(meta).length
    ? '\n  ' + chalk.gray(JSON.stringify(meta, null, 2).split('\n').join('\n  '))
    : '';

  return `${ts} ${levelTag} ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.errors({ stack: true })
  ),
  transports: [
    // Console transport — colorized
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        consoleFormat
      )
    }),
    // File transport — full JSON logs
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'agent.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    // Separate error log
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'errors.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

// Convenience helpers for agent-specific logging
logger.agentAction = (tool, params = {}) => {
  logger.info(chalk.green(`▶ Tool: ${tool}`) + (Object.keys(params).length ? ` | ${JSON.stringify(params)}` : ''));
};

logger.agentThink = (thought) => {
  logger.info(chalk.blue(`💭 Agent: ${thought}`));
};

logger.agentSuccess = (msg) => {
  logger.info(chalk.green.bold(`✅ ${msg}`));
};

logger.agentError = (msg, err) => {
  logger.error(chalk.red(`❌ ${msg}`) + (err ? `: ${err.message}` : ''));
};

module.exports = logger;
