const winston = require('winston');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Configure Winston logger with multiple transports
const logger = winston.createLogger({
  level: config.logging.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'traxxia-backend' },
  transports: [
    // Error logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Combined logs
    new winston.transports.File({ 
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Performance logs
    new winston.transports.File({
      filename: path.join(logsDir, 'performance.log'),
      level: 'info',
      maxsize: 5242880, // 5MB
      maxFiles: 3
    })
  ]
});

// Console logging for development
if (config.logging.enableConsole) {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Custom error classes with better error handling
class ValidationError extends Error {
  constructor(message, field = null, code = 'VALIDATION_ERROR') {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.field = field;
    this.code = code;
    this.isOperational = true;
  }
}

class AuthenticationError extends Error {
  constructor(message = 'Authentication failed', code = 'AUTH_ERROR') {
    super(message);
    this.name = 'AuthenticationError';
    this.statusCode = 401;
    this.code = code;
    this.isOperational = true;
  }
}

class AuthorizationError extends Error {
  constructor(message = 'Access denied', code = 'AUTHORIZATION_ERROR') {
    super(message);
    this.name = 'AuthorizationError';
    this.statusCode = 403;
    this.code = code;
    this.isOperational = true;
  }
}

class NotFoundError extends Error {
  constructor(message = 'Resource not found', code = 'NOT_FOUND') {
    super(message);
    this.name = 'NotFoundError';
    this.statusCode = 404;
    this.code = code;
    this.isOperational = true;
  }
}

class ConflictError extends Error {
  constructor(message = 'Resource conflict', code = 'CONFLICT_ERROR') {
    super(message);
    this.name = 'ConflictError';
    this.statusCode = 409;
    this.code = code;
    this.isOperational = true;
  }
}

class DatabaseError extends Error {
  constructor(message = 'Database operation failed', code = 'DATABASE_ERROR') {
    super(message);
    this.name = 'DatabaseError';
    this.statusCode = 500;
    this.code = code;
    this.isOperational = true;
  }
}

// Async wrapper to catch errors in async route handlers
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Performance logging middleware
const performanceLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();
  
  res.on('finish', () => {
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1000000; // Convert to milliseconds
    
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration.toFixed(2)}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous',
      timestamp: new Date().toISOString()
    };

    // Log slow requests (>1000ms) as warnings
    if (duration > 1000) {
      logger.warn('Slow request detected', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
};

// Global error handler middleware with enhanced error processing
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Enhanced error logging with context
  const errorContext = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous',
    body: req.body,
    params: req.params,
    query: req.query,
    timestamp: new Date().toISOString(),
    errorCode: err.code || 'UNKNOWN_ERROR'
  };

  logger.error('Application error', errorContext);

  // Handle specific MongoDB errors
  if (err.name === 'CastError') {
    const message = `Invalid ${err.path}: ${err.value}`;
    error = new ValidationError(message, err.path, 'INVALID_ID');
  }

  // MongoDB duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `Duplicate value for field: ${field}`;
    error = new ConflictError(message, 'DUPLICATE_FIELD');
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(val => ({
      field: val.path,
      message: val.message
    }));
    error = new ValidationError('Validation failed', null, 'VALIDATION_FAILED');
    error.details = errors;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AuthenticationError('Invalid token', 'INVALID_TOKEN');
  }

  if (err.name === 'TokenExpiredError') {
    error = new AuthenticationError('Token expired', 'TOKEN_EXPIRED');
  }

  // Multer errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new ValidationError('File too large', 'file', 'FILE_TOO_LARGE');
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error = new ValidationError('Too many files', 'files', 'TOO_MANY_FILES');
  }

  // MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoServerError') {
    error = new DatabaseError('Database connection failed', 'DB_CONNECTION_ERROR');
    error.statusCode = 503;
  }

  // Azure Blob Storage errors
  if (err.code === 'BlobNotFound') {
    error = new NotFoundError('File not found', 'FILE_NOT_FOUND');
  }

  // Prepare error response
  const errorResponse = {
    success: false,
    error: {
      message: error.message || 'Internal Server Error',
      code: error.code || 'INTERNAL_ERROR',
      statusCode: error.statusCode || 500
    },
    timestamp: new Date().toISOString()
  };

  // Add error details for validation errors
  if (error.details) {
    errorResponse.error.details = error.details;
  }

  // Add field information for field-specific errors
  if (error.field) {
    errorResponse.error.field = error.field;
  }

  // Include stack trace in development
  if (config.server.env === 'development') {
    errorResponse.error.stack = err.stack;
  }

  res.status(error.statusCode || 500).json(errorResponse);
};

// 404 handler
const notFound = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.originalUrl} not found`, 'ROUTE_NOT_FOUND');
  next(error);
};

// Graceful error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: reason.toString(),
    stack: reason.stack,
    promise: promise.toString()
  });
});

// Graceful error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    message: error.message,
    stack: error.stack
  });
  
  // Graceful shutdown
  process.exit(1);
});

module.exports = {
  logger,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  DatabaseError,
  asyncHandler,
  performanceLogger,
  errorHandler,
  notFound
};
