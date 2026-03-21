const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

function authenticateDoctor(req, res, next) {
  try {
    let token;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No token provided or invalid format',
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'doctor') {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions. Doctor access required.',
      });
    }

    req.doctorId = decoded.userId;
    next();
  } catch (error) {
    console.error('Doctor Auth Error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired',
      });
    }
    return res.status(401).json({
      success: false,
      error: 'Invalid token',
    });
  }
}

module.exports = {
  authenticateDoctor,
};
