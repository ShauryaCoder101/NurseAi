// Main Server File
if (process.env.NODE_ENV !== 'production') {
require('dotenv').config();
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Import routes
const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const transcriptRoutes = require('./routes/transcriptRoutes');
const audioRoutes = require('./routes/audioRoutes');

// Initialize Express app
const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is required in production');
  process.exit(1);
}

// Middleware
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

if (isProduction) {
  // Trust the ELB/NGINX proxy so rate limits use real client IPs
  app.set('trust proxy', 1);
}

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || !isProduction) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
};

// Health check endpoint (before ALL middleware - ELB needs this)
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'NurseAI Backend API is running',
    timestamp: new Date().toISOString(),
  });
});

// Root route for ELB health checks (some ELBs check / as well)
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'NurseAI Backend API',
    health: '/health',
  });
});

app.use(helmet());
app.use(cors(corsOptions)); // Enable CORS for frontend
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({extended: true})); // Parse URL-encoded bodies

if (!isProduction) {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/transcripts', transcriptRoutes);
app.use('/api/audio', audioRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large.',
    });
  }
  if (err?.message?.includes('Invalid')) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 NurseAI Backend Server running on port ${PORT}`);
  console.log(`📡 API Base URL: http://localhost:${PORT}/api`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}\n`);
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY is NOT set');
  } else {
    console.log('✅ GEMINI_API_KEY loaded');
  }
  if (isProduction && !process.env.CORS_ORIGINS) {
    console.warn('⚠️  CORS_ORIGINS is not set; CORS will block all origins.');
  }
});

module.exports = app;
