const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const fs = require("fs"); // Still needed for multer error handling
const multer = require("multer"); // Still needed for top-level multer error handling
const path = require("path"); // Still needed for multer error handling

// Import configurations and database
const { BASE_URL, BACKEND_PORT } = require("./config");
const { pool } = require("./db"); // Used for overall DB connection check, not individual queries in this file

// Import routes
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const expenseRoutes = require("./routes/expenseRoutes");

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Multer error handling (keep top-level as it applies to all routes using multer)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large', details: 'File size must be less than 5MB' });
    }
    return res.status(400).json({ error: 'File upload error', details: err.message });
  }
  next(err);
});

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// Use the routes
app.use("/auth", authRoutes); // e.g., /auth/signup, /auth/login
app.use("/profile", profileRoutes); // e.g., /profile (GET), /profile (PUT)
app.use("/items", expenseRoutes); // e.g., /items (GET, POST), /items/:id (PUT, DELETE)
// You might want a root endpoint for health check
app.get('/', (req, res) => {
    res.json({ message: 'API is running' });
});


// Start Server
app.listen(BACKEND_PORT, () => {
  console.log(`🚀 Server running on ${BASE_URL}`);
});