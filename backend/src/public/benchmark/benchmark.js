const passwordKey = 'nurseai_benchmark_password';
const emailKey = 'nurseai_benchmark_email';
let memoryPassword = '';

const passwordInput = document.getElementById('passwordInput');
const emailInput = document.getElementById('emailInput');
const loginButton = document.getElementById('loginButton');
const clearTokenBtn = document.getElementById('clearToken');
const searchInput = document.getElementById('searchInput');
const searchButton = document.getElementById('searchButton');
const refreshSuggestions = document.getElementById('refreshSuggestions');
const runBenchmark = document.getElementById('runBenchmark');
const preview = document.getElementById('suggestionPreview');
const results = document.getElementById('results');
const suggestionList = document.getElementById('suggestionList');
const promptInput = document.getElementById('promptInput');
const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const scoreboard = document.getElementById('scoreboard');
const tokenStatus = document.getElementById('tokenStatus');
const editPromptButton = document.getElementById('editPrompt');
const savePromptButton = document.getElementById('savePrompt');
const audioPlayer = document.getElementById('audioPlayer');
const audioMeta = document.getElementById('audioMeta');

let suggestions = [];

const getPassword = () => {
  if (memoryPassword) return memoryPassword;
  try {
    return localStorage.getItem(passwordKey) || '';
  } catch (err) {
    return memoryPassword || '';
  }
};

const setPassword = (password) => {
  memoryPassword = password;
  try {
    localStorage.setItem(passwordKey, password);
  } catch (err) {
    // storage may be blocked
  }
};

passwordInput.value = getPassword();
emailInput.value = localStorage.getItem(emailKey) || '';

const updateTokenStatus = () => {
  const password = getPassword();
  tokenStatus.textContent = password
    ? `Password stored (length ${password.length}).`
    : 'Password not stored yet.';
};

const promptKey = 'nurseai_benchmark_prompt';
const getPromptOverride = () => {
  try {
    return localStorage.getItem(promptKey) || '';
  } catch (err) {
    return '';
  }
};
const setPromptOverride = (value) => {
  try {
    localStorage.setItem(promptKey, value);
  } catch (err) {
    // ignore storage errors
  }
};

let basePrompt = '';
promptInput.value = getPromptOverride();

const setPromptEditing = (isEditing) => {
  promptInput.readOnly = !isEditing;
  if (isEditing) {
    promptInput.focus();
  }
  editPromptButton.disabled = isEditing;
  savePromptButton.disabled = !isEditing;
};

setPromptEditing(false);

editPromptButton.addEventListener('click', () => {
  setPromptEditing(true);
});

savePromptButton.addEventListener('click', () => {
  setPromptOverride(promptInput.value || '');
  setPromptEditing(false);
});

const loadBenchmarkPrompt = async () => {
  const password = getPassword();
  if (!password) return;
  const response = await fetch('/api/benchmark/prompt', {
    headers: { 'x-benchmark-password': password },
  });
  const data = await response.json();
  if (!data.success) {
    return;
  }
  basePrompt = data.data?.prompt || '';
  const override = getPromptOverride();
  if (!override) {
    promptInput.value = basePrompt;
  }
};

clearTokenBtn.addEventListener('click', () => {
  localStorage.removeItem(passwordKey);
  localStorage.removeItem(emailKey);
  memoryPassword = '';
  passwordInput.value = '';
  emailInput.value = '';
  updateTokenStatus();
});

const renderScores = (scores) => {
  scoreboard.innerHTML = '';
  scores.forEach((score) => {
    const card = document.createElement('div');
    card.className = 'score-card';
    card.innerHTML = `
      <strong>${score.label}</strong>
      <span>Score: ${score.wins}</span>
    `;
    scoreboard.appendChild(card);
  });
};

const fetchScores = async () => {
  const password = getPassword();
  if (!password) return;
  const response = await fetch('/api/benchmark/scores', {
    headers: { 'x-benchmark-password': password },
  });
  const data = await response.json();
  if (data.success) {
    renderScores(data.data || []);
  }
};

