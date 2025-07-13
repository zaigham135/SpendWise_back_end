const express = require("express");
const bodyParser = require("body-parser");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const SECRET_KEY = "your_secret_key"; // Change this to a secure key
const REFRESH_KEY = "your_refresh_secret_key"; // Add refresh key
const BACKEND_PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${BACKEND_PORT}`; // Use http, dynamically use the port

// Configure multer for file uploads
// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Ensure uploads directory exists
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // Create a unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  // Accept images only
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max file size
  }
});

// Serve static files from uploads directory
app.use('/uploads', express.static('uploads'));

// ✅ MySQL Connection Pool (Clever Cloud)
const pool = mysql.createPool({
  host: "bmeptlaonyp4rdlpgoy9-mysql.services.clever-cloud.com",
  user: "uzdltu6roacm8wmd",
  password: "N8siWLoN4YK3kTtNLIDX",
  database: "bmeptlaonyp4rdlpgoy9",
  waitForConnections: true,
  connectionLimit: 5, // Reduce from 10 to 5
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// Add a utility function for retrying database operations
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

// ✅ Check database connection
pool.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", err);
    return;
  }
  console.log("✅ Connected to Clever Cloud MySQL Database!");
  connection.release();
});

// ✅ Modified User Signup API with file upload
app.post("/signup", upload.single('profile_photo'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone_number, password } = req.body;

    // Update the profile photo URL to include the full server URL
    const profile_photo = req.file
      ? `${BASE_URL}/uploads/${req.file.filename}`  // Full URL
      : null;

    console.log('File uploaded:', req.file); // Debug log
    console.log('Profile photo URL:', profile_photo); // Debug log

    // Validate required fields
    if (!first_name || !last_name || !email || !password || !phone_number) {
      // If there was a file uploaded but validation failed, delete it
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      return res.status(400).json({
        error: "Missing required fields",
        required: ['first_name', 'last_name', 'email', 'password', 'phone_number'],
        received: Object.keys(req.body)
      });
    }

    // Check for duplicate phone number first
    try {
      const [phoneResults] = await pool.promise().query(
        "SELECT phone_number FROM users WHERE phone_number = ?",
        [phone_number]
      );

      if (phoneResults.length > 0) {
        return res.status(400).json({
          error: "Phone number already registered",
          field: "phone_number"
        });
      }

      // Only check email if phone number is unique
      const [emailResults] = await pool.promise().query(
        "SELECT email FROM users WHERE email = ?",
        [email]
      );

      if (emailResults.length > 0) {
        return res.status(400).json({
          error: "Email already registered",
          field: "email"
        });
      }

      // If both checks pass, create the user
      const hashedPassword = await bcrypt.hash(password, 10);
      const [result] = await pool.promise().query(
        "INSERT INTO users (first_name, last_name, email, phone_number, password, profile_photo) VALUES (?, ?, ?, ?, ?, ?)",
        [first_name, last_name, email, phone_number, hashedPassword, profile_photo]
      );

      res.json({
        message: "User registered successfully",
        user: {
          id: result.insertId,
          first_name,
          last_name,
          email,
          phone_number,
          profile_photo
        }
      });

    } catch (dbError) {
      // If database operation failed, delete the uploaded file
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }
      console.error("Database error:", dbError);
      return res.status(500).json({
        error: "Database operation failed",
        details: "Please try again later"
      });
    }

  } catch (error) {
    // If any error occurred, delete the uploaded file
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    console.error("Signup error:", error);
    res.status(500).json({
      error: "Registration failed",
      details: error.message
    });
  }
});

// Add error handling middleware for multer
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        details: 'File size must be less than 5MB'
      });
    }
    return res.status(400).json({
      error: 'File upload error',
      details: err.message
    });
  }
  next(err);
});

// ✅ User Login API with long-lived token
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  console.log("Login attempt for email:", email); // Debug log

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const query = "SELECT * FROM users WHERE email = ?";
  pool.query(query, [email], async (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (results.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = results[0];
    console.log("Stored hashed password:", user.password);
    console.log("Attempting to compare with provided password");

    try {
      // Make sure the password is properly trimmed and handled
      const cleanPassword = password.trim();
      const isMatch = await bcrypt.compare(cleanPassword, user.password);
      console.log("Password match:", isMatch);

      if (!isMatch) {
        return res.status(401).json({ error: "Invalid email or password" });
      }

      // Create tokens with very long expiration
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email
        },
        SECRET_KEY,
        { expiresIn: '365d' }  // Token valid for 1 year
      );

      // Create refresh token
      const refreshToken = jwt.sign(
        { userId: user.id },
        REFRESH_KEY,
        { expiresIn: '730d' }  // Refresh token valid for 2 years
      );

      // Store refresh token in database
      await pool.promise().query(
        "UPDATE users SET refresh_token = ? WHERE id = ?",
        [refreshToken, user.id]
      );

      // Remove sensitive data before sending response
      const safeUser = {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        phone_number: user.phone_number,
        profile_photo: user.profile_photo
      };

      res.json({
        message: "Login successful",
        token,
        refreshToken,
        user: safeUser
      });
    } catch (error) {
      console.error("Password comparison error:", error);
      res.status(500).json({ error: "Error during authentication" });
    }
  });
});

// Add refresh token endpoint
app.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(401).json({ error: "Refresh token required" });
  }

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_KEY);
    const [users] = await pool.promise().query(
      "SELECT * FROM users WHERE id = ? AND refresh_token = ?",
      [decoded.userId, refreshToken]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const user = users[0];
    const newToken = jwt.sign(
      { userId: user.id, email: user.email },
      SECRET_KEY,
      { expiresIn: '365d' }
    );

    res.json({
      token: newToken
    });

  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// ✅ Get User Profile API (Protected Route)
app.get("/profile", verifyToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    const [user] = await pool.promise().query(
      "SELECT id, first_name, last_name, email, phone_number, profile_photo FROM users WHERE id = ?",
      [userId]
    );

    if (!user || user.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user[0]);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// Update Profile API (Protected Route)
app.put("/profile", verifyToken, upload.single('profile_photo'), async (req, res) => {
  const userId = req.user.userId;
  const { first_name, last_name, phone_number, email } = req.body;

  try {
    // Validate email format if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      // Check if email already exists for another user
      const [emailExists] = await pool.promise().query(
        "SELECT id FROM users WHERE email = ? AND id != ?",
        [email, userId]
      );

      if (emailExists.length > 0) {
        return res.status(400).json({ error: "Email already in use" });
      }
    }

    // Check if phone number already exists for another user
    if (phone_number) {
      const [phoneExists] = await pool.promise().query(
        "SELECT id FROM users WHERE phone_number = ? AND id != ?",
        [phone_number, userId]
      );

      if (phoneExists.length > 0) {
        return res.status(400).json({ error: "Phone number already in use" });
      }
    }

    // Handle profile photo update if provided
    let profile_photo = undefined;
    if (req.file) {
      profile_photo = `${BASE_URL}/uploads/${req.file.filename}`;

      // Get old profile photo to delete
      const [oldPhoto] = await pool.promise().query(
        "SELECT profile_photo FROM users WHERE id = ?",
        [userId]
      );

      // Delete old profile photo if it exists
      if (oldPhoto[0]?.profile_photo) {
        const oldPhotoPath = oldPhoto[0].profile_photo.replace(BASE_URL + '/', '');
        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }
    }

    // Build update query dynamically based on provided fields
    const updateFields = [];
    const values = [];

    if (first_name) {
      updateFields.push("first_name = ?");
      values.push(first_name);
    }
    if (last_name) {
      updateFields.push("last_name = ?");
      values.push(last_name);
    }
    if (phone_number) {
      updateFields.push("phone_number = ?");
      values.push(phone_number);
    }
    if (email) {
      updateFields.push("email = ?");
      values.push(email);
    }
    if (profile_photo) {
      updateFields.push("profile_photo = ?");
      values.push(profile_photo);
    }

    values.push(userId);

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const updateQuery = `
      UPDATE users
      SET ${updateFields.join(", ")}
      WHERE id = ?
    `;trim();

    const [result] = await pool.promise().query(updateQuery, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Fetch updated user data
    const [updatedUser] = await pool.promise().query(
      "SELECT id, first_name, last_name, email, phone_number, profile_photo FROM users WHERE id = ?",
      [userId]
    );

    res.json({
      message: "Profile updated successfully",
      user: updatedUser[0]
    });

  } catch (error) {
    console.error("Profile update error:", error);
    // Delete uploaded file if there was an error
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({
      error: "Failed to update profile",
      details: error.message
    });
  }
});

// ✅ Placeholder for Google OAuth Login (To Be Implemented)
app.post("/auth/google", (req, res) => {
  const { google_id, first_name, last_name, email, profile_photo } = req.body;

  if (!google_id || !email) {
    return res.status(400).json({ error: "Google authentication failed" });
  }

  // Check if user exists
  pool.query("SELECT * FROM users WHERE google_id = ?", [google_id], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length > 0) {
      // If user exists, return JWT
      const token = jwt.sign({ userId: results[0].id }, SECRET_KEY, { expiresIn: "1h" });
      return res.json({ message: "Login successful", token });
    }

    // If new user, register them
    const query = "INSERT INTO users (google_id, first_name, last_name, email, profile_photo) VALUES (?, ?, ?, ?, ?)";
    pool.query(query, [google_id, first_name, last_name, email, profile_photo], (err, results) => {
      if (err) return res.status(500).json({ error: "Signup failed" });

      const token = jwt.sign({ userId: results.insertId }, SECRET_KEY, { expiresIn: "1h" });
      res.json({ message: "User registered successfully", token });
    });
  });
});

// ✅ Updated Expense Record CRUD APIs with user association
app.get("/items", verifyToken, (req, res) => {
  const userId = req.user.userId; // Changed from id to userId

  pool.query(
    "SELECT id, title, value, date, section, target, payment_mode, notes, user_id FROM infodata WHERE user_id = ?",
    [userId],
    (err, results) => {
      if (err) {
        console.error("Error fetching items:", err);
        return res.status(500).json({ error: "Failed to fetch items." });
      }
      res.json(results);
    }
  );
});

// Update items POST endpoint with better error handling and new fields
app.post("/items", verifyToken, (req, res) => {
  const { title, value, date, section, target, payment_mode, notes } = req.body;  // Added payment_mode, notes
  const userId = req.user.userId; // Changed from id to userId to match token payload

  console.log('Request body for new item:', { title, value, date, section, target, payment_mode, notes, userId });

  if (!title || value === undefined || !date || !section) { // value can be 0, so check for undefined
    return res.status(400).json({
      error: "All fields (title, value, date, section) are required",
      received: { title, value, date, section, target, payment_mode, notes }
    });
  }

  // Ensure value is a number
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) {
    return res.status(400).json({ error: "Value must be a valid number." });
  }

  // Format date to 'YYYY-MM-DD' for MySQL if needed
  const formattedDate = new Date(date).toISOString().split('T')[0];

  const query = "INSERT INTO infodata (title, value, date, section, target, payment_mode, notes, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  // `target` can be optional, default to 0 if not provided
  const values = [
    title,
    numericValue,
    formattedDate,
    section,
    target !== undefined ? parseFloat(target) : 0, // Ensure target is parsed if provided, else default to 0
    payment_mode || null, // Allow null if not provided
    notes || null,       // Allow null if not provided
    userId
  ];

  console.log('Executing query:', query);
  console.log('With values:', values);

  pool.query(query, values, (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        error: "Failed to add item",
        details: err.message,
        sqlMessage: err.sqlMessage,
        sqlState: err.sqlState
      });
    }

    // Log successful insert
    console.log('Item added successfully:', result);

    res.status(201).json({ // Use 201 for resource creation
      message: "Item added successfully",
      item: {
        id: result.insertId,
        title,
        value: numericValue,
        date: formattedDate,
        section,
        target: target !== undefined ? parseFloat(target) : 0,
        payment_mode: payment_mode || null, // Include in response
        notes: notes || null,            // Include in response
        user_id: userId
      }
    });
  });
});

app.delete("/items/:id", verifyToken, (req, res) => {
  const { id } = req.params;
  const userId = req.user.userId; // Changed from id to userId

  pool.query(
    "DELETE FROM infodata WHERE id = ? AND user_id = ?",
    [id, userId],
    (err) => {
      if (err) {
        console.error("Error deleting item:", err);
        return res.status(500).json({ error: "Failed to delete item." });
      }
      res.json({ message: "Item deleted successfully" });
    }
  );
});

// Update endpoint with new columns and retry utility
app.put("/items/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { title, value, date, section, target, payment_mode, notes } = req.body; // Added payment_mode, notes
  const userId = req.user.userId;

  // Ensure value and target are numbers
  const numericValue = parseFloat(value);
  if (isNaN(numericValue)) {
    return res.status(400).json({ error: "Value must be a valid number." });
  }

  const numericTarget = target !== undefined ? parseFloat(target) : 0;
  if (isNaN(numericTarget)) {
    return res.status(400).json({ error: "Target must be a valid number." });
  }

  const formattedDate = new Date(date).toISOString().split('T')[0];

  let connection;
  try {
    // Use the retry operation utility
    connection = await retryOperation(async () => {
      const conn = await pool.promise().getConnection();
      await conn.beginTransaction();
      return conn;
    });

    // Update target for all items in the same section
    // This logic suggests 'target' is a section-level property
    if (target !== undefined) {
      await retryOperation(async () => {
        await connection.query(
          "UPDATE infodata SET target = ? WHERE section = ? AND user_id = ?",
          [numericTarget, section, userId]
        );
      });
    }

    // Update specific item, including new fields
    await retryOperation(async () => {
      await connection.query(
        `UPDATE infodata
         SET title = ?, value = ?, date = ?, section = ?, payment_mode = ?, notes = ?
         WHERE id = ? AND user_id = ?`,
        [title, numericValue, formattedDate, section, payment_mode || null, notes || null, id, userId]
      );
    });

    await connection.commit();

    // Fetch updated items (including new fields)
    const [updatedItems] = await retryOperation(async () => {
      return await pool.promise().query(
        "SELECT id, title, value, date, section, target, payment_mode, notes, user_id FROM infodata WHERE section = ? AND user_id = ?",
        [section, userId]
      );
    });

    res.json({
      message: "Items updated successfully",
      updatedItem: {
        id: parseInt(id),
        title,
        value: numericValue,
        date: formattedDate,
        section,
        target: numericTarget,
        payment_mode: payment_mode || null, // Include in response
        notes: notes || null,            // Include in response
        user_id: userId
      },
      sectionItems: updatedItems
    });

  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error("Error updating items:", error);
    res.status(500).json({
      error: "Failed to update items",
      details: error.message
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
});

// Update token verification middleware to handle expired tokens
function verifyToken(req, res, next) {
  try {
    const bearerHeader = req.headers.authorization;
    if (!bearerHeader) {
      return res.status(401).json({ error: "No authorization header" });
    }

    const token = bearerHeader.split(" ")[1];
    if (!token) {
      return res.status(401).json({ error: "No token provided" });
    }

    const decoded = jwt.verify(token, SECRET_KEY);
    req.user = decoded; // This now contains userId from token
    next();
  } catch (error) {
    return res.status(403).json({ error: "Invalid token" });
  }
}

// ✅ Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${BASE_URL}`);
});