// db.js
const mysql = require("mysql2");
require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "bmeptlaonyp4rdlpgoy9-mysql.services.clever-cloud.com",
  user: process.env.DB_USER || "uzdltu6roacm8wmd",
  password: process.env.DB_PASSWORD || "N8siWLoN4YK3kTtNLIDX",
  database: process.env.DB_DATABASE || "bmeptlaonyp4rdlpgoy9",
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Check database connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
    return;
  }
  console.log("✅ Connected to Clever Cloud MySQL Database!");
  connection.release();
});

// Utility function for retrying database operations
async function retryOperation(operation, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error.code === 'ER_USER_LIMIT_REACHED') {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1))); // Exponential backoff
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

module.exports = { pool, retryOperation };