// ── State ───────────────────────────────────────────────────────────────────────
let token = localStorage.getItem('doctorToken');
let doctorInfo = JSON.parse(localStorage.getItem('doctorInfo') || 'null');
let cases = [];
let casesLoaded = false;
let selectedCase = null;
let transcripts = {}; // audioId -> transcript text (cached)
let completedCases = new Set(); // IDs of cases marked as done

const API_BASE = '/api';

// ── DOM Elements ────────────────────────────────────────────────────────────────
const loginOverlay = document.getElementById('loginOverlay');
const appContent = document.getElementById('appContent');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const doctorNameDisplay = document.getElementById('doctorNameDisplay');
const logoutBtn = document.getElementById('logoutBtn');
const searchBox = document.getElementById('searchBox');
const caseList = document.getElementById('caseList');
const detailColumn = document.getElementById('detailColumn');
const detailEmpty = document.getElementById('detailEmpty');
const detailContent = document.getElementById('detailContent');

// ── Init ────────────────────────────────────────────────────────────────────────
function init() {
  if (token && doctorInfo) {
    showApp();
    showSkeletonLoading();
    fetchCases();
    fetchCompletedCases();
  } else {
    showLogin();
  }
  setupEvents();
}

function showSkeletonLoading() {
  let html = '';
  for (let i = 0; i < 12; i++) {
    html += `<div class="skeleton-item" style="animation-delay: ${i * 0.05}s">
      <div style="display:flex; justify-content:space-between; align-items:center">
        <div class="skeleton-line medium"></div>
        <div class="skeleton-badge"></div>
      </div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line short"></div>
    </div>`;
  }
  caseList.innerHTML = html;
}

function showLogin() {
  loginOverlay.classList.remove('hidden');
  appContent.classList.add('hidden');
}

function showApp() {
  loginOverlay.classList.add('hidden');
  appContent.classList.remove('hidden');
  doctorNameDisplay.textContent = doctorInfo?.name || 'Doctor';
}

// ── Events ──────────────────────────────────────────────────────────────────────
function setupEvents() {
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
        showApp();
        fetchCases();
        fetchCompletedCases();
      } else {
        loginError.style.display = 'block';
        loginError.textContent = data.error || 'Invalid credentials';
      }
    } catch (err) {
      loginError.style.display = 'block';
      loginError.textContent = 'Connection error';
    }
  });

  logoutBtn.addEventListener('click', () => {
    token = null;
    doctorInfo = null;
    localStorage.removeItem('doctorToken');
    localStorage.removeItem('doctorInfo');
    showLogin();
  });

  searchBox.addEventListener('input', () => renderCaseList(searchBox.value));
}

