const { logger } = require('../middleware/errorHandler');

class ResponseHandler {
  // Success response with consistent format
  static success(res, data = null, message = 'Success', statusCode = 200, meta = null) {
    const response = {
      success: true,
      message,
      data,
      timestamp: new Date().toISOString()
    };

    if (meta) {
      response.meta = meta;
    }

    // Log successful responses for monitoring
    logger.info('Successful response', {
      statusCode,
      message,
      dataType: data ? typeof data : 'null',
      hasData: !!data,
      hasMeta: !!meta
    });

    return res.status(statusCode).json(response);
  }

  // Error response with enhanced error information
  static error(res, message = 'Internal Server Error', statusCode = 500, errors = null, code = null) {
    const response = {
      success: false,
      error: {
        message,
        code: code || 'INTERNAL_ERROR',
        statusCode
      },
      timestamp: new Date().toISOString()
    };

    if (errors) {
      response.error.details = errors;
    }

    // Log error for monitoring
    logger.error('Error response sent', {
      message,
      statusCode,
      code,
      errors,
      timestamp: response.timestamp
    });

    return res.status(statusCode).json(response);
  }

  // Paginated response with comprehensive pagination info
  static paginated(res, data, pagination, message = 'Success') {
    const totalPages = Math.ceil(pagination.total / pagination.limit);
    
    const response = {
      success: true,
      message,
      data,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages,
        hasNext: pagination.page < totalPages,
        hasPrev: pagination.page > 1,
        nextPage: pagination.page < totalPages ? pagination.page + 1 : null,
        prevPage: pagination.page > 1 ? pagination.page - 1 : null
      },
      timestamp: new Date().toISOString()
    };

    logger.info('Paginated response sent', {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages,
      dataCount: Array.isArray(data) ? data.length : 0
    });

    return res.status(200).json(response);
  }

  // Created response (201)
  static created(res, data, message = 'Resource created successfully') {
    logger.info('Resource created', {
      message,
      resourceId: data?.id || data?._id || 'unknown'
    });
    return this.success(res, data, message, 201);
  }

  // No content response (204)
  static noContent(res, message = 'No content') {
    logger.info('No content response', { message });
    return res.status(204).json({
      success: true,
      message,
      timestamp: new Date().toISOString()
    });
  }

  // Bad request response (400)
  static badRequest(res, message = 'Bad request', errors = null) {
    return this.error(res, message, 400, errors, 'BAD_REQUEST');
  }

  // Unauthorized response (401)
  static unauthorized(res, message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return this.error(res, message, 401, null, code);
  }

  // Forbidden response (403)
  static forbidden(res, message = 'Forbidden', code = 'FORBIDDEN') {
    return this.error(res, message, 403, null, code);
  }

  // Not found response (404)
  static notFound(res, message = 'Resource not found', code = 'NOT_FOUND') {
    return this.error(res, message, 404, null, code);
  }

  // Conflict response (409)
  static conflict(res, message = 'Resource conflict', code = 'CONFLICT') {
    return this.error(res, message, 409, null, code);
  }

  // Validation error response (422)
  static validationError(res, errors, message = 'Validation failed') {
    return this.error(res, message, 422, errors, 'VALIDATION_ERROR');
  }

  // Too many requests response (429)
  static tooManyRequests(res, message = 'Too many requests', retryAfter = null) {
    const response = this.error(res, message, 429, null, 'TOO_MANY_REQUESTS');
    
    if (retryAfter) {
      res.set('Retry-After', retryAfter);
    }
    
    return response;
  }

  // Internal server error response (500)
  static internalError(res, message = 'Internal server error') {
    return this.error(res, message, 500, null, 'INTERNAL_ERROR');
  }

  // Service unavailable response (503)
  static serviceUnavailable(res, message = 'Service unavailable') {
    return this.error(res, message, 503, null, 'SERVICE_UNAVAILABLE');
  }

  // Custom response for API health checks
  static health(res, status = 'healthy', checks = {}) {
    const isHealthy = status === 'healthy';
    const statusCode = isHealthy ? 200 : 503;
    
    const response = {
      success: isHealthy,
      status,
      checks,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    };

    logger.info('Health check response', {
      status,
      checksCount: Object.keys(checks).length,
      uptime: process.uptime()
    });

    return res.status(statusCode).json(response);
  }

  // Response for bulk operations
  static bulk(res, results, message = 'Bulk operation completed') {
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    const response = {
      success: failed === 0,
      message,
      summary: {
        total: results.length,
        successful,
        failed,
        successRate: results.length > 0 ? ((successful / results.length) * 100).toFixed(2) + '%' : '0%'
      },
      results,
      timestamp: new Date().toISOString()
    };

    logger.info('Bulk operation response', {
      total: results.length,
      successful,
      failed,
      successRate: response.summary.successRate
    });

    const statusCode = failed === 0 ? 200 : 207; // 207 Multi-Status for partial success
    return res.status(statusCode).json(response);
  }
}

// Middleware to attach response handlers to res object
const attachResponseHandlers = (req, res, next) => {
  // Attach all response methods to res object for easy access
  res.success = (data, message, meta) => ResponseHandler.success(res, data, message, 200, meta);
  res.created = (data, message) => ResponseHandler.created(res, data, message);
  res.noContent = (message) => ResponseHandler.noContent(res, message);
  res.badRequest = (message, errors) => ResponseHandler.badRequest(res, message, errors);
  res.unauthorized = (message, code) => ResponseHandler.unauthorized(res, message, code);
  res.forbidden = (message, code) => ResponseHandler.forbidden(res, message, code);
  res.notFound = (message, code) => ResponseHandler.notFound(res, message, code);
  res.conflict = (message, code) => ResponseHandler.conflict(res, message, code);
  res.validationError = (errors, message) => ResponseHandler.validationError(res, errors, message);
  res.tooManyRequests = (message, retryAfter) => ResponseHandler.tooManyRequests(res, message, retryAfter);
  res.internalError = (message) => ResponseHandler.internalError(res, message);
  res.serviceUnavailable = (message) => ResponseHandler.serviceUnavailable(res, message);
  res.paginated = (data, pagination, message) => ResponseHandler.paginated(res, data, pagination, message);
  res.health = (status, checks) => ResponseHandler.health(res, status, checks);
  res.bulk = (results, message) => ResponseHandler.bulk(res, results, message);
  
  next();
};

// Helper function to create consistent API responses
const createApiResponse = (success, data = null, message = '', errors = null, meta = null) => {
  const response = {
    success,
    message,
    timestamp: new Date().toISOString()
  };

  if (success) {
    response.data = data;
    if (meta) response.meta = meta;
  } else {
    response.error = {
      message,
      ...(errors && { details: errors })
    };
  }

  return response;
};

// Helper function for pagination calculations
const calculatePagination = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    total: parseInt(total),
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null,
    offset: (page - 1) * limit
  };
};

module.exports = {
  ResponseHandler,
  attachResponseHandlers,
  createApiResponse,
  calculatePagination
};
