// State
let token = localStorage.getItem('doctorToken');
let doctorInfo = JSON.parse(localStorage.getItem('doctorInfo') || 'null');
let currentTab = 'unverified';
let visits = { unverified: [], verified: [], flagged: [] };
let selectedVisit = null;
let selectedVerdict = null;
let benchmarkResults = [];
let selectedBmAudio = null;
let pollInterval = null;

// DOM Elements
const loginOverlay = document.getElementById('loginOverlay');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const doctorNameDisplay = document.getElementById('doctorNameDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const navTabs = document.querySelectorAll('.nav-tab');
const visitList = document.getElementById('visitList');
const searchBox = document.getElementById('searchBox');
const detailFrame = document.getElementById('detailFrame');
const detailEmpty = document.getElementById('detailEmpty');
const verificationDrawer = document.getElementById('verificationDrawer');
const visitIdDisplay = document.getElementById('visitIdDisplay');
const verdictValidBtn = document.getElementById('verdictValid');
const verdictInvalidBtn = document.getElementById('verdictInvalid');
const remarksInput = document.getElementById('remarksInput');
const verifyBtn = document.getElementById('verifyBtn');

// Benchmark DOM
const verificationView = document.getElementById('verificationView');
const benchmarkView = document.getElementById('benchmarkView');
const runBenchmarksBtn = document.getElementById('runBenchmarksBtn');
const benchmarkProgress = document.getElementById('benchmarkProgress');
const progressBarFill = document.getElementById('progressBarFill');
const runStatusText = document.getElementById('runStatusText');
const bmSearchBox = document.getElementById('bmSearchBox');
const bmList = document.getElementById('bmList');
const bmDetail = document.getElementById('bmDetail');
const bmDetailEmpty = document.getElementById('bmDetailEmpty');

const API_BASE = '/api';

// ── Initialize ─────────────────────────────────────────────────────────────────
function init() {
  if (token && doctorInfo) {
    showApp();
    fetchVisits();
  } else {
    showLogin();
  }
  setupEventListeners();
}

function showLogin() {
  loginOverlay.classList.remove('hidden');
  appContent.classList.add('hidden');
}

function showApp() {
  loginOverlay.classList.add('hidden');
  appContent.classList.remove('hidden');
  doctorNameDisplay.textContent = doctorInfo.name;
}

// ── Event Listeners ────────────────────────────────────────────────────────────
function setupEventListeners() {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    try {
      const res = await fetch(`${API_BASE}/doctor/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (data.success) {
        token = data.data.token;
        doctorInfo = data.data.doctor;
        localStorage.setItem('doctorToken', token);
        localStorage.setItem('doctorInfo', JSON.stringify(doctorInfo));
        loginError.style.display = 'none';
        showApp();
        fetchVisits();
      } else {
        loginError.textContent = data.error || 'Login failed';
        loginError.style.display = 'block';
      }
    } catch (err) {
      loginError.textContent = 'Server error. Please try again.';
      loginError.style.display = 'block';
    }
  });

  logoutBtn.addEventListener('click', () => {
    token = null;
    doctorInfo = null;
    localStorage.removeItem('doctorToken');
    localStorage.removeItem('doctorInfo');
    showLogin();
  });

  // Tabs
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentTab = tab.dataset.tab;

      if (currentTab === 'benchmarks') {
        verificationView.style.display = 'none';
        benchmarkView.classList.remove('hidden');
        benchmarkView.style.display = 'flex';
        fetchBenchmarkResults();
      } else {
        benchmarkView.style.display = 'none';
        benchmarkView.classList.add('hidden');
        verificationView.style.display = 'flex';
        renderVisitList();
        hideDetail();
      }
    });
  });

  searchBox.addEventListener('input', () => {
    renderVisitList(searchBox.value);
  });

  // Verdict buttons
  verdictValidBtn.addEventListener('click', () => selectVerdict('valid'));
  verdictInvalidBtn.addEventListener('click', () => selectVerdict('invalid'));

  function selectVerdict(v) {
    selectedVerdict = v;
    if (v === 'valid') {
      verdictValidBtn.style.borderColor = 'var(--green)';
      verdictValidBtn.style.background = 'rgba(34,197,94,0.15)';
      verdictValidBtn.style.color = 'var(--green)';
      verdictInvalidBtn.style.borderColor = 'var(--border)';
      verdictInvalidBtn.style.background = 'transparent';
      verdictInvalidBtn.style.color = 'var(--text-secondary)';
      verifyBtn.disabled = false;
      verifyBtn.textContent = '✓ Mark as Valid';
      verifyBtn.style.backgroundColor = 'var(--green)';
      verifyBtn.style.color = '#000';
    } else {
      verdictInvalidBtn.style.borderColor = 'var(--red)';
      verdictInvalidBtn.style.background = 'rgba(239,68,68,0.15)';
      verdictInvalidBtn.style.color = 'var(--red)';
      verdictValidBtn.style.borderColor = 'var(--border)';
      verdictValidBtn.style.background = 'transparent';
      verdictValidBtn.style.color = 'var(--text-secondary)';
      verifyBtn.disabled = false;
      verifyBtn.textContent = '✗ Flag as Invalid';
      verifyBtn.style.backgroundColor = 'var(--red)';
      verifyBtn.style.color = '#fff';
    }
  }

  // Verify Action
  verifyBtn.addEventListener('click', async () => {
    if (!selectedVisit || !selectedVerdict) return;
    
    verifyBtn.disabled = true;
    const originalText = verifyBtn.textContent;
    verifyBtn.textContent = 'Processing...';

    try {
      const res = await fetch(`${API_BASE}/doctor/verify/${selectedVisit.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          verdict: selectedVerdict,
          remarks: remarksInput.value
        })
      });
      const data = await res.json();
      
      if (data.success) {
        hideDetail();
        await fetchVisits();
      } else {
        alert(data.error || 'Failed to verify visit');
      }
    } catch (err) {
      console.error(err);
      alert('Error connecting to server.');
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = originalText;
    }
  });

  // Benchmark events
  runBenchmarksBtn.addEventListener('click', startBenchmarkRun);
  bmSearchBox.addEventListener('input', () => renderBmList(bmSearchBox.value));
}

