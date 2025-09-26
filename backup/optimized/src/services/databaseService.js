const { MongoClient } = require('mongodb');
const config = require('../config');

class DatabaseService {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      console.log('🔄 Connecting to MongoDB...');
      this.client = new MongoClient(config.database.uri, config.database.options);
      await this.client.connect();
      this.db = this.client.db();
      this.isConnected = true;
      
      await this.createIndexes();
      console.log(`✅ Connected to MongoDB: ${this.db.databaseName}`);
      
      return this.db;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error);
      throw error;
    }
  }

  async createIndexes() {
    const indexOperations = [
      // Audit trail indexes - OPTIMIZED
      {
        collection: 'audit_trail',
        indexes: [
          { key: { user_id: 1 } },
          { key: { timestamp: -1 } },
          { key: { event_type: 1 } },
          { key: { user_id: 1, timestamp: -1 } }, // Compound index for user timeline
          { key: { event_type: 1, timestamp: -1 } }, // Compound index for event filtering
          { key: { timestamp: 1 }, options: { expireAfterSeconds: 31536000 } } // TTL index (1 year)
        ]
      },
      // User indexes - OPTIMIZED
      {
        collection: 'users',
        indexes: [
          { key: { email: 1 }, options: { unique: true } },
          { key: { company_id: 1 } },
          { key: { role_id: 1 } },
          { key: { company_id: 1, role_id: 1 } } // Compound index for company-role queries
        ]
      },
      // Business indexes - OPTIMIZED
      {
        collection: 'user_businesses',
        indexes: [
          { key: { user_id: 1 } },
          { key: { user_id: 1, created_at: -1 } }, // For sorted user business lists
          { key: { business_name: 1 } },
          { key: { user_id: 1, business_name: 1 } } // Compound for user-specific business search
        ]
      },
      // Conversation indexes - OPTIMIZED
      {
        collection: 'user_business_conversations',
        indexes: [
          { key: { user_id: 1, business_id: 1 } },
          { key: { question_id: 1 } },
          { key: { phase: 1 } },
          { key: { created_at: -1 } },
          { key: { user_id: 1, phase: 1 } }, // For phase-specific user queries
          { key: { business_id: 1, phase: 1 } } // For business phase analysis
        ]
      },
      // Question indexes - OPTIMIZED
      {
        collection: 'global_questions',
        indexes: [
          { key: { phase: 1, order: 1 } }, // Primary sorting index
          { key: { is_active: 1 } },
          { key: { used_for: 1 } },
          { key: { phase: 1, is_active: 1, order: 1 } } // Compound for active questions by phase
        ]
      },
      // Company indexes - NEW
      {
        collection: 'companies',
        indexes: [
          { key: { status: 1 } },
          { key: { company_name: 1 } },
          { key: { status: 1, company_name: 1 } } // For active company listings
        ]
      }
    ];

    for (const { collection, indexes } of indexOperations) {
      try {
        await this.db.collection(collection).createIndexes(
          indexes.map(index => ({
            key: index.key,
            ...index.options
          }))
        );
        console.log(`✅ Indexes created for ${collection}`);
      } catch (error) {
        console.error(`❌ Failed to create indexes for ${collection}:`, error.message);
      }
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('🔌 MongoDB connection closed');
    }
  }

  getDb() {
    if (!this.db || !this.isConnected) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  // Connection health check
  async ping() {
    try {
      await this.db.admin().ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  // Get connection status
  getStatus() {
    return {
      connected: this.isConnected,
      database: this.db ? this.db.databaseName : null,
      serverStatus: this.client ? 'connected' : 'disconnected'
    };
  }
}

module.exports = new DatabaseService();
