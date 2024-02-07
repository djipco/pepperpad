const winston = require("winston");
require("winston-daily-rotate-file");

const drfTransport = new winston.transports.DailyRotateFile({
  level: "info",
  filename: nw.App.manifest.title + ".%DATE%.log",
  dirname: "logs",
  datePattern: "YYYY-MM-DD",
  zippedArchive: true,
  maxSize: "20m",
  maxFiles: "60d"
});

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp({format: "YYYY-MM-DD HH:mm:ss"}),
    winston.format.errors(),
    winston.format.splat(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
  ),
  transports: [
    drfTransport,
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({all: true, colors: {info: "white", warn: "yellow", error: "red"}}),
        winston.format.printf(info => `${info.message}`),
      )
    })
  ]
});

const logInfo = logger.info;
const logWarn = logger.warn;
const logError = logger.error;

export {logInfo, logWarn, logError};


// logger.log
// // info: test message my string {}
// logger.log('info', 'test message %s', 'my string');
//
// // info: test message 123 {}
// logger.log('info', 'test message %d', 123);
