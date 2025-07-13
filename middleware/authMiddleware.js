// middleware/authMiddleware.js
const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config"); // Import SECRET_KEY

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
    req.user = decoded;
    next();
  } catch (error) {
    // console.error("Token verification error:", error); // For debugging
    if (error.name === 'TokenExpiredError') {
      return res.status(403).json({ error: "Token expired", details: error.message });
    }
    return res.status(403).json({ error: "Invalid token", details: error.message });
  }
}

module.exports = verifyToken;