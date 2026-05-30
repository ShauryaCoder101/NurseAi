# NurseAI Backend API

Node.js/Express backend for the NurseAI mobile application.

## Tech Stack

- Node.js & Express
- PostgreSQL via Supabase (cloud-hosted, no local DB required)
- Supabase Storage (audio files)
- Google Gemini AI (transcription and clinical decision support)
- Nodemailer / Gmail SMTP (OTP emails)
- JWT (authentication)

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `backend/.env`** with the following variables:
   ```env
   NODE_ENV=development
   PORT=3000

   # Supabase PostgreSQL
   DATABASE_URL=postgresql://postgres.<project>:<password>@<host>:5432/postgres

   # Supabase Storage
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
   SUPABASE_STORAGE_BUCKET=audio

   # JWT
   JWT_SECRET=<long-random-string>
   JWT_EXPIRES_IN=7d

   # OTP
   OTP_EXPIRY_MINUTES=10

   # Email (Gmail SMTP with App Password)
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USER=you@gmail.com
   EMAIL_PASS=<app-password>
   EMAIL_FROM=NurseAI <noreply@nurseai.com>

   # Gemini AI
   GEMINI_API_KEY=<your-key>
   GEMINI_MODEL=gemini-3.5-flash
   GEMINI_API_BASE_URL=https://generativelanguage.googleapis.com/v1beta
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

   Database tables are created automatically on first run.

## API Endpoints

### Authentication
- `POST /api/auth/register` — Register new user (sends OTP)
- `POST /api/auth/verify-otp` — Verify OTP and complete registration
- `POST /api/auth/resend-otp` — Resend OTP
- `POST /api/auth/login` — Login
- `POST /api/auth/request-password-reset` — Request password reset OTP
- `POST /api/auth/reset-password` — Reset password with OTP

### Dashboard
- `GET /api/dashboard/summary` — Pending/done task counts
- `GET /api/dashboard/patient-tasks` — Patient tasks sorted by emergency level

### Audio & AI
- `POST /api/audio/upload` — Upload audio, trigger Gemini diagnosis (non-blocking Supabase upload)
- `POST /api/audio/finalize-prescription` — Submit follow-up audio, generate prescription
- `POST /api/audio/extract-proforma` — Extract structured proforma from audio
- `GET /api/audio/records` — List audio records

### Transcripts
- `GET /api/transcripts` — List all transcripts
- `GET /api/transcripts/:id` — Get single transcript
- `POST /api/transcripts` — Save transcript

## AI Configuration

All Gemini calls use `temperature: 0` for deterministic outputs. Every response logs:
```
[Gemini:generateDiagnosisFromAudio] finishReason=STOP parts=3 promptTokens=1204 outputTokens=412
```
If a response is empty or blocked, the full raw candidate is dumped to console.

Model and generation settings are controlled via `.env`:
- `GEMINI_MODEL` — primary model
- `GEMINI_FALLBACK_MODEL` — fallback if primary returns 404
- `GEMINI_LOG_ENABLED` — file logging (auto-enabled outside production)
- `GEMINI_LOG_INCLUDE_RAW` — include full raw response in log file

## Performance Notes

- **Supabase upload is non-blocking**: audio upload runs in the background while the Gemini diagnosis call starts immediately, reducing user-perceived latency.
- **No patient history fetched** for diagnosis or prescription (one-off episode model). `fetchPatientHistory` is still exported for future multi-visit support.

## Development Notes

- JWT tokens expire in 7 days (configurable via `JWT_EXPIRES_IN`)
- OTP expires in 10 minutes (configurable via `OTP_EXPIRY_MINUTES`)
- Uses PostgreSQL connection pooling
- Gemini logs written to `backend/logs/gemini.log`