// ── Fetch Cases ─────────────────────────────────────────────────────────────────
async function fetchCases() {
  try {
    const res = await fetch(`${API_BASE}/doctor/benchmarking/cases`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.status === 401 || res.status === 403) {
      logoutBtn.click();
      return;
    }

    const data = await res.json();
    if (data.success) {
      cases = data.data;
      casesLoaded = true;
      renderCaseList();

      // Auto-select case from URL param (from metrics page link)
      const urlParams = new URLSearchParams(window.location.search);
      const caseId = urlParams.get('caseId');
      if (caseId) {
        const target = cases.find(c => c.id === caseId);
        if (target) {
          selectCase(target);
          // Scroll the case list item into view
          setTimeout(() => {
            const activeEl = document.querySelector('.case-item.active');
            if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 200);
        }
      }
    } else {
      casesLoaded = true;
      caseList.innerHTML = `<div class="empty-state">Error: ${data.error}</div>`;
    }
  } catch (err) {
    console.error('Failed to fetch cases', err);
    casesLoaded = true;
    caseList.innerHTML = `<div class="empty-state">Error loading cases. <button onclick="fetchCases()" style="background:none; border:none; color:var(--accent); cursor:pointer; text-decoration:underline;">Retry</button></div>`;
  }
}

async function fetchCompletedCases() {
  try {
    const res = await fetch(`${API_BASE}/doctor/benchmarking/completed`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success) {
      completedCases = new Set(data.data);
      if (casesLoaded) renderCaseList(searchBox.value);
    }
  } catch (err) {
    console.error('Failed to fetch completed cases', err);
  }
}

// ── Render Case List ────────────────────────────────────────────────────────────
function renderCaseList(searchQuery = '') {
  caseList.innerHTML = '';
  if (cases.length === 0) {
    caseList.innerHTML = `<div class="empty-state">No benchmark cases found.</div>`;
    return;
  }

  const query = searchQuery.toLowerCase();
  let filtered = cases.filter(c =>
    !query ||
    (c.patientName || '').toLowerCase().includes(query) ||
    (c.patientId || '').toLowerCase().includes(query)
  );

  if (filtered.length === 0) {
    caseList.innerHTML = `<div class="empty-state">No cases match "${searchQuery}"</div>`;
    return;
  }

  // Sort: B3 unmarked first, then B3 marked, then B2 (done), then B1 (done)
  const batchOrder = {'benchmark-3': 0, 'benchmark-2': 1, 'benchmark-1': 2};
  filtered = filtered.sort((a, b) => {
    const aBatch = a.batch || 'benchmark-1';
    const bBatch = b.batch || 'benchmark-1';
    const aOrder = batchOrder[aBatch] ?? 2;
    const bOrder = batchOrder[bBatch] ?? 2;
    if (aOrder !== bOrder) return aOrder - bOrder;
    // Within B3: unmarked before marked
    if (aBatch === 'benchmark-3') {
      const aDone = completedCases.has(a.id) ? 1 : 0;
      const bDone = completedCases.has(b.id) ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
    }
    return (a.batchIndex || 0) - (b.batchIndex || 0);
  });

  // Update sidebar title with counts
  const sidebarTitle = document.getElementById('sidebarTitle');
  if (sidebarTitle) {
    const b1 = cases.filter(c => (c.batch || 'benchmark-1') === 'benchmark-1').length;
    const b2 = cases.filter(c => c.batch === 'benchmark-2').length;
    const b3 = cases.filter(c => c.batch === 'benchmark-3').length;
    sidebarTitle.textContent = `📋 Cases (B1: ${b1} · B2: ${b2} · B3: ${b3})`;
  }

  filtered.forEach((c) => {
    const isActive = selectedCase && selectedCase.id === c.id;
    const hasRx = !!c.prescription;
    const batch = c.batch || 'benchmark-1';
    // B1 and B2 cases always shown as done
    const isDone = (batch === 'benchmark-1' || batch === 'benchmark-2') ? true : completedCases.has(c.id);
    const date = new Date(c.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const batchShort = batch === 'benchmark-3' ? 'B3' : batch === 'benchmark-2' ? 'B2' : 'B1';
    const batchColor = batch === 'benchmark-3' ? '#f59e0b' : batch === 'benchmark-2' ? '#a78bfa' : '#60a5fa';

    const el = document.createElement('div');
    el.className = `case-item${isActive ? ' active' : ''}${isDone ? ' done' : ''}`;
    el.innerHTML = `
      <div class="case-header">
        <div class="case-patient">
          <span style="display:inline-block;background:${batchColor};color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:5px;vertical-align:middle;">${batchShort}</span>
          ${escapeHtml(c.patientName)}
        </div>
        <div class="case-date">${date}</div>
      </div>
      <div class="case-id">${escapeHtml(c.patientId)}</div>
      <div class="case-meta">${isDone ? '<span style="color:var(--green);font-weight:700;">✓ Done</span> · ' : ''}${batchShort} #${c.batchIndex || '?'}</div>
      <div class="case-badge ${hasRx ? 'badge-has-rx' : 'badge-no-rx'}">${hasRx ? '✓ Prescription' : '— No Rx'}</div>
    `;

    el.addEventListener('click', () => selectCase(c));
    caseList.appendChild(el);
  });
}

// ── Select Case ─────────────────────────────────────────────────────────────────
function selectCase(c) {
  selectedCase = c;
  renderCaseList(searchBox.value);
  renderDetail(c);
}

// Evaluation criteria definitions
const EVAL_CRITERIA = [
  {
    key: 'valid',
    icon: '✅',
    title: '1. VALID',
    question: 'Does the provisional diagnosis logically follow from the interview transcript?',
    positive: 'Valid',
    negative: 'Invalid',
    commentLabel: 'Why is it invalid?',
  },
  {
    key: 'appropriate',
    icon: '🎯',
    title: '2. APPROPRIATE',
    question: 'Is there any test or treatment suggested that doesn\'t seem appropriate because of clinical or socioeconomic reasons?',
    positive: 'Appropriate',
    negative: 'Inappropriate',
    commentLabel: 'What is inappropriate and why?',
  },
  {
    key: 'safe_severe',
    icon: '🚨',
    title: '3. SAFE (Severe Harm)',
    question: 'Does the recommendation have high risk of SEVERE harm because a safer alternative was skipped, or because a critical intervention was missed?',
    positive: 'Safe',
    negative: 'Harmful',
    commentLabel: 'What severe harm could occur and what was missed?',
  },
  {
    key: 'explainable',
    icon: '🧠',
    title: '4. EXPLAINABLE',
    question: 'Does the clinical reasoning make sense? (It doesn\'t matter if you disagree with the final conclusion — that is captured in validity already.)',
    positive: 'Yes',
    negative: 'No',
    commentLabel: 'Why doesn\'t the reasoning make sense?',
  },
];

let evaluationState = {}; // { criterion: { value, comment } }

function renderReasoning(c) {
  const hasSteps = c.reasoningSteps && (Array.isArray(c.reasoningSteps) || (typeof c.reasoningSteps === 'object' && c.reasoningSteps.steps));
  
  if (!hasSteps && !c.diagnosis) return '';

  let stepsHtml = '';
  if (hasSteps) {
    const steps = Array.isArray(c.reasoningSteps) ? c.reasoningSteps : (c.reasoningSteps.steps || []);
    stepsHtml = steps.map(s => `
      <div class="reasoning-step">
        <div class="step-number">${s.step || '•'}</div>
        <div class="step-content">
          <div class="step-action">${escapeHtml(s.action || '')}</div>
          <div class="step-detail">${escapeHtml(s.detail || '')}</div>
          ${s.conclusion ? `<div class="step-conclusion">→ ${escapeHtml(s.conclusion)}</div>` : ''}
        </div>
      </div>
    `).join('');

    // Input/Output summaries
    const input = c.reasoningInput || c.reasoningSteps?.input_summary || '';
    const output = c.reasoningOutput || c.reasoningSteps?.output_summary || '';
    if (input || output) {
      stepsHtml += `<div class="reasoning-summary">`;
      if (input) stepsHtml += `<div><strong>Input:</strong> ${escapeHtml(input)}</div>`;
      if (output) stepsHtml += `<div><strong>Output:</strong> ${escapeHtml(output)}</div>`;
      stepsHtml += `</div>`;
    }
  } else {
    stepsHtml = `<div style="white-space:pre-wrap">${escapeHtml(c.diagnosis)}</div>`;
  }

  return `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-icon reasoning">💊</div>
        <div class="section-title">Prescription Reasoning</div>
      </div>
      <div class="section-body">${stepsHtml}</div>
    </div>
  `;
}

async function renderDetail(c) {
  detailEmpty.classList.add('hidden');
  detailContent.classList.remove('hidden');

  const date = new Date(c.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fileSize = c.fileSize ? `${(c.fileSize / (1024 * 1024)).toFixed(1)} MB` : '—';
  const cachedTranscript = c.transcript || transcripts[c.id];

  // Reset evaluation state
  evaluationState = {};

  detailContent.innerHTML = `
    <!-- Patient Header -->
    <div class="patient-header">
      <h2>${escapeHtml(c.patientName)}</h2>
      <div class="meta">
        <div>ID: <span>${escapeHtml(c.patientId)}</span></div>
        <div>Date: <span>${date}</span></div>
        ${c.modelUsed ? `<div>Model: <span style="color:var(--accent);font-weight:600;">${escapeHtml(c.modelUsed)}</span></div>` : ''}
      </div>
    </div>

    <!-- Audio Section -->
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-icon audio">🎙️</div>
        <div class="section-title">Audio Recording</div>
      </div>
      <div class="section-body">
        <div class="audio-row">
          <audio controls src="/api/doctor/audio/${encodeURIComponent(c.id)}"></audio>
        </div>
        <div class="audio-chips">
          <div class="audio-chip"><span>File</span> ${escapeHtml(c.fileName || '—')}</div>
          <div class="audio-chip"><span>Size</span> ${fileSize}</div>
          <div class="audio-chip"><span>Format</span> ${escapeHtml(c.mimeType || 'audio/mp4')}</div>
        </div>
      </div>
    </div>

    <!-- Transcript Section -->
    ${cachedTranscript ? `
    <div class="section-card" id="transcriptSection-${c.id}">
      <div class="section-card-header">
        <div class="section-icon transcript">📝</div>
        <div class="section-title">English Transcript</div>
      </div>
      <div class="section-body" id="transcriptBody-${c.id}">${escapeHtml(cachedTranscript)}</div>
    </div>
    ` : ''}



    <!-- Prescription Section -->
    ${c.prescription ? `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-icon prescription">💊</div>
        <div class="section-title">Prescription</div>
      </div>
      <div class="section-body" style="white-space: pre-wrap;">${escapeHtml(c.prescription)}</div>
    </div>
    ` : `
    <div class="section-card">
      <div class="section-card-header">
        <div class="section-icon prescription">💊</div>
        <div class="section-title">Prescription</div>
      </div>
      <div class="section-body" style="color: var(--text-muted); font-style: italic;">No prescription generated for this case.</div>
    </div>
    `}

    <!-- Reasoning Section -->
    ${renderReasoning(c)}

    <!-- Evaluation Section -->
    <div class="section-card" style="border-color: var(--accent-border);">
      <div class="section-card-header" style="background: var(--accent-glow);">
        <div class="section-icon" style="background: var(--accent-glow); font-size: 20px;">📊</div>
        <div class="section-title" style="color: var(--accent);">Doctor Evaluation</div>
      </div>
      <div class="section-body" style="padding: 0;">
        ${EVAL_CRITERIA.map(cr => `
          <div class="eval-card" id="eval-card-${cr.key}">
            <div class="eval-header">
              <span class="eval-icon">${cr.icon}</span>
              <div>
                <div class="eval-title">${cr.title}</div>
                <div class="eval-question">${cr.question}</div>
              </div>
            </div>
            <div class="eval-buttons">
              <button class="eval-btn eval-btn-positive" id="eval-pos-${cr.key}" onclick="selectEval('${c.id}','${cr.key}','${cr.positive}')">
                ${cr.positive}
              </button>
              <button class="eval-btn eval-btn-negative" id="eval-neg-${cr.key}" onclick="selectEval('${c.id}','${cr.key}','${cr.negative}')">
                ${cr.negative}
              </button>
            </div>
            <div class="eval-comment-box" id="eval-comment-box-${cr.key}" style="display:none;">
              <textarea class="eval-comment" id="eval-comment-${cr.key}" placeholder="${cr.commentLabel}" rows="2"></textarea>
              <button class="eval-save-comment" onclick="saveComment('${c.id}','${cr.key}')">Save Comment</button>
            </div>
            <div class="eval-saved" id="eval-saved-${cr.key}" style="display:none;">✓ Saved</div>
          </div>
        `).join('')}
      </div>
    </div>

    <!-- Submit Button -->
    <div style="margin-top: 20px; text-align: center;">
      <button class="btn-submit-eval" id="submitEvalBtn" disabled onclick="submitEvaluation('${c.id}')">
        Submit Evaluation
      </button>
      <div id="submitStatus" style="margin-top: 8px; font-size: 13px; color: var(--text-muted);"></div>
    </div>
  `;

  // Fetch existing evaluations for this case
  await loadEvaluations(c.id);
}

// ── Evaluations ─────────────────────────────────────────────────────────────────
async function loadEvaluations(audioId) {
  try {
    const res = await fetch(`${API_BASE}/doctor/benchmarking/evaluations/${audioId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (data.success && data.data.length > 0) {
      for (const row of data.data) {
        evaluationState[row.criterion] = { value: row.value, comment: row.comment || '' };
        applyEvalUI(row.criterion, row.value, row.comment);
      }
    }
    updateSubmitButton();
  } catch (err) {
    console.error('Load evaluations error:', err);
  }
}

function applyEvalUI(criterion, value, comment) {
  const cr = EVAL_CRITERIA.find(c => c.key === criterion);
  if (!cr) return;

  const posBtn = document.getElementById(`eval-pos-${criterion}`);
  const negBtn = document.getElementById(`eval-neg-${criterion}`);
  const commentBox = document.getElementById(`eval-comment-box-${criterion}`);
  const commentText = document.getElementById(`eval-comment-${criterion}`);
  const savedEl = document.getElementById(`eval-saved-${criterion}`);

  if (value === cr.positive) {
    posBtn.classList.add('selected');
    negBtn.classList.remove('selected');
    commentBox.style.display = 'none';
  } else if (value === cr.negative) {
    negBtn.classList.add('selected');
    posBtn.classList.remove('selected');
    commentBox.style.display = 'block';
    if (comment) commentText.value = comment;
  }
  savedEl.style.display = 'block';
}

function updateSubmitButton() {
  const btn = document.getElementById('submitEvalBtn');
  if (!btn) return;
  const filled = EVAL_CRITERIA.every(cr => evaluationState[cr.key]?.value);
  btn.disabled = !filled;
  if (selectedCase && completedCases.has(selectedCase.id)) {
    // Allow editing — show "Update" instead of locking
    btn.disabled = !filled;
    btn.textContent = '✏️ Update Evaluation';
    btn.style.background = 'var(--amber)';
    btn.style.color = '#000';
  }
}

async function selectEval(audioId, criterion, value) {
  const cr = EVAL_CRITERIA.find(c => c.key === criterion);
  if (!cr) return;

  evaluationState[criterion] = { value, comment: evaluationState[criterion]?.comment || '' };

  const posBtn = document.getElementById(`eval-pos-${criterion}`);
  const negBtn = document.getElementById(`eval-neg-${criterion}`);
  const commentBox = document.getElementById(`eval-comment-box-${criterion}`);

  if (value === cr.positive) {
    posBtn.classList.add('selected');
    negBtn.classList.remove('selected');
    commentBox.style.display = 'none';
  } else {
    negBtn.classList.add('selected');
    posBtn.classList.remove('selected');
    commentBox.style.display = 'block';
  }
  updateSubmitButton();
}

function saveComment(audioId, criterion) {
  const comment = document.getElementById(`eval-comment-${criterion}`)?.value || '';
  if (evaluationState[criterion]) {
    evaluationState[criterion].comment = comment;
  }
  const savedEl = document.getElementById(`eval-saved-${criterion}`);
  if (savedEl) { savedEl.style.display = 'block'; savedEl.textContent = '✓ Comment noted'; }
}

async function submitEvaluation(audioId) {
  const btn = document.getElementById('submitEvalBtn');
  const status = document.getElementById('submitStatus');
  if (!btn) return;

  // Collect all evaluations
  const evaluations = EVAL_CRITERIA.map(cr => ({
    criterion: cr.key,
    value: evaluationState[cr.key]?.value || '',
    comment: evaluationState[cr.key]?.comment || ''
  }));

  const missing = evaluations.filter(e => !e.value);
  if (missing.length > 0) {
    if (status) { status.textContent = 'Please select all criteria before submitting.'; status.style.color = 'var(--amber)'; }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    const res = await fetch(`${API_BASE}/doctor/benchmarking/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ audioRecordId: audioId, evaluations })
    });
    const data = await res.json();
    if (data.success) {
      completedCases.add(audioId);
      btn.textContent = '✓ Evaluation Updated';
      btn.style.background = 'var(--green)';
      btn.style.color = '#000';
      if (status) { status.textContent = 'Evaluation saved. You can still edit and re-submit.'; status.style.color = 'var(--green)'; }
      renderCaseList(searchBox.value);
      // After 2s, revert to "Update" style so they know they can edit again
      setTimeout(() => {
        if (btn) {
          btn.textContent = '✏️ Update Evaluation';
          btn.style.background = 'var(--amber)';
          btn.style.color = '#000';
          btn.disabled = false;
        }
      }, 2000);
    } else {
      btn.textContent = 'Submit Evaluation';
      btn.disabled = false;
      if (status) { status.textContent = data.error || 'Failed'; status.style.color = 'var(--red)'; }
    }
  } catch (err) {
    console.error('Submit error:', err);
    btn.textContent = 'Submit Evaluation';
    btn.disabled = false;
    if (status) { status.textContent = 'Network error'; status.style.color = 'var(--red)'; }
  }
}

