const { MongoClient } = require('mongodb');

class DatabaseConnection {
  constructor() {
    this.client = null;
    this.db = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      console.log('=== MONGODB DEBUG INFO ===');
      console.log('Raw MONGO_URI from env:', process.env.MONGO_URI ? 'SET' : 'NOT SET');
      
      const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/traxxia_simple';
      console.log('Using MONGO_URI:', mongoUri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@'));
      
      this.client = new MongoClient(mongoUri);
      await this.client.connect();
      
      this.db = this.client.db();
      this.isConnected = true;
      
      console.log('Connected to database:', this.db.databaseName);
      console.log('=== END DEBUG INFO ===');
      
      // Create indexes for audit trail
      await this.createAuditIndexes();
      
      return this.db;
    } catch (error) {
      console.error('MongoDB connection failed:', error);
      throw error;
    }
  }

  async createAuditIndexes() {
    try {
      const auditCollection = this.db.collection('audit_trail');
      
      // Create indexes for better query performance
      await auditCollection.createIndex({ user_id: 1 });
      await auditCollection.createIndex({ timestamp: -1 });
      await auditCollection.createIndex({ event_type: 1 });
      await auditCollection.createIndex({ user_id: 1, timestamp: -1 });
      
      console.log('Audit trail indexes created successfully');
    } catch (error) {
      console.error('Error creating audit indexes:', error);
    }
  }

  getDb() {
    if (!this.isConnected || !this.db) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.db;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.isConnected = false;
      console.log('Database connection closed');
    }
  }
}

module.exports = new DatabaseConnection();
