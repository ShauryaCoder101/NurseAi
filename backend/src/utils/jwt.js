// JWT Utility Functions
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET is required in production');
}

const EFFECTIVE_JWT_SECRET =
  JWT_SECRET || 'dev-insecure-jwt-secret-change-me';

function generateToken(payload) {
  return jwt.sign(payload, EFFECTIVE_JWT_SECRET, {expiresIn: JWT_EXPIRES_IN});
}

function verifyToken(token) {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET);
  } catch (error) {
    return null;
  }
}

module.exports = {
  generateToken,
  verifyToken,
};
