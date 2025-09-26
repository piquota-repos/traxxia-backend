const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb');
const config = require('../config');
const cacheService = require('../services/cacheService');
const databaseService = require('../services/databaseService');
const { AuthenticationError, AuthorizationError } = require('./errorHandler');
const { logger } = require('./errorHandler');

// Enhanced JWT authentication middleware with caching
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      throw new AuthenticationError('Access token required', 'TOKEN_MISSING');
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.jwt.secret);
    
    // Check if user exists in cache first (performance optimization)
    let user = cacheService.getUser(decoded.id);
    
    if (!user) {
      // If not in cache, fetch from database
      const db = databaseService.getDb();
      user = await db.collection('users').findOne({ 
        _id: new ObjectId(decoded.id) 
      });
      
      if (!user) {
        throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
      }

      // Get user role
      const role = await db.collection('roles').findOne({ 
        _id: user.role_id 
      });
      
      if (!role) {
        throw new AuthenticationError('User role not found', 'ROLE_NOT_FOUND');
      }

      user.role = role;
      
      // Cache the user data for future requests
      cacheService.setUser(decoded.id, user);
      logger.info(`User ${user.email} data cached`);
    }

    // Attach user to request
    req.user = user;
    req.tokenData = decoded;
    
    // Log successful authentication for audit
    logger.info('User authenticated successfully', {
      userId: user._id,
      email: user.email,
      role: user.role.role_name,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AuthenticationError('Invalid token', 'INVALID_TOKEN'));
    } else if (error.name === 'TokenExpiredError') {
      next(new AuthenticationError('Token expired', 'TOKEN_EXPIRED'));
    } else {
      next(error);
    }
  }
};

