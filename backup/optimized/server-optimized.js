// ===============================
// TRAXXIA BACKEND - OPTIMIZED VERSION
// ===============================

const express = require('express');
const compression = require('compression');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const hpp = require('hpp');
const cors = require('cors');

// Import optimized services and middleware
const config = require('./src/config');
const databaseService = require('./src/services/databaseService');
const cacheService = require('./src/services/cacheService');
const monitoringService = require('./src/services/monitoringService');
const { attachResponseHandlers } = require('./src/utils/responseHandler');
const { errorHandler, notFound, performanceLogger, logger } = require('./src/middleware/errorHandler');
const { validate, sanitize } = require('./src/middleware/validation');
const { authenticateToken, requireAdmin, requireSuperAdmin } = require('./src/middleware/auth');

// Import original modules that we'll keep
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const blobService = require('./blobService');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// ===============================
// APPLICATION SETUP
// ===============================

const app = express();
const port = config.server.port;

// Global database reference (will be set after connection)
let db;

// ===============================
// SECURITY MIDDLEWARE
// ===============================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://traxxia.com',
      'https://www.traxxia.com'
    ];
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security middleware
app.use(mongoSanitize()); // Prevent NoSQL injection
app.use(xss()); // Clean user input from malicious HTML
app.use(hpp()); // Prevent HTTP Parameter Pollution

// Custom middleware
app.use(sanitize); // Custom sanitization
app.use(attachResponseHandlers); // Attach response helpers
app.use(performanceLogger); // Performance logging
app.use(monitoringService.trackRequests()); // Request monitoring

// ===============================
// FILE UPLOAD CONFIGURATION
// ===============================

const uploadsDir = path.join(__dirname, 'uploads', 'logos');
const financialDocsDir = path.join(__dirname, 'uploads', 'financial-documents');

// Ensure upload directories exist
const fsSync = require('fs');
if (!fsSync.existsSync(uploadsDir)) {
  fsSync.mkdirSync(uploadsDir, { recursive: true });
}

const ensureFinancialDocsDir = async () => {
  try {
    await fs.access(financialDocsDir);
  } catch (error) {
    await fs.mkdir(financialDocsDir, { recursive: true });
    logger.info('Financial documents directory created');
  }
};

// Configure multer for financial documents
const financialDocUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.upload.maxFileSize.documents,
  },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedTypes.documents.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF, Excel, CSV, and image files are allowed.'), false);
    }
  }
});

// Configure multer for logos
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      cb(null, 'company_logo_' + uniqueSuffix + ext);
    }
  }),
  limits: {
    fileSize: config.upload.maxFileSize.logos,
  },
  fileFilter: (req, file, cb) => {
    if (config.upload.allowedTypes.logos.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only images are allowed.'), false);
    }
  }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ===============================
// DATABASE CONNECTION & INITIALIZATION
// ===============================

async function initializeSystem() {
  try {
    // Create default roles
    const existingRoles = await db.collection('roles').countDocuments();
    if (existingRoles === 0) {
      await db.collection('roles').insertMany([
        {
          role_name: 'super_admin',
          permissions: ['manage_all'],
          can_view: true,
          can_answer: true,
          created_at: new Date()
        },
        {
          role_name: 'company_admin',
          permissions: ['manage_company'],
          can_view: true,
          can_answer: true,
          created_at: new Date()
        },
        {
          role_name: 'user',
          permissions: ['answer_questions'],
          can_view: true,
          can_answer: true,
          created_at: new Date()
        }
      ]);
      logger.info('Default roles created');
    }

    // Create super admin user
    const superAdminRole = await db.collection('roles').findOne({ role_name: 'super_admin' });
    const existingSuperAdmin = await db.collection('users').findOne({ role_id: superAdminRole._id });

    if (!existingSuperAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 12);
      await db.collection('users').insertOne({
        name: 'Super Admin',
        email: 'admin@traxxia.com',
        password: hashedPassword,
        role_id: superAdminRole._id,
        company_id: null,
        created_at: new Date()
      });
      logger.info('Super admin user created');
    }

    await ensureFinancialDocsDir();
    logger.info('System initialization completed');
  } catch (error) {
    logger.error('System initialization failed:', error);
  }
}

// ===============================
// ENHANCED API ENDPOINTS
// ===============================

