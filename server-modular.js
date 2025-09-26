// ===============================
// TRAXXIA BACKEND - MODULAR VERSION
// ===============================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// Import modular components
const databaseConnection = require('./config/database');
const authMiddleware = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const companiesRoutes = require('./routes/companies');
const usersRoutes = require('./routes/users');
const questionsRoutes = require('./routes/questions');
const businessesRoutes = require('./routes/businesses');
const conversationsRoutes = require('./routes/conversations');
const phaseAnalysisRoutes = require('./routes/phaseAnalysis');
const adminRoutes = require('./routes/admin');
const financialDocumentsRoutes = require('./routes/financialDocuments');
const { logAuditTrail } = require('./utils/helpers');

const app = express();
const PORT = process.env.PORT || 5001;

// Global database variable
let db;

// Middleware
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = file.fieldname === 'logo' ? 'uploads/logos' : 'uploads/documents';
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const prefix = file.fieldname === 'logo' ? 'company_logo_' : 'document_';
    cb(null, prefix + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'logo') {
      // Logo files: images only
      if (file.mimetype.startsWith('image/')) {
        cb(null, true);
      } else {
        cb(new Error('Logo must be an image file'), false);
      }
    } else {
      // Document files: various formats
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'image/jpeg',
        'image/png'
      ];
      if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type'), false);
      }
    }
  }
});

// Initialize database connection and set up routes
const initializeApp = async () => {
  try {
    // Connect to database
    db = await databaseConnection.connect();
    
    // Set database instance for all modules
    authMiddleware.setDatabase(db);
    authRoutes.setDatabase(db);
    companiesRoutes.setDatabase(db);
    usersRoutes.setDatabase(db);
    questionsRoutes.setDatabase(db);
    businessesRoutes.setDatabase(db);
    conversationsRoutes.setDatabase(db);
    phaseAnalysisRoutes.setDatabase(db);
    adminRoutes.setDatabase(db);
    financialDocumentsRoutes.setDatabase(db);
    
    console.log('✅ All modules initialized with database connection');
    
    // Setup routes
    setupRoutes();
    
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
};

// Setup all routes
const setupRoutes = () => {
  // Health check endpoint
  app.get('/health', async (req, res) => {
    try {
      const stats = await Promise.all([
        db.collection('companies').countDocuments(),
        db.collection('users').countDocuments(),
        db.collection('global_questions').countDocuments(),
        db.collection('user_businesses').countDocuments()
      ]);
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: 'connected',
        collections: {
          companies: stats[0],
          users: stats[1],
          questions: stats[2],
          businesses: stats[3]
        }
      });
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        error: 'Database connection failed'
      });
    }
  });

  // Authentication routes
  app.use('/api', authRoutes.router);
  
  // Companies routes (public endpoint)
  app.use('/api/companies', companiesRoutes.router);
  
  // Protected companies admin routes
  app.use('/api/admin/companies', 
    authMiddleware.authenticateToken, 
    authMiddleware.requireAdmin, 
    companiesRoutes.router
  );

  // Users routes (protected)
  app.use('/api/users', 
    authMiddleware.authenticateToken, 
    usersRoutes.router
  );

  // Admin users routes
  app.use('/api/admin/users', 
    authMiddleware.authenticateToken, 
    authMiddleware.requireAdmin, 
    usersRoutes.router
  );

  // Questions routes (protected)
  app.use('/api/questions', 
    authMiddleware.authenticateToken, 
    questionsRoutes.router
  );

  // Admin questions routes (super admin only)
  app.use('/api/admin/questions', 
    authMiddleware.authenticateToken, 
    authMiddleware.requireSuperAdmin, 
    questionsRoutes.router
  );

  // Businesses routes (protected)
  app.use('/api/businesses', 
    authMiddleware.authenticateToken, 
    businessesRoutes.router
  );

  // Conversations routes (protected)
  app.use('/api/conversations', 
    authMiddleware.authenticateToken, 
    conversationsRoutes.router
  );

  // Phase analysis routes (protected)
  app.use('/api/phase-analysis', 
    authMiddleware.authenticateToken, 
    phaseAnalysisRoutes.router
  );

  // Admin routes (admin and super admin only)
  app.use('/api/admin', 
    authMiddleware.authenticateToken, 
    authMiddleware.requireAdmin, 
    adminRoutes.router
  );

  // Financial documents routes (protected)
  app.use('/api/businesses', 
    authMiddleware.authenticateToken, 
    financialDocumentsRoutes.router
  );

  // Additional utility routes
  setupRemainingRoutes();
};

// Additional utility routes
const setupRemainingRoutes = () => {

  // Logout endpoint
  app.post('/api/logout', authMiddleware.authenticateToken, async (req, res) => {
    try {
      // Log logout event
      await logAuditTrail(db, req.user._id, 'logout', {
        timestamp: new Date()
      });
      
      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Debug endpoint
  app.get('/debug', async (req, res) => {
    try {
      const stats = await Promise.all([
        db.collection('companies').countDocuments(),
        db.collection('users').countDocuments(),
        db.collection('global_questions').countDocuments(),
        db.collection('user_businesses').countDocuments()
      ]);
      
      res.json({
        status: 'debug',
        timestamp: new Date().toISOString(),
        database: 'connected',
        collections: {
          companies: stats[0],
          users: stats[1],
          questions: stats[2],
          businesses: stats[3]
        },
        server_info: {
          node_version: process.version,
          platform: process.platform,
          uptime: process.uptime()
        }
      });
    } catch (error) {
      console.error('Debug endpoint error:', error);
      res.status(500).json({
        status: 'error',
        error: 'Debug information unavailable'
      });
    }
  });

  // File upload endpoint
  app.post('/api/upload', authMiddleware.authenticateToken, upload.single('file'), (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.fieldname === 'logo' ? 'logos' : 'documents'}/${req.file.filename}`;
      
      res.json({
        message: 'File uploaded successfully',
        file: {
          filename: req.file.filename,
          originalname: req.file.originalname,
          size: req.file.size,
          url: fileUrl
        }
      });
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({ error: 'File upload failed' });
    }
  });

  // Error handling middleware
  app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
      }
    }
    
    console.error('Unhandled error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  try {
    await databaseConnection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// Start server
const startServer = async () => {
  await initializeApp();
  
  app.listen(PORT, () => {
    console.log('Connected to MongoDB');
    console.log(`Traxxia API running on port ${PORT}`);
    console.log(`Server accessible at: http://localhost:${PORT}`);
    console.log('📁 Modular structure initialized');
  });
};

// Start the application
startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});

module.exports = app;
