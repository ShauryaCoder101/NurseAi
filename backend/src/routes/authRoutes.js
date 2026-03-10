// Authentication Routes
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const {authenticate} = require('../middleware/auth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', authLimiter, authController.register);
router.post('/verify-otp', otpLimiter, authController.verifyOTP);
router.post('/resend-otp', otpLimiter, authController.resendOTP);
router.post('/request-password-reset', otpLimiter, authController.requestPasswordReset);
router.post('/reset-password', otpLimiter, authController.resetPassword);
router.post('/login', loginLimiter, authController.login);
router.get('/consent', authenticate, authController.getConsentStatus);
router.post('/consent', authenticate, authController.acceptConsent);

module.exports = router;