// ── Verification Tab ───────────────────────────────────────────────────────────
async function fetchVisits() {
  try {
    const res = await fetch(`${API_BASE}/doctor/visits`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (res.status === 401 || res.status === 403) {
      logoutBtn.click();
      return;
    }
    
    const data = await res.json();
    if (data.success) {
      visits = data.data;
      renderVisitList(searchBox.value);
    }
  } catch (err) {
    console.error('Failed to fetch visits', err);
    visitList.innerHTML = `<div class="empty-state">Error loading patient queue. <button onclick="fetchVisits()" style="background:none; border:none; color:var(--accent); cursor:pointer; text-decoration:underline;">Retry</button></div>`;
  }
}

function renderVisitList(searchQuery = '') {
  const list = visits[currentTab] || [];
  visitList.innerHTML = '';
  
  if (list.length === 0) {
    visitList.innerHTML = `<div class="empty-state">No ${currentTab} visits found in the queue.</div>`;
    return;
  }
  
  const query = searchQuery.toLowerCase();
  const filtered = list.filter(v => 
    (v.patient_name && v.patient_name.toLowerCase().includes(query)) ||
    (v.patient_id && v.patient_id.toLowerCase().includes(query))
  );
  
  if (filtered.length === 0) {
    visitList.innerHTML = `<div class="empty-state">No matching visits found.</div>`;
    return;
  }
  
  filtered.forEach(visit => {
    const el = document.createElement('div');
    el.className = `visit-item ${selectedVisit?.id === visit.id ? 'active' : ''}`;
    
    const dateStr = new Date(visit.created_at).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    
    let badgeHtml = '';
    if (currentTab === 'verified') badgeHtml = `<span class="visit-status-badge status-verified">✓ Valid</span>`;
    if (currentTab === 'flagged') badgeHtml = `<span class="visit-status-badge status-flagged">✗ Invalid</span>`;

    el.innerHTML = `
      <div class="visit-item-header">
        <span class="visit-patient">${visit.patient_name || 'Unknown Patient'}</span>
        <span class="visit-date">${dateStr}</span>
      </div>
      <div class="visit-id">${visit.patient_id || 'ID Unknown'}</div>
      ${visit.nurse_email ? `<div class="visit-nurse-email">👩‍⚕️ ${visit.nurse_email}</div>` : ''}
      ${badgeHtml}
    `;
    
    el.addEventListener('click', () => {
      document.querySelectorAll('.visit-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      selectVisit(visit);
    });
    
    visitList.appendChild(el);
  });
}

function selectVisit(visit) {
  selectedVisit = visit;
  detailEmpty.classList.add('hidden');
  detailFrame.classList.remove('hidden');
  
  if (visit.patient_id && visit.id) {
    detailFrame.src = `${API_BASE}/doctor/patient-record/${visit.patient_id}/visit/${visit.id}/html?token=${token}&t=${Date.now()}`;
  }
  
  if (currentTab === 'unverified') {
    verificationDrawer.classList.add('open');
    visitIdDisplay.textContent = `Transcript ID: ${visit.id.substring(0,8)}...`;
    detailFrame.style.marginBottom = '220px';
    // Reset verdict state
    selectedVerdict = null;
    verdictValidBtn.style.borderColor = 'var(--border)';
    verdictValidBtn.style.background = 'transparent';
    verdictValidBtn.style.color = 'var(--text-secondary)';
    verdictInvalidBtn.style.borderColor = 'var(--border)';
    verdictInvalidBtn.style.background = 'transparent';
    verdictInvalidBtn.style.color = 'var(--text-secondary)';
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Select Valid or Invalid';
    verifyBtn.style.backgroundColor = '';
    verifyBtn.style.color = '';
    remarksInput.value = '';
  } else {
    verificationDrawer.classList.remove('open');
    detailFrame.style.marginBottom = '0';
  }
}

function hideDetail() {
  selectedVisit = null;
  detailEmpty.classList.remove('hidden');
  detailFrame.classList.add('hidden');
  detailFrame.src = '';
  verificationDrawer.classList.remove('open');
  detailFrame.style.marginBottom = '0';
}

// ── Benchmark Tab ──────────────────────────────────────────────────────────────

async function startBenchmarkRun() {
  runBenchmarksBtn.disabled = true;
  runBenchmarksBtn.textContent = '⏳ Starting...';
  benchmarkProgress.classList.remove('hidden');
  progressBarFill.style.width = '0%';
  runStatusText.textContent = 'Initiating benchmark run...';

  try {
    const res = await fetch(`${API_BASE}/benchmark/advanced/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-benchmark-key': token,
      },
    });
    const data = await res.json();

    if (!data.success) {
      runStatusText.textContent = `Error: ${data.error}`;
      runBenchmarksBtn.disabled = false;
      runBenchmarksBtn.textContent = '▶ Run Benchmarks (50 audio)';
      return;
    }

    const runId = data.data.runId;
    runStatusText.textContent = `Run started (${data.data.totalAudios} audios). Polling...`;

    // Start polling
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => pollRunStatus(runId), 3000);
  } catch (err) {
    runStatusText.textContent = `Error: ${err.message}`;
    runBenchmarksBtn.disabled = false;
    runBenchmarksBtn.textContent = '▶ Run Benchmarks (50 audio)';
  }
}

async function pollRunStatus(runId) {
  try {
    const res = await fetch(`${API_BASE}/benchmark/advanced/status?runId=${runId}`, {
      headers: { 'x-benchmark-key': token },
    });
    const data = await res.json();

    if (!data.success || !data.data) return;

    const run = data.data;
    const pct = run.progress || 0;
    progressBarFill.style.width = `${pct}%`;

    if (run.currentBenchmark) {
      runStatusText.textContent = `[${pct}%] ${run.currentBenchmark} — ${run.currentAudioName || '...'} (${run.completedAudios}/${run.totalAudios})`;
    } else {
      runStatusText.textContent = `[${pct}%] Processing... (${run.completedAudios}/${run.totalAudios})`;
    }

    // Fetch partial results on every poll so they appear progressively
    fetchBenchmarkResults();

    if (run.status === 'completed' || run.status === 'error') {
      clearInterval(pollInterval);
      pollInterval = null;
      runBenchmarksBtn.disabled = false;
      runBenchmarksBtn.textContent = '▶ Run Benchmarks (50 audio)';

      if (run.status === 'completed') {
        runStatusText.textContent = `✅ Completed! ${run.completedAudios}/${run.totalAudios} audios processed.`;
        progressBarFill.style.width = '100%';
      } else {
        runStatusText.textContent = `❌ Error: ${run.errorMessage || 'Unknown error'}`;
      }
    }
  } catch (err) {
    console.error('Poll error:', err);
  }
}

async function fetchBenchmarkResults() {
  try {
    const res = await fetch(`${API_BASE}/benchmark/advanced/results`, {
      headers: { 'x-benchmark-key': token },
    });
    const data = await res.json();

    if (data.success) {
      benchmarkResults = data.data || [];
      renderBmList(bmSearchBox.value);
    }
  } catch (err) {
    console.error('Fetch benchmark results error:', err);
    bmList.innerHTML = `<div class="empty-state">Error loading results.</div>`;
  }
}

function renderBmList(searchQuery = '') {
  bmList.innerHTML = '';
  const query = (searchQuery || '').toLowerCase();

  const filtered = benchmarkResults.filter(r =>
    (r.patientName && r.patientName.toLowerCase().includes(query)) ||
    (r.patientId && r.patientId.toLowerCase().includes(query)) ||
    (r.fileName && r.fileName.toLowerCase().includes(query))
  );

  if (filtered.length === 0) {
    bmList.innerHTML = `<div class="empty-state">${benchmarkResults.length === 0 ? 'No benchmark results yet. Run benchmarks to start.' : 'No matching results.'}</div>`;
    return;
  }

  filtered.forEach(audio => {
    const el = document.createElement('div');
    el.className = `visit-item ${selectedBmAudio?.audioRecordId === audio.audioRecordId ? 'active' : ''}`;

    const dateStr = audio.audioCreatedAt ? new Date(audio.audioCreatedAt).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';

    const bm = audio.benchmarks || {};
    const badgeHtml = `
      <div class="benchmark-badges">
        ${bmBadge('F', bm.fairness)}
        ${bmBadge('A', bm.appropriateness)}
        ${bmBadge('E', bm.ensemble)}
        ${bmBadge('S', bm.safety)}
      </div>
    `;

    el.innerHTML = `
      <div class="visit-item-header">
        <span class="visit-patient">${audio.patientName || 'Unknown'}</span>
        <span class="visit-date">${dateStr}</span>
      </div>
      <div class="visit-id">${audio.patientId || audio.fileName || 'N/A'}</div>
      ${badgeHtml}
    `;

    el.addEventListener('click', () => {
      document.querySelectorAll('#bmList .visit-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      showBmDetail(audio);
    });

    bmList.appendChild(el);
  });
}

function bmBadge(label, bm) {
  if (!bm) return `<span class="bm-badge bm-badge-pending">${label} ⏳</span>`;
  if (bm.status === 'error') return `<span class="bm-badge bm-badge-error" title="${bm.error || 'Error'}">${label} ✗</span>`;
  if (bm.status === 'completed') {
    if (bm.score != null) {
      return `<span class="bm-badge bm-badge-completed">${label} ${Math.round(bm.score)} ✓</span>`;
    }
    // Completed but no score — LLM response couldn't be parsed
    return `<span class="bm-badge bm-badge-warn" style="background: rgba(255,165,0,0.15); color: #ffa500;">${label} ⚠️</span>`;
  }
  return `<span class="bm-badge bm-badge-pending">${label} ⏳</span>`;
}

async function showBmDetail(audio) {
  selectedBmAudio = audio;
  bmDetailEmpty.classList.add('hidden');
  bmDetail.classList.remove('hidden');

  // Fetch model names
  let modelsHtml = '';
  try {
    const mRes = await fetch(`${API_BASE}/benchmark/advanced/models`, {
      headers: { 'x-benchmark-key': token },
    });
    const mData = await mRes.json();
    if (mData.success) {
      const m = mData.models;
      modelsHtml = `
        <div style="background: linear-gradient(135deg, rgba(99,102,241,0.1), rgba(168,85,247,0.1)); border: 1px solid rgba(99,102,241,0.2); border-radius: 10px; padding: 14px 18px; margin-bottom: 20px;">
          <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: var(--accent); margin-bottom: 10px;">🧠 Models Used in Benchmark</div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 13px;">
            <div><span style="color: var(--text-muted);">🟢 Gemini:</span> <span style="color: var(--text-primary); font-weight: 600;">${m.gemini}</span></div>
            <div><span style="color: var(--text-muted);">🟠 ChatGPT:</span> <span style="color: var(--text-primary); font-weight: 600;">${m.chatgpt}</span></div>
            <div><span style="color: var(--text-muted);">🔵 Grok:</span> <span style="color: var(--text-primary); font-weight: 600;">${m.grok}</span></div>
            <div><span style="color: var(--text-muted);">🟣 DeepSeek:</span> <span style="color: var(--text-primary); font-weight: 600;">${m.deepseek}</span></div>
            <div><span style="color: var(--text-muted);">🟤 Claude:</span> <span style="color: var(--text-primary); font-weight: 600;">${m.claude}</span></div>
          </div>
        </div>`;
    }
  } catch (e) { /* ignore */ }

  const bm = audio.benchmarks || {};
  bmDetail.innerHTML = `
    <h2 style="font-size: 18px; margin-bottom: 4px;">${audio.patientName || 'Unknown Patient'}</h2>
    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">${audio.patientId || ''} · ${audio.fileName || ''}</p>
    ${modelsHtml}
    ${renderFairnessSection(bm.fairness)}
    ${renderAppropriatenessSection(bm.appropriateness)}
    ${renderEnsembleSection(bm.ensemble)}
    ${renderSafetySection(bm.safety)}
  `;

  // Toggle sections on click
  bmDetail.querySelectorAll('.bm-section-header').forEach(header => {
    header.addEventListener('click', () => {
      const body = header.nextElementSibling;
      body.classList.toggle('open');
    });
  });
}

// ── Benchmark Section Renderers ────────────────────────────────────────────────

function renderFairnessSection(data) {
  if (!data) return renderEmptySection('Fairness (Religion Bias)', '⚖️');
  if (data.status === 'error') return renderErrorSection('Fairness (Religion Bias)', '⚖️', data.error);

  const r = data.result || {};
  // New structure: result.claude_verdict has the parsed JSON from Claude judge
  const verdict = r.claude_verdict || r;
  const score = verdict.score ?? data.score;
  const scoreColor = getScoreColor(score);

  // Debug info: show raw response if no parsed verdict
  const debugInfo = (!verdict.score && verdict.raw_response)
    ? `<div style="margin-top: 12px; padding: 12px; background: rgba(255,0,0,0.1); border-radius: 8px; font-size: 12px; color: #ff6b6b; white-space: pre-wrap; max-height: 200px; overflow-y: auto;"><strong>⚠️ Debug — Raw LLM response (failed to parse JSON):</strong>\n${(verdict.raw_response || '').substring(0, 1000)}</div>`
    : '';

  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">⚖️ Fairness (Religion Bias)</div>
        <div class="bm-section-score" style="color: ${scoreColor}">${score != null ? score + '/100' : '⚠️ No Score'}</div>
      </div>
      <div class="bm-section-body open">
        <div class="bm-kv"><span class="bm-kv-label">Bias Detected:</span><span class="bm-kv-value" style="color: ${verdict.bias_detected ? 'var(--red)' : 'var(--green)'}">${verdict.bias_detected === true ? 'YES ⚠️' : verdict.bias_detected === false ? 'No ✓' : '—'}</span></div>
        ${verdict.medical_differences?.length ? `<div class="bm-kv"><span class="bm-kv-label">Medical Differences:</span><span class="bm-kv-value">${verdict.medical_differences.map(d => d.area + ': ' + d.significance).join(', ')}</span></div>` : ''}
        <div style="margin-top: 12px; padding: 12px; background: var(--bg-primary); border-radius: 8px; white-space: pre-wrap;">${verdict.analysis || r.analysis || '—'}</div>
        ${debugInfo}
      </div>
    </div>`;
}

function renderAppropriatenessSection(data) {
  if (!data) return renderEmptySection('Appropriateness (Rural Context)', '🏥');
  if (data.status === 'error') return renderErrorSection('Appropriateness (Rural Context)', '🏥', data.error);

  const r = data.result || {};
  const scoreColor = getScoreColor(r.overall_score);

  // Debug info when no score parsed
  const debugInfo = (r.overall_score == null && r.raw_response)
    ? `<div style="margin-top: 12px; padding: 12px; background: rgba(255,0,0,0.1); border-radius: 8px; font-size: 12px; color: #ff6b6b; white-space: pre-wrap; max-height: 200px; overflow-y: auto;"><strong>⚠️ Debug — Raw LLM response (failed to parse):</strong>\n${(r.raw_response || '').substring(0, 1000)}</div>`
    : '';

  let testsTable = '';
  if (r.tests?.length) {
    testsTable = `
      <table class="bm-table">
        <tr><th>Test</th><th>Available</th><th>Cost OK</th><th>Reasoning</th><th>Alternative</th></tr>
        ${r.tests.map(t => `<tr>
          <td>${t.name}</td>
          <td style="color: ${t.available_locally ? 'var(--green)' : 'var(--red)'}">${t.available_locally ? '✓' : '✗'}</td>
          <td style="color: ${t.cost_appropriate ? 'var(--green)' : 'var(--red)'}">${t.cost_appropriate ? '✓' : '✗'}</td>
          <td>${t.reasoning || ''}</td>
          <td style="color: var(--accent); font-weight: 600;">${t.alternative || '—'}</td>
        </tr>`).join('')}
      </table>`;
  }

  let medsTable = '';
  if (r.medications?.length) {
    medsTable = `
      <table class="bm-table">
        <tr><th>Medication</th><th>Available</th><th>Affordable</th><th>Reasoning</th><th>Alternative</th></tr>
        ${r.medications.map(m => `<tr>
          <td>${m.name}</td>
          <td style="color: ${m.available_locally ? 'var(--green)' : 'var(--red)'}">${m.available_locally ? '✓' : '✗'}</td>
          <td style="color: ${m.affordable ? 'var(--green)' : 'var(--red)'}">${m.affordable ? '✓' : '✗'}</td>
          <td>${m.reasoning || ''}</td>
          <td style="color: var(--accent); font-weight: 600;">${m.alternative || '—'}</td>
        </tr>`).join('')}
      </table>`;
  }

  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">🏥 Appropriateness (Rural Context)</div>
        <div class="bm-section-score" style="color: ${scoreColor}">${r.overall_score != null ? r.overall_score + '/100' : '⚠️ No Score'}</div>
      </div>
      <div class="bm-section-body">
        <div class="bm-kv"><span class="bm-kv-label">Occam's Razor:</span><span class="bm-kv-value" style="color: ${r.occams_razor_followed ? 'var(--green)' : 'var(--red)'}">${r.occams_razor_followed === undefined ? '—' : r.occams_razor_followed ? 'Followed ✓' : 'Not Followed ✗'}</span></div>
        ${r.occams_razor_reasoning ? `<div class="bm-kv"><span class="bm-kv-label">Reasoning:</span><span class="bm-kv-value">${r.occams_razor_reasoning}</span></div>` : ''}
        <div class="bm-kv"><span class="bm-kv-label">Advice Appropriate:</span><span class="bm-kv-value" style="color: ${r.advice_appropriate ? 'var(--green)' : 'var(--red)'}">${r.advice_appropriate === undefined ? '—' : r.advice_appropriate ? 'Yes ✓' : 'No ✗'}</span></div>
        ${r.advice_reasoning ? `<div class="bm-kv"><span class="bm-kv-label">Advice Reasoning:</span><span class="bm-kv-value">${r.advice_reasoning}</span></div>` : ''}
        ${r.alternative_advice ? `<div class="bm-kv"><span class="bm-kv-label" style="color: var(--accent);">Suggested Alternative Advice:</span><span class="bm-kv-value" style="color: var(--accent);">${r.alternative_advice}</span></div>` : ''}
        ${testsTable ? `<p style="margin-top: 16px; font-weight: 600; color: var(--text-primary);">Diagnostic Tests</p>${testsTable}` : ''}
        ${medsTable ? `<p style="margin-top: 16px; font-weight: 600; color: var(--text-primary);">Medications</p>${medsTable}` : ''}
        <div style="margin-top: 12px; padding: 12px; background: var(--bg-primary); border-radius: 8px; white-space: pre-wrap;">${r.analysis || '—'}</div>
        ${debugInfo}
      </div>
    </div>`;
}

function renderEnsembleSection(data) {
  if (!data) return renderEmptySection('Ensemble AI Grading', '🤖');
  if (data.status === 'error') return renderErrorSection('Ensemble AI Grading', '🤖', data.error);

  const r = data.result || {};
  const verdict = r.claude_verdict || {};
  const scores = r.scores || {};
  const bestModel = r.best_model || verdict.best_model || 'unknown';

  // Build scoreboard
  const models = [
    { key: 'gemini', label: 'Gemini', icon: '🟢' },
    { key: 'grok', label: 'Grok', icon: '🔵' },
    { key: 'deepseek', label: 'DeepSeek', icon: '🟣' },
    { key: 'chatgpt', label: 'ChatGPT', icon: '🟠' },
  ];

  const scoreboardRows = models.map(m => {
    const s = scores[m.key] ?? verdict[m.key]?.score ?? null;
    const isBest = m.key === bestModel;
    const color = getScoreColor(s);
    const strengths = verdict[m.key]?.strengths || [];
    const weaknesses = verdict[m.key]?.weaknesses || [];
    return `<tr style="${isBest ? 'background: var(--accent-glow);' : ''}">
      <td>${m.icon} ${m.label} ${isBest ? '👑' : ''}</td>
      <td style="color: ${color}; font-weight: 700; font-size: 16px;">${s != null ? s : '—'}</td>
      <td style="font-size: 12px;">${strengths.length ? strengths.join('; ') : '—'}</td>
      <td style="font-size: 12px;">${weaknesses.length ? weaknesses.join('; ') : '—'}</td>
    </tr>`;
  }).join('');

  const responseCards = models.map(m => {
    const responseKey = m.key + '_response';
    const text = r[responseKey];
    if (!text) return '';
    return `<div>
      <div class="ensemble-response-label">${m.icon} ${m.label} ${scores[m.key] != null ? '(' + scores[m.key] + '/100)' : ''}</div>
      <div class="ensemble-response-card">${escapeHtml(text)}</div>
    </div>`;
  }).filter(Boolean).join('');

  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">🤖 Ensemble AI Grading</div>
        <div class="bm-section-score" style="color: var(--accent)">${bestModel !== 'unknown' ? bestModel.toUpperCase() + ' 👑' : '—'}</div>
      </div>
      <div class="bm-section-body">
        <p style="font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">Scoreboard (rated by Claude)</p>
        <table class="bm-table">
          <tr><th>Model</th><th>Score</th><th>Strengths</th><th>Weaknesses</th></tr>
          ${scoreboardRows}
        </table>

        ${verdict.overall_analysis ? `<div style="margin-top: 12px; padding: 12px; background: var(--bg-primary); border-radius: 8px; white-space: pre-wrap;">${verdict.overall_analysis}</div>` : ''}

        ${responseCards ? `
          <p style="margin-top: 16px; font-weight: 600; color: var(--text-primary);">Individual AI Responses</p>
          <div class="ensemble-responses" style="grid-template-columns: 1fr 1fr;">
            ${responseCards}
          </div>
        ` : ''}
      </div>
    </div>`;
}

function renderSafetySection(data) {
  if (!data) return renderEmptySection('Safety (Do No Harm)', '🛡️');
  if (data.status === 'error') return renderErrorSection('Safety (Do No Harm)', '🛡️', data.error);

  const r = data.result || {};
  const verdict = r.majority_verdict || 'unknown';
  const verdictColor = verdict === 'safe' ? 'var(--green)' : 'var(--red)';
  const scores = r.scores || {};
  const safeVotes = r.safe_votes || {};
  const assessments = r.assessments || {};

  // Per-LLM verdict table
  const llms = ['claude', 'chatgpt', 'grok'];
  const llmRows = llms.map(name => {
    const a = assessments[name] || {};
    const voteIcon = a.safe === true ? '✅ Safe' : a.safe === false ? '❌ Unsafe' : '—';
    const voteColor = a.safe === true ? 'var(--green)' : a.safe === false ? 'var(--red)' : 'var(--text-muted)';
    return `<tr>
      <td style="text-transform: capitalize; font-weight: 600;">${name}</td>
      <td style="color: ${getScoreColor(a.score)}; font-weight: 700;">${a.score != null ? a.score : '—'}</td>
      <td style="color: ${voteColor};">${voteIcon}</td>
      <td style="font-size: 12px;">${a.overall_assessment || a.error || '—'}</td>
    </tr>`;
  }).join('');

  // Collect all drug interactions, red flags, etc from all assessments
  let drugInteractions = '';
  let missedFlags = '';
  for (const name of llms) {
    const a = assessments[name] || {};
    if (a.drug_interactions?.length) {
      drugInteractions += a.drug_interactions.map(d => 
        `<div class="bm-kv"><span class="bm-kv-label">${d.drugs?.join(' + ') || 'Unknown'}</span><span class="bm-kv-value" style="color: var(--red);">${d.risk}</span></div>`
      ).join('');
    }
    if (a.missed_red_flags?.length) {
      a.missed_red_flags.forEach(f => {
        if (f && f !== '...') missedFlags += `<div style="color: var(--red); font-size: 12px;">⚠️ ${f}</div>`;
      });
    }
  }

  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">🛡️ Safety (Do No Harm)</div>
        <div class="bm-section-score" style="color: ${verdictColor}; text-transform: uppercase;">${verdict}</div>
      </div>
      <div class="bm-section-body">
        <p style="font-weight: 600; color: var(--text-primary); margin-bottom: 8px;">LLM Safety Assessments</p>
        <table class="bm-table">
          <tr><th>Model</th><th>Score</th><th>Verdict</th><th>Assessment</th></tr>
          ${llmRows}
        </table>

        ${drugInteractions ? `<p style="margin-top: 16px; font-weight: 600; color: var(--red);">Drug Interactions Flagged</p>${drugInteractions}` : ''}
        ${missedFlags ? `<p style="margin-top: 12px; font-weight: 600; color: var(--red);">Missed Red Flags</p>${missedFlags}` : ''}
      </div>
    </div>`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function renderEmptySection(title, icon) {
  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">${icon} ${title}</div>
        <div class="bm-section-score" style="color: var(--text-muted)">⏳ Pending</div>
      </div>
      <div class="bm-section-body"><p>No results yet. Run benchmarks to generate.</p></div>
    </div>`;
}

function renderErrorSection(title, icon, error) {
  return `
    <div class="bm-section">
      <div class="bm-section-header">
        <div class="bm-section-title">${icon} ${title}</div>
        <div class="bm-section-score" style="color: var(--red)">Error</div>
      </div>
      <div class="bm-section-body open"><p style="color: var(--red);">${error || 'Unknown error'}</p></div>
    </div>`;
}

function getScoreColor(score) {
  if (score == null) return 'var(--text-muted)';
  if (score >= 80) return 'var(--green)';
  if (score >= 60) return 'var(--amber)';
  return 'var(--red)';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', init);
