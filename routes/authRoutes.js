// routes/authRoutes.js
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const fs = require("fs");
const multer = require("multer"); // Import multer
const path = require("path");

const { pool } = require("../db"); // Import pool from db.js
const { SECRET_KEY, REFRESH_KEY, BASE_URL } = require("../config"); // Import keys and BASE_URL

// Multer configuration (copy from index.js)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (!fs.existsSync('uploads')) {
      fs.mkdirSync('uploads');
    }
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
    return cb(new Error('Only image files are allowed!'), false);
  }
  cb(null, true);
};
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// User Signup API
router.post("/signup", upload.single('profile_photo'), async (req, res) => {
  try {
    const { first_name, last_name, email, phone_number, password } = req.body;
    const profile_photo = req.file ? `${BASE_URL}/uploads/${req.file.filename}` : null;

    if (!first_name || !last_name || !email || !password || !phone_number) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Missing required fields" });
    }

    const [phoneResults] = await pool.promise().query(
      "SELECT phone_number FROM users WHERE phone_number = ?", [phone_number]
    );
    if (phoneResults.length > 0) {
      return res.status(400).json({ error: "Phone number already registered" });
    }

    const [emailResults] = await pool.promise().query(
      "SELECT email FROM users WHERE email = ?", [email]
    );
    if (emailResults.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await pool.promise().query(
      "INSERT INTO users (first_name, last_name, email, phone_number, password, profile_photo) VALUES (?, ?, ?, ?, ?, ?)",
      [first_name, last_name, email, phone_number, hashedPassword, profile_photo]
    );

    res.json({ message: "User registered successfully", user: { id: result.insertId, first_name, last_name, email, phone_number, profile_photo } });

  } catch (dbError) {
    if (req.file) fs.unlinkSync(req.file.path);
    console.error("Database error (signup):", dbError);
    return res.status(500).json({ error: "Database operation failed", details: "Please try again later" });
  }
});

// User Login API
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password are required" });

  try {
    const [results] = await pool.promise().query("SELECT * FROM users WHERE email = ?", [email]);
    if (results.length === 0) return res.status(401).json({ error: "Invalid email or password" });

    const user = results[0];
    const isMatch = await bcrypt.compare(password.trim(), user.password); // Trim password here too
    if (!isMatch) return res.status(401).json({ error: "Invalid email or password" });

    const token = jwt.sign({ userId: user.id, email: user.email }, SECRET_KEY, { expiresIn: '365d' });
    const refreshToken = jwt.sign({ userId: user.id }, REFRESH_KEY, { expiresIn: '730d' });

    await pool.promise().query("UPDATE users SET refresh_token = ? WHERE id = ?", [refreshToken, user.id]);

    const safeUser = { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, phone_number: user.phone_number, profile_photo: user.profile_photo };
    res.json({ message: "Login successful", token, refreshToken, user: safeUser });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Error during authentication", details: error.message });
  }
});

// Refresh Token API
router.post("/refresh-token", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(401).json({ error: "Refresh token required" });

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_KEY);
    const [users] = await pool.promise().query(
      "SELECT * FROM users WHERE id = ? AND refresh_token = ?", [decoded.userId, refreshToken]
    );
    if (users.length === 0) return res.status(401).json({ error: "Invalid refresh token" });

    const user = users[0];
    const newToken = jwt.sign({ userId: user.id, email: user.email }, SECRET_KEY, { expiresIn: '365d' });
    res.json({ token: newToken });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: "Invalid refresh token", details: error.message });
  }
});

// Placeholder for Google OAuth Login
router.post("/auth/google", (req, res) => {
  const { google_id, first_name, last_name, email, profile_photo } = req.body;
  if (!google_id || !email) return res.status(400).json({ error: "Google authentication failed" });

  pool.query("SELECT * FROM users WHERE google_id = ?", [google_id], (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (results.length > 0) {
      const token = jwt.sign({ userId: results[0].id }, SECRET_KEY, { expiresIn: "1h" });
      return res.json({ message: "Login successful", token });
    }

    const query = "INSERT INTO users (google_id, first_name, last_name, email, profile_photo) VALUES (?, ?, ?, ?, ?)";
    pool.query(query, [google_id, first_name, last_name, email, profile_photo], (err, results) => {
      if (err) return res.status(500).json({ error: "Signup failed" });

      const token = jwt.sign({ userId: results.insertId }, SECRET_KEY, { expiresIn: "1h" });
      res.json({ message: "User registered successfully", token });
    });
  });
});

module.exports = router;