// Health check endpoint with comprehensive monitoring
app.get('/health', (req, res) => {
  const healthStatus = monitoringService.getHealthStatus();
  res.health(healthStatus.status, healthStatus.checks);
});

// Debug endpoint with enhanced information
app.get('/debug', async (req, res) => {
  try {
    const dbStatus = databaseService.getStatus();
    const cacheStats = cacheService.getStats();
    const systemMetrics = monitoringService.getAllMetrics();
    
    res.success({
      database: dbStatus,
      cache: {
        stats: cacheStats,
        hitRates: cacheService.getHitRates()
      },
      system: systemMetrics.system,
      performance: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        requestMetrics: systemMetrics.application.requests
      }
    }, 'Debug information retrieved');
  } catch (error) {
    logger.error('Debug endpoint error:', error);
    res.internalError('Failed to retrieve debug information');
  }
});

// Performance monitoring endpoint
app.get('/metrics', requireSuperAdmin, (req, res) => {
  const report = monitoringService.generateReport();
  res.success(report, 'Performance metrics retrieved');
});

// Cache management endpoint
app.post('/cache/flush', requireSuperAdmin, (req, res) => {
  cacheService.flushAll();
  res.success(null, 'All caches flushed successfully');
});

// ===============================
// AUTHENTICATION APIs (OPTIMIZED)
// ===============================