// Role-based authorization middleware with enhanced logging
const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new AuthenticationError('Authentication required', 'AUTH_REQUIRED'));
    }

    const userRole = req.user.role.role_name;
    
    if (!allowedRoles.includes(userRole)) {
      logger.warn('Access denied - insufficient role', {
        userId: req.user._id,
        userRole: userRole,
        requiredRoles: allowedRoles,
        endpoint: req.originalUrl,
        method: req.method,
        ip: req.ip
      });

      return next(new AuthorizationError(
        `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        'INSUFFICIENT_ROLE'
      ));
    }

    logger.info('Role authorization successful', {
      userId: req.user._id,
      userRole: userRole,
      endpoint: req.originalUrl
    });

    next();
  };
};

// Specific role middleware functions
const requireAdmin = requireRole(['super_admin', 'company_admin']);
const requireSuperAdmin = requireRole(['super_admin']);
const requireUser = requireRole(['user', 'company_admin', 'super_admin']);

// Company-based authorization middleware with caching
const requireSameCompany = async (req, res, next) => {
  try {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required', 'AUTH_REQUIRED'));
    }

    // Super admin can access all companies
    if (req.user.role.role_name === 'super_admin') {
      logger.info('Super admin access granted', {
        userId: req.user._id,
        endpoint: req.originalUrl
      });
      return next();
    }

    const { user_id } = req.query;
    if (!user_id) {
      return next(); // No user_id specified, proceed normally
    }

    // Check cache first
    let targetUser = cacheService.getUser(user_id);
    
    if (!targetUser) {
      const db = databaseService.getDb();
      targetUser = await db.collection('users').findOne({
        _id: new ObjectId(user_id)
      });

      if (targetUser) {
        cacheService.setUser(user_id, targetUser);
      }
    }

    if (!targetUser) {
      return next(new AuthorizationError('Target user not found', 'USER_NOT_FOUND'));
    }

    // Company admin can only access users from same company
    if (req.user.role.role_name === 'company_admin') {
      if (!targetUser.company_id || 
          targetUser.company_id.toString() !== req.user.company_id.toString()) {
        
        logger.warn('Company access denied', {
          adminUserId: req.user._id,
          targetUserId: user_id,
          adminCompanyId: req.user.company_id,
          targetCompanyId: targetUser.company_id
        });

        return next(new AuthorizationError(
          'Access denied - user not in your company', 
          'COMPANY_ACCESS_DENIED'
        ));
      }
    }

    logger.info('Company authorization successful', {
      adminUserId: req.user._id,
      targetUserId: user_id,
      companyId: req.user.company_id
    });

    next();
  } catch (error) {
    next(error);
  }
};

// Resource ownership middleware with enhanced validation
const requireOwnership = (resourceType) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(new AuthenticationError('Authentication required', 'AUTH_REQUIRED'));
      }

      // Admin users can access all resources
      if (['super_admin', 'company_admin'].includes(req.user.role.role_name)) {
        logger.info('Admin access to resource granted', {
          userId: req.user._id,
          resourceType: resourceType,
          resourceId: req.params.id,
          role: req.user.role.role_name
        });
        return next();
      }

      const resourceId = req.params.id;
      if (!resourceId) {
        return next(new AuthorizationError('Resource ID required', 'RESOURCE_ID_REQUIRED'));
      }

      // Validate ObjectId format
      if (!ObjectId.isValid(resourceId)) {
        return next(new AuthorizationError('Invalid resource ID format', 'INVALID_RESOURCE_ID'));
      }

      const db = databaseService.getDb();
      let resource;
      let collectionName;

      switch (resourceType) {
        case 'business':
          collectionName = 'user_businesses';
          resource = await db.collection(collectionName).findOne({
            _id: new ObjectId(resourceId),
            user_id: new ObjectId(req.user._id)
          });
          break;
        case 'conversation':
          collectionName = 'user_business_conversations';
          resource = await db.collection(collectionName).findOne({
            _id: new ObjectId(resourceId),
            user_id: new ObjectId(req.user._id)
          });
          break;
        default:
          return next(new AuthorizationError('Invalid resource type', 'INVALID_RESOURCE_TYPE'));
      }

      if (!resource) {
        logger.warn('Resource ownership denied', {
          userId: req.user._id,
          resourceType: resourceType,
          resourceId: resourceId,
          collection: collectionName
        });

        return next(new AuthorizationError(
          'Access denied - resource not found or not owned', 
          'RESOURCE_ACCESS_DENIED'
        ));
      }

      logger.info('Resource ownership verified', {
        userId: req.user._id,
        resourceType: resourceType,
        resourceId: resourceId
      });

      req.resource = resource;
      next();
    } catch (error) {
      next(error);
    }
  };
};

// API key authentication (for external integrations)
const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      throw new AuthenticationError('API key required', 'API_KEY_MISSING');
    }

    const db = databaseService.getDb();
    const apiKeyRecord = await db.collection('api_keys').findOne({
      key: apiKey,
      is_active: true
    });

    if (!apiKeyRecord) {
      logger.warn('Invalid API key attempt', {
        apiKey: apiKey.substring(0, 8) + '...',
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
    }

    // Update last used timestamp
    await db.collection('api_keys').updateOne(
      { _id: apiKeyRecord._id },
      { $set: { last_used: new Date() } }
    );

    logger.info('API key authentication successful', {
      apiKeyId: apiKeyRecord._id,
      keyName: apiKeyRecord.name,
      ip: req.ip
    });

    req.apiKey = apiKeyRecord;
    next();
  } catch (error) {
    next(error);
  }
};

// Optional authentication (for public endpoints that can benefit from user context)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return next(); // No token, continue without authentication
    }

    // Try to authenticate, but don't fail if invalid
    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      let user = cacheService.getUser(decoded.id);
      
      if (!user) {
        const db = databaseService.getDb();
        user = await db.collection('users').findOne({ 
          _id: new ObjectId(decoded.id) 
        });
        
        if (user) {
          const role = await db.collection('roles').findOne({ 
            _id: user.role_id 
          });
          if (role) {
            user.role = role;
            cacheService.setUser(decoded.id, user);
          }
        }
      }

      if (user) {
        req.user = user;
        req.tokenData = decoded;
        logger.info('Optional authentication successful', {
          userId: user._id,
          endpoint: req.originalUrl
        });
      }
    } catch (tokenError) {
      // Invalid token, but continue without authentication
      logger.info('Optional authentication failed, continuing without auth', {
        error: tokenError.message,
        endpoint: req.originalUrl
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Token refresh middleware
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      throw new AuthenticationError('Refresh token required', 'REFRESH_TOKEN_MISSING');
    }

    const decoded = jwt.verify(refreshToken, config.jwt.secret);
    
    // Verify user still exists
    const db = databaseService.getDb();
    const user = await db.collection('users').findOne({ 
      _id: new ObjectId(decoded.id) 
    });
    
    if (!user) {
      throw new AuthenticationError('User not found', 'USER_NOT_FOUND');
    }

    // Generate new access token
    const newToken = jwt.sign(
      { 
        id: user._id, 
        email: user.email, 
        role: decoded.role 
      }, 
      config.jwt.secret, 
      { expiresIn: config.jwt.expiresIn }
    );

    logger.info('Token refreshed successfully', {
      userId: user._id,
      email: user.email
    });

    res.json({
      success: true,
      token: newToken,
      expiresIn: config.jwt.expiresIn
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireSuperAdmin,
  requireUser,
  requireSameCompany,
  requireOwnership,
  authenticateApiKey,
  optionalAuth,
  refreshToken
};
