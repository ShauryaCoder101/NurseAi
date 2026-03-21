// State
let token = localStorage.getItem('doctorToken');
let doctorInfo = JSON.parse(localStorage.getItem('doctorInfo') || 'null');
let currentTab = 'unverified';
let visits = { unverified: [], verified: [], flagged: [] };
let selectedVisit = null;

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
const ratingSlider = document.getElementById('ratingSlider');
const ratingValue = document.getElementById('ratingValue');
const ratingHint = document.getElementById('ratingHint');
const remarksInput = document.getElementById('remarksInput');
const verifyBtn = document.getElementById('verifyBtn');

// Base API URL
const API_BASE = '/api';

// Initialize
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

// Event Listeners
function setupEventListeners() {
  // Login
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

  // Logout
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
      renderVisitList();
      hideDetail();
    });
  });

  // Search
  searchBox.addEventListener('input', () => {
    renderVisitList(searchBox.value);
  });

  // Slider
  ratingSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    ratingValue.textContent = val;
    if (val < 7) {
      ratingValue.style.color = 'var(--red)';
      ratingHint.textContent = 'Will be FLAGGED for review.';
      ratingHint.style.color = 'var(--red)';
      verifyBtn.textContent = 'Flag Visit';
      verifyBtn.style.backgroundColor = 'var(--red)';
      verifyBtn.style.color = 'white';
    } else {
      ratingValue.style.color = 'var(--accent)';
      ratingHint.textContent = 'Scores \u2265 7 auto-verify.';
      ratingHint.style.color = 'var(--text-muted)';
      verifyBtn.textContent = 'Submit Verification';
      verifyBtn.style.backgroundColor = 'var(--accent)';
      verifyBtn.style.color = '#000';
    }
  });

  // Verify Action
  verifyBtn.addEventListener('click', async () => {
    if (!selectedVisit) return;
    
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
          rating: parseInt(ratingSlider.value, 10),
          remarks: remarksInput.value
        })
      });
      const data = await res.json();
      
      if (data.success) {
        hideDetail();
        await fetchVisits(); // Refresh list lists and move item
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
}

// Data Fetching
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

// Rendering
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
    
    // Status badges logic mapping based on active tab
    let badgeHtml = '';
    if (currentTab === 'verified') badgeHtml = `<span class="visit-status-badge status-verified">Verified: ${visit.doctor_rating}/10</span>`;
    if (currentTab === 'flagged') badgeHtml = `<span class="visit-status-badge status-flagged">Flagged: ${visit.doctor_rating}/10</span>`;

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
  
  // Load the standard generated HTML file for this patient into the iframe
  if (visit.patient_id && visit.id) {
    detailFrame.src = `${API_BASE}/doctor/patient-record/${visit.patient_id}/visit/${visit.id}/html?token=${token}&t=${Date.now()}`;
  }
  
  // verification drawer setup
  if (currentTab === 'unverified') {
    verificationDrawer.classList.add('open');
    visitIdDisplay.textContent = `Transcript ID: ${visit.id.substring(0,8)}...`;
    
    // Add margin bottom so we can scroll the iframe content past the drawer
    detailFrame.style.marginBottom = '268px'; // drawer height + padding
    
    // Reset form
    ratingSlider.value = 8;
    ratingSlider.dispatchEvent(new Event('input'));
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

document.addEventListener('DOMContentLoaded', init);
