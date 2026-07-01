const jwt = require('jsonwebtoken');

function benchmarkAuth(req, res, next) {
  const expectedPassword = process.env.BENCHMARK_PASSWORD;

  // Check benchmark password first (original flow)
  const provided =
    req.headers['x-benchmark-password'] ||
    req.headers['x-company-password'] ||
    req.query?.password;

  if (provided && expectedPassword && provided === expectedPassword) {
    return next();
  }

  // Also accept doctor JWT token (so the portal can call benchmark APIs)
  const doctorToken =
    req.headers['x-benchmark-key'] ||
    (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');

  if (doctorToken) {
    try {
      const secret = process.env.DOCTOR_JWT_SECRET || process.env.JWT_SECRET || 'nurse-ai-doctor-secret';
      jwt.verify(doctorToken, secret);
      return next();
    } catch (_) {
      // Token invalid, fall through
    }
  }

  return res.status(401).json({
    success: false,
    error: 'Invalid benchmark password or token.',
  });
}

module.exports = {
  benchmarkAuth,
};
