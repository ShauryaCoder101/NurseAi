# Test Credentials for Mock Mode

This file contains the test credentials you can use to test the frontend without the backend.

## Mock Mode is Enabled

The app is currently configured to work in **Mock Mode**, which means it will work without a backend connection.

## Test Credentials

### Login
- **Email:** `test@nurseai.com`
- **Password:** `test123`

### Registration & OTP Verification
- **OTP:** `123456`
- You can use any email and phone number for registration
- When verifying OTP, use: `123456`

## How to Use

1. **Login:**
   - Open the app
   - Enter email: `test@nurseai.com`
   - Enter password: `test123`
   - Click Login

2. **Register (New User):**
   - Click "Sign Up"
   - Enter any email (e.g., `user@test.com`)
   - Enter any phone number (e.g., `1234567890`)
   - Enter any password (min 6 characters)
   - Click Register
   - On OTP screen, enter: `123456`
   - Click Verify

## Disabling Mock Mode

To disable mock mode and use the real backend:

1. Open `src/services/authService.js`
2. Change `const MOCK_MODE = true;` to `const MOCK_MODE = false;`

3. Open `src/services/apiService.js`
4. Change `const MOCK_MODE = true;` to `const MOCK_MODE = false;`

## Mock Data

The app includes sample data for:
- Dashboard summary (5 pending, 12 done tasks)
- Patient tasks (5 sample tasks)
- Transcripts (3 sample transcripts)

All data is stored locally and will persist during your session.
