// config.js
require("dotenv").config();

const SECRET_KEY = process.env.SECRET_KEY || "your_secret_key"; // Use environment variables
const REFRESH_KEY = process.env.REFRESH_KEY || "your_refresh_secret_key";
const BACKEND_PORT = process.env.PORT || 5000;
// const BASE_URL = `http://localhost:${BACKEND_PORT}`;
const BASE_URL = 'https://spendwise-back-end.onrender.com';

module.exports = {
  SECRET_KEY,
  REFRESH_KEY,
  BACKEND_PORT,
  BASE_URL
};