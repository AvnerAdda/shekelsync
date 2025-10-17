const path = require('path');
const { app } = require('electron');

// Add app directory to module search paths
require('module').globalPaths.push(path.join(__dirname, '..', 'app', 'node_modules'));

const { Pool } = require(path.join(__dirname, '..', 'app', 'node_modules', 'pg'));

class DatabaseManager {
  constructor() {
    this.pool = null;
    this.isConnected = false;
  }

  async initialize(config = null) {
    try {
      // Use provided config or load from environment
      const dbConfig = config || this.getDefaultConfig();

      console.log('Initializing database connection...');
      console.log('Config:', {
        host: dbConfig.host,
        database: dbConfig.database,
        port: dbConfig.port,
        user: dbConfig.user
      });

      this.pool = new Pool({
        user: dbConfig.user,
        host: dbConfig.host,
        database: dbConfig.database,
        password: dbConfig.password,
        port: dbConfig.port,
        ssl: false,
        max: 10, // Maximum number of clients in the pool
        idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
        connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
      });

      // Test the connection
      const client = await this.pool.connect();
      console.log('Database connection successful');

      // Test query
      const result = await client.query('SELECT NOW()');
      console.log('Database test query result:', result.rows[0]);

      client.release();
      this.isConnected = true;

      return { success: true, message: 'Database connected successfully' };
    } catch (error) {
      console.error('Database connection failed:', error);
      this.isConnected = false;
      return {
        success: false,
        message: `Database connection failed: ${error.message}`,
        error: error
      };
    }
  }

  getDefaultConfig() {
    // Load from environment variables (these will be encrypted in production)
    return {
      user: process.env.CLARIFY_DB_USER || 'clarify',
      host: process.env.CLARIFY_DB_HOST || 'localhost',
      database: process.env.CLARIFY_DB_NAME || 'my_clarify',
      password: process.env.CLARIFY_DB_PASSWORD || 'clarify_pass',
      port: parseInt(process.env.CLARIFY_DB_PORT) || 5432
    };
  }

  async getClient() {
    if (!this.pool || !this.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    try {
      return await this.pool.connect();
    } catch (error) {
      console.error('Failed to get database client:', error);
      throw error;
    }
  }

  async query(text, params = []) {
    if (!this.pool || !this.isConnected) {
      throw new Error('Database not initialized. Call initialize() first.');
    }

    const client = await this.getClient();
    try {
      const result = await client.query(text, params);
      return result;
    } catch (error) {
      console.error('Database query error:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async testConnection() {
    try {
      const result = await this.query('SELECT 1 as test');
      return { success: true, result: result.rows };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async close() {
    if (this.pool) {
      console.log('Closing database connection pool...');
      await this.pool.end();
      this.isConnected = false;
    }
  }

  // Get database statistics for debugging
  async getStats() {
    if (!this.pool) {
      return { error: 'Pool not initialized' };
    }

    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      isConnected: this.isConnected
    };
  }
}

// Create a singleton instance
const dbManager = new DatabaseManager();

module.exports = {
  DatabaseManager,
  dbManager
};