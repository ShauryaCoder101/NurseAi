// OTP Generator Utility
const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES) || 10;

function generateOTP() {
  // Generate 6-digit OTP
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function getOTPExpiry() {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + OTP_EXPIRY_MINUTES);
  return expiry;
}

function isOTPExpired(expiresAt) {
  return new Date() > new Date(expiresAt);
}

module.exports = {
  generateOTP,
  getOTPExpiry,
  isOTPExpired,
};
