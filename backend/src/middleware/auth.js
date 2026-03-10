// Authentication Middleware
const {verifyToken} = require('../utils/jwt');
const {dbHelpers} = require('../config/database');

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided. Authorization required.',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token.',
      });
    }

    // Verify user still exists (using UID)
    const user = await dbHelpers.get('SELECT * FROM users WHERE uid = $1', [decoded.userId]);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'User not found.',
      });
    }

    // Block access until Terms & Conditions are accepted (except consent endpoint)
    const isConsentEndpoint = req.baseUrl === '/api/auth' && req.path === '/consent';
    if (!user.has_consented && !isConsentEndpoint) {
      return res.status(403).json({
        success: false,
        error: 'Please accept the Terms & Conditions to continue.',
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      error: 'Authentication failed.',
    });
  }
}

module.exports = {
  authenticate,
};
