// Authentication Controller
const bcrypt = require('bcryptjs');
const {dbHelpers, generateUID} = require('../config/database');
const {generateToken} = require('../utils/jwt');
const {generateOTP, getOTPExpiry, isOTPExpired} = require('../utils/otpGenerator');
const {sendOTP, sendPasswordResetOTP} = require('../utils/emailService');

// Register user
async function register(req, res) {
  try {
    const {email, phoneNumber, password} = req.body;

    // Validation
    if (!email || !phoneNumber || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email, phone number, and password are required.',
      });
    }

    // Normalize email for consistent checking and storage
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists (case-insensitive)
    const existingUser = await dbHelpers.get(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [normalizedEmail]
    );

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'User with this email already exists.',
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate 16-digit UID
    let userUID;
    let uidExists = true;
    // Ensure UID is unique
    while (uidExists) {
      userUID = generateUID();
      const existingUID = await dbHelpers.get('SELECT uid FROM users WHERE uid = $1', [userUID]);
      if (!existingUID) {
        uidExists = false;
      }
    }

    // Create user (not verified yet) - store normalized email
    await dbHelpers.run(
      'INSERT INTO users (uid, email, phone_number, password, is_verified) VALUES ($1, $2, $3, $4, $5)',
      [userUID, normalizedEmail, phoneNumber, hashedPassword, false]
    );

    // Generate and store OTP
    const otp = generateOTP();
    const expiresAt = getOTPExpiry();

    // Delete old OTPs for this email
    await dbHelpers.run(
      "DELETE FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'verify'",
      [normalizedEmail]
    );

    // Insert new OTP (store normalized email)
    await dbHelpers.run(
      "INSERT INTO otps (email, otp, purpose, expires_at) VALUES ($1, $2, 'verify', $3)",
      [normalizedEmail, otp, expiresAt]
    );

    console.log(`📧 OTP stored for ${normalizedEmail}: ${otp}, expires at: ${expiresAt}`);

    // Send OTP email (use original email for display)
    await sendOTP(email, otp);

    res.json({
      success: true,
      message: 'Registration successful. OTP sent to your email.',
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Verify OTP
async function verifyOTP(req, res) {
  try {
    const {email, otp} = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Email and OTP are required.',
      });
    }

    // Normalize email (lowercase, trim)
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`🔍 Verifying OTP for email: ${normalizedEmail}, OTP: ${otp}`);

    // Get OTP from database - check with case-insensitive email
    const otpRecord = await dbHelpers.get(
      "SELECT * FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'verify' ORDER BY created_at DESC LIMIT 1",
      [normalizedEmail]
    );

    if (!otpRecord) {
      // Check if any OTP exists for this email (for debugging)
      const allOtps = await dbHelpers.all(
        "SELECT email, created_at FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'verify'",
        [normalizedEmail]
      );
      console.log(`❌ OTP not found for ${normalizedEmail}. Found ${allOtps.length} OTP records.`);
      if (allOtps.length === 0) {
        // Check if user exists
        const user = await dbHelpers.get('SELECT email FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
        if (!user) {
          return res.status(400).json({
            success: false,
            error: 'User not found. Please register first.',
          });
        }
      }
      return res.status(400).json({
        success: false,
        error: 'OTP not found. Please request a new OTP.',
      });
    }

    console.log(`✅ Found OTP record. Expires at: ${otpRecord.expires_at}, Current time: ${new Date()}`);

    // Check if OTP is expired
    if (isOTPExpired(otpRecord.expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired. Please request a new one.',
      });
    }

    // Verify OTP
    console.log(`🔐 Comparing OTP: Database="${otpRecord.otp}" vs Provided="${otp}"`);
    if (otpRecord.otp !== otp) {
      console.log(`❌ OTP mismatch!`);
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP. Please check and try again.',
      });
    }

    console.log(`✅ OTP matched! Verifying user...`);

    // Update user as verified (use normalized email)
    await dbHelpers.run(
      'UPDATE users SET is_verified = $1 WHERE LOWER(email) = LOWER($2)',
      [true, normalizedEmail]
    );

    // Delete used OTP (use normalized email)
    await dbHelpers.run(
      "DELETE FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'verify'",
      [normalizedEmail]
    );

    // Get user data (use normalized email)
    const user = await dbHelpers.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);

    // Generate JWT token
    const token = generateToken({userId: user.uid, email: user.email});

    res.json({
      success: true,
      message: 'OTP verified successfully.',
      data: {
        token,
        user: {
          uid: user.uid,
          email: user.email,
          phoneNumber: user.phone_number,
        },
      },
    });
  } catch (error) {
    console.error('OTP verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Resend OTP
async function resendOTP(req, res) {
  try {
    const {email} = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required.',
      });
    }

    // Normalize email (lowercase, trim) for consistent storage and checking
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists (case-insensitive)
    const user = await dbHelpers.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'User not found.',
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = getOTPExpiry();

    // Delete old OTPs
    await dbHelpers.run(
      "DELETE FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'verify'",
      [normalizedEmail]
    );

    // Insert new OTP (store normalized email)
    await dbHelpers.run(
      "INSERT INTO otps (email, otp, purpose, expires_at) VALUES ($1, $2, 'verify', $3)",
      [normalizedEmail, otp, expiresAt]
    );

    console.log(`📧 OTP resent for ${normalizedEmail}: ${otp}, expires at: ${expiresAt}`);

    // Send OTP email (use original email for display)
    await sendOTP(email, otp);

    res.json({
      success: true,
      message: 'OTP has been resent to your email.',
    });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Login
async function login(req, res) {
  try {
    const {email, password} = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required.',
      });
    }

    // Normalize email for consistent checking
    const normalizedEmail = email.toLowerCase().trim();

    // Get user (case-insensitive)
    const user = await dbHelpers.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Check if user is verified
    if (!user.is_verified) {
      return res.status(401).json({
        success: false,
        error: 'Please verify your email first.',
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    // Generate JWT token - ensure user.uid exists
    if (!user.uid) {
      console.error('Login error: User UID is missing', user);
      return res.status(500).json({
        success: false,
        error: 'User data error. Please contact support.',
      });
    }

    const token = generateToken({userId: user.uid, email: user.email});

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          uid: user.uid,
          email: user.email,
          phoneNumber: user.phone_number,
        },
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}

// Request password reset OTP
async function requestPasswordReset(req, res) {
  try {
    const {email} = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        error: 'Email is required.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await dbHelpers.get('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [
      normalizedEmail,
    ]);

    if (!user) {
      return res.status(400).json({
        success: false,
        error: 'User not found.',
      });
    }

    const otp = generateOTP();
    const expiresAt = getOTPExpiry();

    await dbHelpers.run(
      "DELETE FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'reset'",
      [normalizedEmail]
    );

    await dbHelpers.run(
      "INSERT INTO otps (email, otp, purpose, expires_at) VALUES ($1, $2, 'reset', $3)",
      [normalizedEmail, otp, expiresAt]
    );

    console.log(`📧 Password reset OTP stored for ${normalizedEmail}: ${otp}`);
    await sendPasswordResetOTP(email, otp);

    res.json({
      success: true,
      message: 'Password reset OTP sent to your email.',
    });
  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Reset password with OTP
async function resetPassword(req, res) {
  try {
    const {email, otp, newPassword} = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, OTP, and new password are required.',
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const otpRecord = await dbHelpers.get(
      "SELECT * FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'reset' ORDER BY created_at DESC LIMIT 1",
      [normalizedEmail]
    );

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'OTP not found. Please request a new one.',
      });
    }

    if (isOTPExpired(otpRecord.expires_at)) {
      return res.status(400).json({
        success: false,
        error: 'OTP has expired. Please request a new one.',
      });
    }

    if (otpRecord.otp !== otp) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP. Please check and try again.',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await dbHelpers.run('UPDATE users SET password = $1, updated_at = NOW() WHERE LOWER(email) = LOWER($2)', [
      hashedPassword,
      normalizedEmail,
    ]);

    await dbHelpers.run(
      "DELETE FROM otps WHERE LOWER(email) = LOWER($1) AND purpose = 'reset'",
      [normalizedEmail]
    );

    res.json({
      success: true,
      message: 'Password reset successfully.',
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

module.exports = {
  register,
  verifyOTP,
  resendOTP,
  login,
  requestPasswordReset,
  resetPassword,
};
