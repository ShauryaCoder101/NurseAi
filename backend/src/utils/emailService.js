// Email Service for sending OTP
const nodemailer = require('nodemailer');

// Create transporter (configure based on your email provider)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Send OTP email
async function sendOTPEmail(email, otp) {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'NurseAI <noreply@nurseai.com>',
      to: email,
      subject: 'NurseAI - OTP Verification',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #007AFF;">NurseAI - OTP Verification</h2>
          <p>Your OTP for registration is:</p>
          <div style="background-color: #F5F5F5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
            <h1 style="color: #007AFF; font-size: 32px; margin: 0;">${otp}</h1>
          </div>
          <p>This OTP will expire in ${process.env.OTP_EXPIRY_MINUTES || 10} minutes.</p>
          <p style="color: #999; font-size: 12px;">If you didn't request this OTP, please ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('OTP email sent:', info.messageId);
    return {success: true, messageId: info.messageId};
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return {success: false, error: error.message};
  }
}

// For development: if email is not configured, log OTP to console
async function sendOTP(email, otp) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email credentials are not configured');
    }
    console.log('\n========================================');
    console.log('📧 OTP EMAIL (Development Mode)');
    console.log('========================================');
    console.log(`To: ${email}`);
    console.log(`OTP: ${otp}`);
    console.log('========================================\n');
    return {success: true, messageId: 'console-log'};
  }

  return await sendOTPEmail(email, otp);
}

module.exports = {
  sendOTP,
};
