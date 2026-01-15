# NurseAI Backend API

Node.js/Express backend server for the NurseAI mobile application with PostgreSQL database.

## Features

- User authentication (Register, Login, OTP verification)
- JWT token-based authentication
- PostgreSQL database
- Email OTP service
- Dashboard API endpoints
- Transcript management
- Patient tasks management

## Prerequisites

- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)

## Setup

1. **Install PostgreSQL:**
   - Install PostgreSQL on your system
   - Create a database named `nurseai`:
   ```sql
   CREATE DATABASE nurseai;
   ```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment variables:**
```bash
cp .env.example .env
```

Edit `.env` file with your PostgreSQL configuration:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=nurseai
DB_USER=postgres
DB_PASSWORD=your_postgres_password
JWT_SECRET=your-secret-key
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

4. **Start the server:**
```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

The database tables will be automatically created on first run.

## API Endpoints

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/verify-otp` - Verify OTP and complete registration
- `POST /api/auth/resend-otp` - Resend OTP
- `POST /api/auth/login` - Login user

### Dashboard

- `GET /api/dashboard/summary` - Get dashboard summary (pending/done counts)
- `GET /api/dashboard/patient-tasks` - Get patient tasks (sorted by emergency)

### Transcripts

- `GET /api/transcripts` - Get all transcripts
- `GET /api/transcripts/:id` - Get single transcript
- `POST /api/transcripts` - Save new transcript

## Database Schema

The following tables are automatically created:

- **users** - User accounts
- **otps** - OTP verification codes
- **transcripts** - Medical transcripts
- **patient_tasks** - Patient task management

## Development Notes

- In development mode, if email is not configured, OTPs are logged to console
- JWT tokens expire in 7 days (configurable)
- OTP expires in 10 minutes (configurable)
- Uses connection pooling for better performance

## Environment Variables

See `.env.example` for all available configuration options.
