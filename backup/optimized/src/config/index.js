require('dotenv').config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 5001,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  // Database Configuration
  database: {
    uri: process.env.MONGO_URI || 'mongodb://localhost:27017/traxxia_simple',
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      useNewUrlParser: true,
      useUnifiedTopology: true
    }
  },

  // JWT Configuration
  jwt: {
    secret: process.env.SECRET_KEY || 'default_secret_key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
  },

  // Cache Configuration
  cache: {
    enabled: process.env.CACHE_ENABLED !== 'false', // Default: enabled
    defaultTTL: parseInt(process.env.CACHE_DEFAULT_TTL) || 300, // 5 minutes
    maxKeys: parseInt(process.env.CACHE_MAX_KEYS) || 1000,
    checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 120, // 2 minutes
    
    // Individual cache layer settings
    layers: {
      users: {
        enabled: process.env.CACHE_USERS_ENABLED !== 'false',
        ttl: parseInt(process.env.CACHE_USERS_TTL) || 600, // 10 minutes
        maxKeys: parseInt(process.env.CACHE_USERS_MAX_KEYS) || 500
      },
      companies: {
        enabled: process.env.CACHE_COMPANIES_ENABLED !== 'false',
        ttl: parseInt(process.env.CACHE_COMPANIES_TTL) || 1800, // 30 minutes
        maxKeys: parseInt(process.env.CACHE_COMPANIES_MAX_KEYS) || 200
      },
      questions: {
        enabled: process.env.CACHE_QUESTIONS_ENABLED !== 'false',
        ttl: parseInt(process.env.CACHE_QUESTIONS_TTL) || 3600, // 1 hour
        maxKeys: parseInt(process.env.CACHE_QUESTIONS_MAX_KEYS) || 300
      },
      businesses: {
        enabled: process.env.CACHE_BUSINESSES_ENABLED !== 'false',
        ttl: parseInt(process.env.CACHE_BUSINESSES_TTL) || 900, // 15 minutes
        maxKeys: parseInt(process.env.CACHE_BUSINESSES_MAX_KEYS) || 1000
      },
      conversations: {
        enabled: process.env.CACHE_CONVERSATIONS_ENABLED !== 'false',
        ttl: parseInt(process.env.CACHE_CONVERSATIONS_TTL) || 300, // 5 minutes
        maxKeys: parseInt(process.env.CACHE_CONVERSATIONS_MAX_KEYS) || 500
      }
    }
  },

  // Azure Storage Configuration
  azure: {
    storageAccount: process.env.AZURE_STORAGE_ACCOUNT,
    storageKey: process.env.AZURE_STORAGE_KEY,
    storageContainer: process.env.AZURE_STORAGE_CONTAINER || 'traxxia-documents'
  },

  // File Upload Configuration
  upload: {
    maxFileSize: {
      documents: 10 * 1024 * 1024, // 10MB
      logos: 5 * 1024 * 1024 // 5MB
    },
    allowedTypes: {
      documents: [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/webp'
      ],
      logos: ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    }
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: process.env.NODE_ENV !== 'production',
    enableFile: true
  }
};

// Validation
const requiredEnvVars = [
  'MONGO_URI',
  'SECRET_KEY',
  'AZURE_STORAGE_ACCOUNT',
  'AZURE_STORAGE_KEY'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.warn(`⚠️  Missing environment variables: ${missingEnvVars.join(', ')}`);
  console.warn('Application may not function correctly without these variables.');
}

module.exports = config;
