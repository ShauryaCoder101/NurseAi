// Starts localtunnel on port 3000 and writes the URL to .env as EXPO_PUBLIC_API_URL
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const LT_BIN = 'C:\\Users\\mrpri\\AppData\\Roaming\\npm\\node_modules\\localtunnel\\bin\\lt.js';
const ENV_FILE = path.join(__dirname, '.env');

const lt = spawn('node', [LT_BIN, '--port', '3000'], { stdio: ['ignore', 'pipe', 'pipe'] });

lt.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);

  const match = text.match(/https?:\/\/[^\s]+\.loca\.lt/);
  if (match) {
    const tunnelUrl = match[0];
    const apiUrl = `${tunnelUrl}/api`;

    // Read existing .env and replace or append EXPO_PUBLIC_API_URL
    let envContent = '';
    if (fs.existsSync(ENV_FILE)) {
      envContent = fs.readFileSync(ENV_FILE, 'utf8');
    }

    if (envContent.includes('EXPO_PUBLIC_API_URL=')) {
      envContent = envContent.replace(/EXPO_PUBLIC_API_URL=.*/g, `EXPO_PUBLIC_API_URL=${apiUrl}`);
    } else {
      envContent += `\nEXPO_PUBLIC_API_URL=${apiUrl}\n`;
    }

    fs.writeFileSync(ENV_FILE, envContent);
    console.log(`\n✅ Tunnel URL: ${tunnelUrl}`);
    console.log(`✅ .env updated: EXPO_PUBLIC_API_URL=${apiUrl}`);
    console.log(`\n📱 Restart Expo after this to pick up the new URL.`);
  }
});

lt.stderr.on('data', (data) => process.stderr.write(data));

lt.on('close', (code) => {
  console.log(`\nlocaltunnel exited (code ${code})`);
});