// ── Transcribe Audio ────────────────────────────────────────────────────────────
async function transcribeCase(audioId) {
  const btn = document.getElementById(`transcribeBtn-${audioId}`);
  if (!btn) return;

  if (transcripts[audioId]) {
    const section = document.getElementById(`transcriptSection-${audioId}`);
    if (section) section.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Transcribing...';

  try {
    const res = await fetch(`${API_BASE}/doctor/benchmarking/transcribe/${audioId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (data.success && data.data.transcript) {
      transcripts[audioId] = data.data.transcript;
      const section = document.getElementById(`transcriptSection-${audioId}`);
      const body = document.getElementById(`transcriptBody-${audioId}`);
      if (section) section.style.display = '';
      if (body) body.textContent = data.data.transcript;
      btn.innerHTML = '✓ Transcript Ready';
      btn.style.background = 'var(--green)';
    } else {
      btn.innerHTML = '✗ Failed';
      btn.style.background = 'var(--red)';
      setTimeout(() => { btn.innerHTML = '📝 Provide Transcript'; btn.style.background = ''; btn.disabled = false; }, 3000);
    }
  } catch (err) {
    console.error('Transcription error:', err);
    btn.innerHTML = '✗ Error';
    btn.style.background = 'var(--red)';
    setTimeout(() => { btn.innerHTML = '📝 Provide Transcript'; btn.style.background = ''; btn.disabled = false; }, 3000);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Start
init();

