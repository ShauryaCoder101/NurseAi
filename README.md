# NurseAI

NurseAI is a comprehensive healthcare platform designed to streamline nursing workflows through AI-powered transcription and medical note management. The project consists of a React Native mobile application and a Node.js/Express backend server.

## 🚀 Overview

NurseAI allows healthcare professionals to:
- Record patient consultations and automatically generate transcripts.
- Manage patient records and tasks efficiently.
- Access a centralized dashboard for real-time patient summaries.
- Securely store and retrieve medical history.

---

## 📱 Mobile Application

The mobile app is built using **React Native** and **Expo**, providing a cross-platform experience for iOS and Android.

### Features
- **Authentication**: Secure login, registration, and OTP verification.
- **Dashboard**: Quick view of pending/done tasks and patient summaries.
- **Audio Recording**: Capture patient interactions with high-fidelity audio.
- **Transcript Management**: View, search, and manage generated medical transcripts.
- **Patient Task List**: Track nursing tasks with emergency levels (High/Medium/Low).
- **History**: Access past records and transcripts.

### Tech Stack
- React Native / Expo
- React Navigation (Stack & Tab)
- Context API for state management
- Expo AV (Audio)
- Axios for API communication

---

## ⚙️ Backend API

The backend is a robust **Node.js** and **Express** server that handles data persistence, AI processing, and authentication.

### Features
- **AI Integration**: Uses Google Gemini AI for transcript generation and analysis.
- **Secure Auth**: JWT-based authentication with email OTP verification.
- **Storage**: Supabase Storage for audio files and patient records.
- **Database**: PostgreSQL for structured data management.
- **Portals**:
  - **Doctor Portal**: Dedicated interface for medical professionals.
  - **Benchmark Portal**: Performance tracking and system metrics.

### Tech Stack
- Node.js & Express
- PostgreSQL (pg)
- Supabase (Storage)
- Google Generative AI (Gemini)
- Nodemailer (Email OTP)
- JWT (Authentication)

### AI Prompts and Workflow
The backend leverages **6 specialized Gemini prompts** to guide the AI's responses and maintain clinical accuracy:
- `REASONING_PROMPT_SUFFIX`: A universal suffix ensuring all AI responses include a structured JSON reasoning audit for transparency.
- `GEMINI_PROMPT`: The primary prompt for general clinical decision support, focusing on the context of rural West Bengal, India, and emphasizing a structured response for case synthesis, differential diagnosis, and management.
- `DIAGNOSIS_PROMPT`: Guides the AI as a "2Diagnosis" assistant to review clinical transcripts, identify likely differentials, screen for red flags, and suggest high-yield follow-up steps.
- `PRESCRIPTION_PROMPT`: Positions the AI as "3Prescription," synthesizing diagnostic information into a pragmatic, tiered management plan, with a strong emphasis on patient safety and resource stewardship.
- `PROFORMA_GEM_PROMPT`: Acts as "Proforma Gem", optimizing the initial 5-6 minutes of a patient interview to efficiently reach a diagnosis while addressing "do-not-miss" conditions, with a focus on local context and Standard Treatment Guidelines (STGs).
- `EXTRACTION_PROMPT`: Designed for strict extraction of specific clinical and demographic data from patient-nurse transcripts without narrative summaries.

All Gemini calls use **temperature = 0** for fully deterministic, reproducible outputs — critical for clinical safety.

**End-to-End App Stages (9 Stages)**
The NurseAI application workflow is structured into 9 distinct stages, combining user interactions with AI processing and external integrations:

**Initial User Interaction Stages:**
1. **User Authentication**: Secure registration, login, and OTP verification.
2. **Dashboard & Task Management**: Overview of patient tasks, summaries, and daily workflow.
3. **Patient Consultation Recording**: Capturing audio of patient interactions within the mobile app.

**Core AI Integration Stages (after recording):**
4. **AI Diagnosis Generation**: The recorded audio is processed by Gemini, generating an initial diagnosis. This is the **primary Gemini API call** in a single end-to-end session. The Supabase audio upload runs concurrently (non-blocking) to reduce latency.
5. **Transcript & Patient Record Management**: Nurses review, edit, and save AI-generated transcripts and manage patient records.
6. **AI-Powered Prescription**: Generating tailored medication plans based on diagnosis and clinical data.
7. **AI-Powered Proforma Extraction**: Extracting structured clinical and demographic data into standardized forms.
8. **AI-Powered Follow-up Questions/Suggestions**: Generating concise answers for follow-up questions.

**External Interfaces:**
9. **Doctor Verification & System Benchmarking**: Separate portals for doctors to verify AI outputs and for monitoring system performance and metrics.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL (v12 or higher)
- Expo Go app on your mobile device (for testing)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-repo/nurseai.git
   cd nurseai
   ```

2. **Backend Setup:**
   ```bash
   cd backend
   npm install
   # Create a .env file based on .env.example
   # Required: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, JWT_SECRET
   # Optional: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
   npm start
   ```

3. **Mobile App Setup:**
   ```bash
   cd ..
   npm install
   # Configure backend URL in .env or src/services/apiService.js
   npx expo start
   ```

---

## 🔐 Environment Variables

The backend requires several environment variables to function correctly. Create a `.env` file in the `backend/` directory:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Full Supabase PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT signing (use a long random string) |
| `JWT_EXPIRES_IN` | No | Token expiry (default: `7d`) |
| `GEMINI_API_KEY` | Yes | Google Gemini API Key |
| `GEMINI_MODEL` | No | Gemini model name (default: `gemini-3.5-flash`) |
| `SUPABASE_URL` | Yes | Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key |
| `SUPABASE_STORAGE_BUCKET` | No | Storage bucket name (default: `audio`) |
| `EMAIL_HOST` | Yes | SMTP host (e.g. `smtp.gmail.com`) |
| `EMAIL_PORT` | No | SMTP port (default: `587`) |
| `EMAIL_USER` | Yes | SMTP email address for OTP |
| `EMAIL_PASS` | Yes | SMTP app password |
| `OTP_EXPIRY_MINUTES` | No | OTP validity window (default: `10`) |

---

## 📂 Project Structure

```
NurseAi/
├── backend/            # Express.js Backend
│   ├── src/            # API Source Code
│   │   ├── controllers/# Business logic for each route
│   │   ├── middleware/ # Auth and validation middleware
│   │   ├── routes/     # Express route definitions
│   │   ├── services/   # External integrations (Gemini, Supabase)
│   │   ├── utils/      # Shared utilities (JWT, OTP)
│   │   └── server.js   # API entry point
│   └── public/         # Doctor portal and static assets
├── src/                # React Native Source Code
│   ├── components/     # Atomic UI components
│   ├── context/        # Auth and global state
│   ├── hooks/          # Custom React hooks
│   ├── navigation/     # React Navigation setup
│   ├── screens/        # Full-page components
│   ├── services/       # Backend API communication
│   └── styles/         # Global styles and theme
├── App.js              # Mobile app entry point
└── package.json        # Dependencies and scripts
```

## 📜 License
This project is licensed under the ISC License.