const formatDate = (value) => {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const renderSuggestions = () => {
  const filter = searchInput.value.trim().toLowerCase();
  const filtered = suggestions.filter((item) => {
    const text = `${item.patientName || ''} ${item.patientId || ''} ${item.fileName || ''}`
      .toLowerCase();
    return text.includes(filter);
  });

  suggestionList.innerHTML = '';
  filtered.forEach((item) => {
    const div = document.createElement('div');
    div.className = 'suggestion-item';
    if (item.flagged) {
      div.classList.add('flagged');
    }
    div.dataset.id = item.id;
    div.innerHTML = `
      <strong>${item.patientName || 'Unknown Patient'}</strong><br />
      <small>ID: ${item.patientId || 'N/A'}</small><br />
      <small>${item.fileName || 'Unnamed audio'}</small>
    `;
    div.addEventListener('click', () => {
      document.querySelectorAll('.suggestion-item').forEach((el) => {
        el.classList.remove('active');
      });
      div.classList.add('active');
      preview.value =
        `Patient: ${item.patientName || 'Unknown'}\n` +
        `Patient ID: ${item.patientId || 'N/A'}\n` +
        `File: ${item.fileName || 'Unnamed audio'}\n` +
        `Recorded: ${formatDate(item.createdAt)}\n` +
        `Mime: ${item.mimeType || 'Unknown'}`;
      preview.dataset.id = item.id;
      const password = getPassword();
      if (password) {
        const audioUrl = `/api/benchmark/audio/${item.id}?password=${encodeURIComponent(password)}`;
        audioPlayer.src = audioUrl;
        audioMeta.textContent = `${item.fileName || 'Unnamed audio'} • ${item.patientName || 'Unknown patient'}`;
      }
    });
    suggestionList.appendChild(div);
  });

  const first = filtered[0];
  if (first) {
    preview.value =
      `Patient: ${first.patientName || 'Unknown'}\n` +
      `Patient ID: ${first.patientId || 'N/A'}\n` +
      `File: ${first.fileName || 'Unnamed audio'}\n` +
      `Recorded: ${formatDate(first.createdAt)}\n` +
      `Mime: ${first.mimeType || 'Unknown'}`;
    preview.dataset.id = first.id;
    const firstEl = suggestionList.querySelector('.suggestion-item');
    if (firstEl) firstEl.classList.add('active');
    const password = getPassword();
    if (password) {
      const audioUrl = `/api/benchmark/audio/${first.id}?password=${encodeURIComponent(password)}`;
      audioPlayer.src = audioUrl;
      audioMeta.textContent = `${first.fileName || 'Unnamed audio'} • ${first.patientName || 'Unknown patient'}`;
    }
  }
};

const fetchSuggestions = async () => {
  results.innerHTML = '';
  preview.value = '';
  suggestionList.innerHTML = '';
  const password = getPassword();
  if (!password) {
    alert('Please enter the benchmark password.');
    return;
  }
  const response = await fetch('/api/benchmark/suggestions', {
    headers: { 'x-benchmark-password': password },
  });
  const data = await response.json();
  if (!data.success) {
    alert(data.error || 'Failed to load suggestions.');
    return;
  }
  suggestions = data.data || [];
  renderSuggestions();
};

searchInput.addEventListener('input', renderSuggestions);
searchButton.addEventListener('click', renderSuggestions);
refreshSuggestions.addEventListener('click', fetchSuggestions);

runBenchmark.addEventListener('click', async () => {
  const password = getPassword();
  if (!password) {
    alert('Please enter the benchmark password.');
    return;
  }
  const audioRecordId = preview.dataset.id;
  if (!audioRecordId) {
    alert('Select an audio recording first.');
    return;
  }
  results.innerHTML = '<div class="muted">Running benchmark...</div>';
  const response = await fetch('/api/benchmark/run', {
    method: 'POST',
    headers: {
      'x-benchmark-password': password,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audioRecordId,
      promptText: promptInput.value || getPromptOverride(),
    }),
  });
  const data = await response.json();
  if (!data.success) {
    results.innerHTML = `<div class="error">${data.error || 'Benchmark failed.'}</div>`;
    return;
  }
  const payload = data.data || {};
  const output = payload.results || [];
  const runId = payload.runId;
  results.innerHTML = '';
  output.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.innerHTML = `
      <div class="result-header">
        <strong>${item.label}</strong>
        <span class="badge">Anonymous</span>
      </div>
      <div style="margin-top:8px;">
        ${item.error ? `<span class="error">${item.error}</span>` : `<pre style="white-space:pre-wrap;margin:0;">${item.output || ''}</pre>`}
      </div>
      <div class="actions">
        <button data-option="${item.optionId}">Select best</button>
      </div>
    `;
    const button = card.querySelector('button');
    button.addEventListener('click', async () => {
      button.disabled = true;
      const resp = await fetch('/api/benchmark/score', {
        method: 'POST',
        headers: {
          'x-benchmark-password': password,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({runId, optionId: item.optionId}),
      });
      const scoreData = await resp.json();
      if (!scoreData.success) {
        alert(scoreData.error || 'Failed to submit score.');
        button.disabled = false;
        return;
      }
      renderScores(scoreData.data || []);
      results.querySelectorAll('button').forEach((btn) => {
        btn.disabled = true;
      });
      alert('Thanks for your selection.');
    });
    results.appendChild(card);
  });
});

loginButton.addEventListener('click', async () => {
  console.debug('[benchmark] login click');
  console.debug('[benchmark] email input value:', emailInput?.value);
  console.debug('[benchmark] password length:', passwordInput?.value?.length || 0);
  const email = (emailInput?.value || '').trim().toLowerCase();
  const password = (passwordInput?.value || '').trim();
  if (!email.endsWith('@nurseai.in')) {
    alert('Please use your @nurseai.in email.');
    return;
  }
  if (!password) {
    alert('Company password is required.');
    return;
  }
  console.debug('[benchmark] login validation passed');
  setPassword(password);
  localStorage.setItem(emailKey, email);
  updateTokenStatus();
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  console.debug('[benchmark] switching views');
  await loadBenchmarkPrompt();
  await fetchSuggestions();
  await fetchScores();
});

updateTokenStatus();