app.post('/api/login', 
  validate(require('./src/middleware/validation').schemas.login),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      const user = await db.collection('users').findOne({ email });
      if (!user || !await bcrypt.compare(password, user.password)) {
        // Log failed login attempt
        if (user) {
          await logAuditEvent(user._id, 'login_failed', { email });
        }
        return res.unauthorized('Invalid credentials');
      }

      const role = await db.collection('roles').findOne({ _id: user.role_id });

      // Get company details including logo
      let company = null;
      if (user.company_id) {
        company = await db.collection('companies').findOne(
          { _id: user.company_id },
          { projection: { company_name: 1, logo: 1, industry: 1 } }
        );
      }

      const token = jwt.sign({
        id: user._id,
        email: user.email,
        role: role.role_name
      }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

      // Cache user data
      cacheService.setUser(user._id.toString(), { ...user, role });

      // Log successful login
      await logAuditEvent(user._id, 'login_success', {
        email,
        role: role.role_name,
        company: company?.company_name
      });

      res.success({
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: role.role_name,
          company: company ? {
            name: company.company_name,
            logo: company.logo,
            industry: company.industry
          } : null
        }
      }, 'Login successful');
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/register',
  validate(require('./src/middleware/validation').schemas.register),
  async (req, res, next) => {
    try {
      const { name, email, password, company_id, terms_accepted } = req.body;

      const existingUser = await db.collection('users').findOne({ email });
      if (existingUser) {
        return res.conflict('Email already exists');
      }

      const company = await db.collection('companies').findOne({
        _id: new ObjectId(company_id),
        status: 'active'
      });
      if (!company) {
        return res.badRequest('Invalid company');
      }

      const userRole = await db.collection('roles').findOne({ role_name: 'user' });
      const hashedPassword = await bcrypt.hash(password, 12);

      const result = await db.collection('users').insertOne({
        name,
        email,
        password: hashedPassword,
        role_id: userRole._id,
        company_id: new ObjectId(company_id),
        terms_accepted,
        created_at: new Date()
      });

      res.created({
        user_id: result.insertedId
      }, 'Registration successful');
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/logout', authenticateToken, async (req, res, next) => {
  try {
    // Clear user cache
    cacheService.deleteUser(req.user._id.toString());
    
    // Log logout event
    await logAuditEvent(req.user._id, 'logout', {
      email: req.user.email
    });

    res.success(null, 'Logged out successfully');
  } catch (error) {
    next(error);
  }
});

// ===============================
// COMPANIES API (OPTIMIZED WITH CACHING)
// ===============================

app.get('/api/companies', 
  cacheService.middleware('company', 'active_companies', 1800), // 30 minutes cache
  async (req, res, next) => {
    try {
      const companies = await db.collection('companies')
        .find({ status: 'active' })
        .project({ company_name: 1, industry: 1, logo: 1 })
        .sort({ company_name: 1 })
        .toArray();

      res.success({ companies }, 'Companies retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

// ===============================
// BUSINESSES API (OPTIMIZED)
// ===============================

app.get('/api/businesses', 
  authenticateToken,
  async (req, res, next) => {
    try {
      const { user_id } = req.query;
      let targetUserId;

      if (user_id) {
        // Admin access validation
        if (!['super_admin', 'company_admin'].includes(req.user.role.role_name)) {
          return res.forbidden('Admin access required to view other users businesses');
        }
        
        const targetUser = await db.collection('users').findOne({ _id: new ObjectId(user_id) });
        if (!targetUser) {
          return res.notFound('User not found');
        }
        
        if (req.user.role.role_name === 'company_admin') {
          if (!targetUser.company_id || targetUser.company_id.toString() !== req.user.company_id.toString()) {
            return res.forbidden('Access denied - user not in your company');
          }
        }
        targetUserId = new ObjectId(user_id);
      } else {
        targetUserId = new ObjectId(req.user._id);
      }

      // Check cache first
      const cacheKey = targetUserId.toString();
      let businesses = cacheService.getUserBusinesses(cacheKey);
      
      if (!businesses) {
        businesses = await db.collection('user_businesses')
          .find({ user_id: targetUserId })
          .sort({ created_at: -1 })
          .toArray();
        
        // Cache the results
        cacheService.setUserBusinesses(cacheKey, businesses);
      }

      res.success({
        businesses,
        user_id: targetUserId.toString()
      }, 'Businesses retrieved successfully');
    } catch (error) {
      next(error);
    }
  }
);

app.post('/api/businesses',
  authenticateToken,
  validate(require('./src/middleware/validation').schemas.createBusiness),
  async (req, res, next) => {
    try {
      const { business_name, business_purpose, description, city, country } = req.body;

      const result = await db.collection('user_businesses').insertOne({
        user_id: new ObjectId(req.user._id),
        business_name,
        business_purpose,
        description: description || '',
        city,
        country,
        has_financial_document: false,
        created_at: new Date()
      });

      // Invalidate user's business cache
      cacheService.invalidateUserBusinesses(req.user._id.toString());

      // Log audit event
      await logAuditEvent(req.user._id, 'business_created', {
        business_id: result.insertedId,
        business_name
      });

      res.created({
        business_id: result.insertedId,
        business_name
      }, 'Business created successfully');
    } catch (error) {
      next(error);
    }
  }
);

// ===============================
// AUDIT LOGGING FUNCTION (ENHANCED)
// ===============================

const logAuditEvent = async (userId, eventType, eventData = {}, businessId = null) => {
  try {
    const auditEntry = {
      user_id: new ObjectId(userId),
      business_id: businessId ? new ObjectId(businessId) : null,
      event_type: eventType,
      event_data: eventData,
      timestamp: new Date(),
      ip_address: null, // Can be enhanced with request IP
      user_agent: null  // Can be enhanced with request user agent
    };

    // For analysis_generated events, add additional tracking
    if (eventType === 'analysis_generated') {
      auditEntry.additional_info = {
        data_stored: true,
        analysis_phase: eventData.phase,
        analysis_type: eventData.analysis_type,
        logged_at: new Date().toISOString()
      };
    }

    await db.collection('audit_trail').insertOne(auditEntry);
    logger.info(`Audit event logged: ${eventType} for user ${userId}`);

  } catch (error) {
    logger.error('Failed to log audit event:', error);
    // Don't throw error to avoid breaking main functionality
  }
};

// ===============================
// ERROR HANDLING MIDDLEWARE
// ===============================

// 404 handler
app.use(notFound);

// Global error handler
app.use(errorHandler);

// ===============================
// SERVER STARTUP
// ===============================

async function startServer() {
  try {
    // Connect to database
    db = await databaseService.connect();
    
    // Initialize system
    await initializeSystem();
    
    // Start server
    const server = app.listen(port, config.server.host, () => {
      logger.info(`🚀 Traxxia API running on port ${port}`);
      logger.info(`📊 Server accessible at: http://localhost:${port}`);
      logger.info(`🔧 Environment: ${config.server.env}`);
      logger.info(`💾 Database: ${db.databaseName}`);
      logger.info(`⚡ Optimizations: Caching, Monitoring, Security enabled`);
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          await databaseService.disconnect();
          logger.info('Database connection closed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;
