# Dev Setup — Starting the Local Dev Environment

Run these steps **in order** every time you restart your computer.

---

## Step 1 — Start the Backend (Terminal 1)

```powershell
cd C:\Users\mrpri\Projects\NurseAi\backend
node src/server.js
```

Wait for: `NurseAI Backend Server running on port 3000`

Leave this terminal open.

---

## Step 2 — Start the Tunnel (Terminal 2)

```powershell
cd C:\Users\mrpri\Projects\NurseAi
node start-tunnel.js
```

Wait for: `✅ .env updated: EXPO_PUBLIC_API_URL=https://...`

Leave this terminal open.

---

## Step 3 — Start Expo (Terminal 3)

```powershell
cd C:\Users\mrpri\Projects\NurseAi
npx expo start --tunnel
```

Wait for the QR code to appear in the terminal.

Leave this terminal open.

---

## Step 4 — Share with Collaborator

Send them either:
- A **screenshot of the QR code** to scan in Expo Go, or
- The **Expo URL** printed in the terminal (e.g. `exp://jailhouse-angler-trailing.ngrok-free.dev`) — they type it into Expo Go manually

They will need to **register a new account** through the app on first use.

---

## Notes

- **Order matters:** Step 2 (tunnel) must run before Step 3 (Expo), because Expo bakes the backend URL from `.env` into the app bundle at startup.
- The tunnel URL changes on every restart. The script handles updating `.env` automatically — you don't need to do anything manually.
- If the tunnel drops mid-session, re-run Step 2 then restart Expo (Step 3).
- The backend runs on `localhost:3000`. The tunnel makes it reachable from any network.
- All of this is dev only — production uses `https://api.nurseai.in/api` and is unaffected.
