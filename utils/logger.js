/**
 * Logger Utility
 * 
 * Handles application logging with different log levels.
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log levels
const levels = {
  error: 0,
  warn: 1,
  email: 2, // Add dedicated level for email logs
  info: 3,
  http: 4,
  debug: 5
};

// Log level colors
const colors = {
  error: 'red',
  warn: 'yellow',
  email: 'magenta', // Magenta for email logs
  info: 'green',
  http: 'blue',
  debug: 'white'
};

// Set winston colors
winston.addColors(colors);

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' ? 'debug' : 'info';
};

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `[${info.timestamp}] [${info.level}] ${info.message}`
  )
);

// File transport format
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  levels,
  level: level(),
  transports: [
    // Console logging
    new winston.transports.Console({
      format: consoleFormat
    }),
    // General error logging
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // General application logging
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Email-specific logging
    new winston.transports.File({
      filename: path.join(logsDir, 'email.log'),
      level: 'email',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ]
});

// Additional convenience method for email logging
logger.email = (message) => {
  logger.log({
    level: 'email',
    message
  });
};

module.exports = logger;
