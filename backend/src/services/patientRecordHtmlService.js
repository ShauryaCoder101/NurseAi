// Patient Record HTML Generator Service
// Generates/updates HTML files for each patient's record
const path = require('path');
const fs = require('fs');
const {dbHelpers} = require('../config/database');

const RECORDS_DIR = path.join(__dirname, '../../patient_records');

function ensureRecordsDir() {
  if (!fs.existsSync(RECORDS_DIR)) {
    fs.mkdirSync(RECORDS_DIR, {recursive: true});
  }
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/A';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function renderReasoningSteps(reasoning) {
  if (!reasoning) return '';

  const steps = reasoning.steps || reasoning;
  if (!Array.isArray(steps)) {
    // Raw text reasoning
    const raw = reasoning.raw || JSON.stringify(reasoning);
    return `<div class="section-content">${escapeHtml(raw)}</div>`;
  }

  let html = '';
  steps.forEach((step) => {
    html += `
      <div class="reasoning-step">
        <div class="step-number">${step.step || '•'}</div>
        <div class="step-content">
          <div class="step-action">${escapeHtml(step.action || '')}</div>
          <div class="step-detail">${escapeHtml(step.detail || '')}</div>
          ${step.conclusion ? `<div class="step-conclusion">→ ${escapeHtml(step.conclusion)}</div>` : ''}
        </div>
      </div>`;
  });

  return html;
}

function renderAuditBlock(label, emoji, reasoning) {
  if (!reasoning) return '';

  const stepsHtml = renderReasoningSteps(
    typeof reasoning.reasoningSteps === 'string'
      ? JSON.parse(reasoning.reasoningSteps)
      : reasoning.reasoningSteps
  );

  return `
    <div class="audit-section">
      <div class="audit-label">${emoji} ${escapeHtml(label)}</div>
      ${stepsHtml}
      <div class="reasoning-summary">
        ${reasoning.input ? `<strong>Input:</strong> ${escapeHtml(reasoning.input)}<br>` : ''}
        ${reasoning.output ? `<strong>Output:</strong> ${escapeHtml(reasoning.output)}` : ''}
        ${reasoning.modelUsed ? `<br><strong>Model:</strong> ${escapeHtml(reasoning.modelUsed)}` : ''}
      </div>
    </div>`;
}

function generatePatientHtml(record) {
  const {patientId, patientName, generatedAt, totalVisits, visits} = record;

  let visitsHtml = '';
  (visits || []).forEach((visit) => {
    let sectionsHtml = '';

    // Audio
    if (visit.audioRecord) {
      const ar = visit.audioRecord;
      const chips = [];
      if (ar.fileName) chips.push(`<div class="audio-chip"><span>File</span> ${escapeHtml(ar.fileName)}</div>`);
      if (ar.fileSize) chips.push(`<div class="audio-chip"><span>Size</span> ${(ar.fileSize / (1024 * 1024)).toFixed(1)} MB</div>`);
      if (ar.mimeType) chips.push(`<div class="audio-chip"><span>Format</span> ${escapeHtml(ar.mimeType)}</div>`);

      if (chips.length > 0) {
        let audioPlayer = '';
        if (ar.fileUrl) {
          audioPlayer = `<div style="margin-top: 16px;"><audio controls style="width: 100%; max-width: 400px; height: 36px;" src="${escapeHtml(ar.fileUrl)}"></audio></div>`;
        }
        
        sectionsHtml += `
          <div class="section">
            <div class="section-header">
              <div class="section-icon audio">🎙️</div>
              <div class="section-title">Audio Recording</div>
            </div>
            <div class="audio-info">${chips.join('')}</div>
            ${audioPlayer}
          </div>`;
      }
    }

    // Diagnosis
    if (visit.diagnosis) {
      sectionsHtml += `
        <div class="section">
          <div class="section-header">
            <div class="section-icon diagnosis">🔬</div>
            <div class="section-title">AI Diagnosis (2Diagnosis)</div>
          </div>
          <div class="section-content">${escapeHtml(visit.diagnosis.content)}</div>
        </div>`;
    }

    // Prescription
    if (visit.prescription) {
      sectionsHtml += `
        <div class="section">
          <div class="section-header">
            <div class="section-icon prescription">💊</div>
            <div class="section-title">Prescription (Clinical Decision Support)</div>
          </div>
          <div class="section-content">${escapeHtml(visit.prescription.content)}</div>
        </div>`;
    }

    // Follow-ups
    if (visit.followups && visit.followups.length > 0) {
      let followupsHtml = '';
      visit.followups.forEach((fu) => {
        followupsHtml += `
          <div class="followup-item">
            <div class="followup-question">🗨️ Nurse asked:</div>
            <div class="followup-answer">${escapeHtml(fu.message)}</div>
            <div class="followup-time">${formatDate(fu.createdAt)}</div>
          </div>`;
        if (fu.updatedContent) {
          followupsHtml += `
            <div class="followup-item">
              <div class="followup-question">🤖 AI Response (Updated):</div>
              <div class="followup-answer">${escapeHtml(fu.updatedContent)}</div>
            </div>`;
        }
      });

      sectionsHtml += `
        <div class="section">
          <div class="section-header">
            <div class="section-icon followup">💬</div>
            <div class="section-title">Nurse Follow-ups</div>
          </div>
          ${followupsHtml}
        </div>`;
    }

    // Flag
    if (visit.flagged) {
      sectionsHtml += `
        <div class="section">
          <div class="flag-badge">🚩 Flagged for Review — "${escapeHtml(visit.flagged.reason || 'No reason provided')}"</div>
        </div>`;
    }

    // AI Audit Trail
    const audit = visit.aiAuditTrail;
    if (audit && (audit.diagnosisReasoning || audit.prescriptionReasoning || (audit.followupReasoning && audit.followupReasoning.length > 0))) {
      let auditHtml = '';
      if (audit.diagnosisReasoning) {
        auditHtml += renderAuditBlock('Diagnosis Reasoning', '🧠', audit.diagnosisReasoning);
      }
      if (audit.prescriptionReasoning) {
        auditHtml += `<div style="height:16px"></div>`;
        auditHtml += renderAuditBlock('Prescription Reasoning', '💊', audit.prescriptionReasoning);
      }
      if (audit.followupReasoning) {
        audit.followupReasoning.forEach((fr, i) => {
          auditHtml += `<div style="height:16px"></div>`;
          auditHtml += renderAuditBlock(`Follow-up Reasoning #${i + 1}`, '💬', fr);
        });
      }

      sectionsHtml += `
        <div class="section">
          <div class="section-header">
            <div class="section-icon audit">🔍</div>
            <div class="section-title">AI Reasoning Audit Trail</div>
          </div>
          ${auditHtml}
        </div>`;
    }

    visitsHtml += `
      <div class="visit">
        <div class="visit-dot"></div>
        <div class="visit-card">
          <div class="visit-header">
            <div class="visit-number">Visit #${visit.visitNumber}</div>
            <div class="visit-date">📅 ${formatDate(visit.timestamp)}</div>
          </div>
          <div class="visit-body">
            ${sectionsHtml || '<div class="section-content">No data recorded for this visit.</div>'}
          </div>
        </div>
      </div>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Patient Record — ${escapeHtml(patientId)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    :root{--bg-primary:#0F172A;--bg-secondary:#1E293B;--bg-card:#1E293B;--bg-card-alt:#273548;--accent:#14B8A6;--accent-glow:rgba(20,184,166,.15);--accent-border:rgba(20,184,166,.3);--text-primary:#F1F5F9;--text-secondary:#94A3B8;--text-muted:#64748B;--border:rgba(148,163,184,.1);--red:#EF4444;--amber:#F59E0B;--green:#22C55E;--blue:#3B82F6;--purple:#A855F7}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;min-height:100vh}
    .container{max-width:960px;margin:0 auto;padding:32px 24px}
    .header{background:linear-gradient(135deg,var(--bg-secondary),#1a2f4a);border:1px solid var(--accent-border);border-radius:20px;padding:32px;margin-bottom:32px;position:relative;overflow:hidden}
    .header::before{content:'';position:absolute;top:-50%;right:-20%;width:300px;height:300px;background:radial-gradient(circle,var(--accent-glow),transparent 70%);pointer-events:none}
    .header-top{display:flex;align-items:center;gap:16px;margin-bottom:20px;position:relative}
    .header-icon{width:56px;height:56px;background:var(--accent-glow);border:1px solid var(--accent-border);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px}
    .header-title{font-size:28px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,var(--text-primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .header-subtitle{font-size:14px;color:var(--text-secondary);font-weight:400}
    .patient-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;position:relative}
    .meta-item{background:var(--bg-card-alt);border-radius:12px;padding:14px 16px;border:1px solid var(--border)}
    .meta-label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}
    .meta-value{font-size:16px;font-weight:600;color:var(--text-primary)}
    .meta-value.id{color:var(--accent);font-family:'SF Mono','Fira Code',monospace}
    .timeline{position:relative;padding-left:40px}
    .timeline::before{content:'';position:absolute;left:15px;top:0;bottom:0;width:2px;background:linear-gradient(180deg,var(--accent),var(--accent-border),transparent)}
    .visit{position:relative;margin-bottom:32px}
    .visit-dot{position:absolute;left:-33px;top:24px;width:12px;height:12px;background:var(--accent);border-radius:50%;border:3px solid var(--bg-primary);box-shadow:0 0 12px var(--accent-glow);z-index:1}
    .visit-card{background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:border-color .2s}
    .visit-card:hover{border-color:var(--accent-border)}
    .visit-header{padding:20px 24px;background:var(--bg-card-alt);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
    .visit-number{font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px}
    .visit-date{font-size:13px;color:var(--text-secondary);font-weight:500}
    .visit-body{padding:24px}
    .section{margin-bottom:20px}.section:last-child{margin-bottom:0}
    .section-header{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .section-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
    .section-icon.diagnosis{background:rgba(59,130,246,.15)}.section-icon.prescription{background:rgba(168,85,247,.15)}.section-icon.followup{background:rgba(34,197,94,.15)}.section-icon.audit{background:rgba(245,158,11,.15)}.section-icon.audio{background:rgba(148,163,184,.15)}.section-icon.flag{background:rgba(239,68,68,.15)}
    .section-title{font-size:15px;font-weight:700;color:var(--text-primary)}
    .section-content{background:var(--bg-card-alt);border-radius:12px;padding:16px 20px;border:1px solid var(--border);font-size:14px;color:var(--text-secondary);white-space:pre-wrap;word-wrap:break-word;line-height:1.7}
    .audio-info{display:flex;gap:12px;flex-wrap:wrap}
    .audio-chip{background:var(--bg-card-alt);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:6px}
    .audio-chip span{color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-size:10px}
    .followup-item{background:var(--bg-card-alt);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:10px}.followup-item:last-child{margin-bottom:0}
    .followup-question{font-size:13px;font-weight:600;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px}
    .followup-answer{font-size:14px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.6}
    .followup-time{font-size:11px;color:var(--text-muted);margin-top:8px}
    .audit-section{border:1px dashed var(--accent-border);border-radius:12px;padding:20px;background:rgba(20,184,166,.03)}
    .audit-label{font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;display:flex;align-items:center;gap:6px}
    .reasoning-step{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;padding-left:4px}.reasoning-step:last-child{margin-bottom:0}
    .step-number{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:var(--accent-glow);border:1px solid var(--accent-border);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px}
    .step-content{flex:1}
    .step-action{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px}
    .step-detail{font-size:12px;color:var(--text-muted);line-height:1.5}
    .step-conclusion{font-size:12px;color:var(--accent);margin-top:2px;font-weight:500}
    .reasoning-summary{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text-secondary)}
    .reasoning-summary strong{color:var(--text-primary)}
    .flag-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--red);font-weight:600}
    .footer{text-align:center;padding:32px 0 16px;font-size:12px;color:var(--text-muted)}
    .footer .generated{color:var(--text-secondary);font-weight:500}
    @media(max-width:640px){.container{padding:16px 12px}.header{padding:20px;border-radius:14px}.header-title{font-size:22px}.timeline{padding-left:28px}.timeline::before{left:10px}.visit-dot{left:-23px;width:10px;height:10px}.visit-header{padding:14px 16px}.visit-body{padding:16px}}
    @media print{body{background:#fff;color:#1a1a1a}.header{background:#f8fafb;border-color:#e2e8f0}.header-title{background:none;-webkit-text-fill-color:#1a1a1a;color:#1a1a1a}.visit-card{border-color:#e2e8f0}.visit-header{background:#f8fafb}.section-content{background:#f8fafb;border-color:#e2e8f0;color:#334155}.audit-section{background:#fffbeb;border-color:#fbbf24}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div class="header-icon">🏥</div>
        <div>
          <div class="header-title">Patient Record</div>
          <div class="header-subtitle">NurseAI — Comprehensive Visit History</div>
        </div>
      </div>
      <div class="patient-meta">
        <div class="meta-item">
          <div class="meta-label">Patient ID</div>
          <div class="meta-value id">${escapeHtml(patientId)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Patient Name</div>
          <div class="meta-value">${escapeHtml(patientName)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Total Visits</div>
          <div class="meta-value">${totalVisits || 0}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Last Updated</div>
          <div class="meta-value">${formatDate(generatedAt)}</div>
        </div>
      </div>
    </div>
    <div class="timeline">
      ${visitsHtml || '<div class="section-content">No visits recorded yet.</div>'}
    </div>
    <div class="footer">
      <div class="generated">Generated on ${formatDate(generatedAt)}</div>
      <div style="margin-top:4px">NurseAI Clinical Assistant — Patient Record Export</div>
  </div>
</body>
</html>`;
}

function generateVisitHtml(record, targetVisitId) {
  const {patientId, patientName, generatedAt, visits} = record;

  // Use a softer match. The visit should be the one where any of the transcripts match or we fallback to the first visit if only 1 is passed
  let visit = (visits || []).find(
    (v) =>
      v.diagnosis?.id === targetVisitId ||
      v.prescription?.id === targetVisitId ||
      v.audioRecord?.id === targetVisitId
  );
  if (!visit && visits && visits.length === 1) {
    visit = visits[0];
  }
  
  if (!visit) {
    return '<html><body><div style="padding:20px; font-family:sans-serif;">Visit not found.</div></body></html>';
  }

  let sectionsHtml = '';

  // Audio
  if (visit.audioRecord) {
    const ar = visit.audioRecord;
    const chips = [];
    if (ar.fileName) chips.push(`<div class="audio-chip"><span>File</span> ${escapeHtml(ar.fileName)}</div>`);
    if (ar.fileSize) chips.push(`<div class="audio-chip"><span>Size</span> ${(ar.fileSize / (1024 * 1024)).toFixed(1)} MB</div>`);
    if (ar.mimeType) chips.push(`<div class="audio-chip"><span>Format</span> ${escapeHtml(ar.mimeType)}</div>`);

    if (chips.length > 0) {
      let audioPlayer = '';
      if (ar.fileUrl) {
        audioPlayer = `<div style="margin-top: 16px;"><audio controls style="width: 100%; max-width: 400px; height: 36px;" src="${escapeHtml(ar.fileUrl)}"></audio></div>`;
      }
        
      sectionsHtml += `
        <div class="section">
          <div class="section-header">
            <div class="section-icon audio">🎙️</div>
            <div class="section-title">Audio Recording</div>
          </div>
          <div class="audio-info">${chips.join('')}</div>
          ${audioPlayer}
        </div>`;
    }
  }

  // Diagnosis
  if (visit.diagnosis) {
    sectionsHtml += `
      <div class="section">
        <div class="section-header">
          <div class="section-icon diagnosis">🔬</div>
          <div class="section-title">AI Diagnosis (2Diagnosis)</div>
        </div>
        <div class="section-content">${escapeHtml(visit.diagnosis.content)}</div>
      </div>`;
  }

  // Prescription
  if (visit.prescription) {
    sectionsHtml += `
      <div class="section">
        <div class="section-header">
          <div class="section-icon prescription">💊</div>
          <div class="section-title">Prescription (Clinical Decision Support)</div>
        </div>
        <div class="section-content">${escapeHtml(visit.prescription.content)}</div>
      </div>`;
  }

  // Follow-ups
  if (visit.followups && visit.followups.length > 0) {
    let followupsHtml = '';
    visit.followups.forEach((fu) => {
      followupsHtml += `
        <div class="followup-item">
          <div class="followup-question">🗨️ Nurse asked:</div>
          <div class="followup-answer">${escapeHtml(fu.message)}</div>
          <div class="followup-time">${formatDate(fu.createdAt)}</div>
        </div>`;
      if (fu.updatedContent) {
        followupsHtml += `
          <div class="followup-item">
            <div class="followup-question">🤖 AI Response (Updated):</div>
            <div class="followup-answer">${escapeHtml(fu.updatedContent)}</div>
          </div>`;
      }
    });

    sectionsHtml += `
      <div class="section">
        <div class="section-header">
          <div class="section-icon followup">💬</div>
          <div class="section-title">Nurse Follow-ups</div>
        </div>
        ${followupsHtml}
      </div>`;
  }

  // Flag
  if (visit.flagged) {
    sectionsHtml += `
      <div class="section">
        <div class="flag-badge">🚩 Flagged for Review — "${escapeHtml(visit.flagged.reason || 'No reason provided')}"</div>
      </div>`;
  }

  // AI Audit Trail
  const audit = visit.aiAuditTrail;
  if (audit && (audit.diagnosisReasoning || audit.prescriptionReasoning || (audit.followupReasoning && audit.followupReasoning.length > 0))) {
    let auditHtml = '';
    if (audit.diagnosisReasoning) {
      auditHtml += renderAuditBlock('Diagnosis Reasoning', '🧠', audit.diagnosisReasoning);
    }
    if (audit.prescriptionReasoning) {
      auditHtml += `<div style="height:16px"></div>`;
      auditHtml += renderAuditBlock('Prescription Reasoning', '💊', audit.prescriptionReasoning);
    }
    if (audit.followupReasoning) {
      audit.followupReasoning.forEach((fr, i) => {
        auditHtml += `<div style="height:16px"></div>`;
        auditHtml += renderAuditBlock(`Follow-up Reasoning #${i + 1}`, '💬', fr);
      });
    }

    sectionsHtml += `
      <div class="section">
        <div class="section-header">
          <div class="section-icon audit">🔍</div>
          <div class="section-title">AI Reasoning Audit Trail</div>
        </div>
        ${auditHtml}
      </div>`;
  }

  const visitHtml = `
    <div class="visit">
      <div class="visit-card" style="border-color: var(--accent-border);">
        <div class="visit-header">
          <div class="visit-number">Visit #${visit.visitNumber}</div>
          <div class="visit-date">📅 ${formatDate(visit.timestamp)}</div>
        </div>
        <div class="visit-body">
          ${sectionsHtml || '<div class="section-content">No data recorded for this visit.</div>'}
        </div>
      </div>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Visit Record — ${escapeHtml(patientId)}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    :root{--bg-primary:#0F172A;--bg-secondary:#1E293B;--bg-card:#1E293B;--bg-card-alt:#273548;--accent:#14B8A6;--accent-glow:rgba(20,184,166,.15);--accent-border:rgba(20,184,166,.3);--text-primary:#F1F5F9;--text-secondary:#94A3B8;--text-muted:#64748B;--border:rgba(148,163,184,.1);--red:#EF4444;--amber:#F59E0B;--green:#22C55E;--blue:#3B82F6;--purple:#A855F7}
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg-primary);color:var(--text-primary);line-height:1.6;min-height:100vh}
    .container{max-width:960px;margin:0 auto;padding:32px 24px}
    .header{background:linear-gradient(135deg,var(--bg-secondary),#1a2f4a);border:1px solid var(--accent-border);border-radius:20px;padding:32px;margin-bottom:32px;position:relative;overflow:hidden}
    .header::before{content:'';position:absolute;top:-50%;right:-20%;width:300px;height:300px;background:radial-gradient(circle,var(--accent-glow),transparent 70%);pointer-events:none}
    .header-top{display:flex;align-items:center;gap:16px;margin-bottom:20px;position:relative}
    .header-icon{width:56px;height:56px;background:var(--accent-glow);border:1px solid var(--accent-border);border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px}
    .header-title{font-size:28px;font-weight:800;letter-spacing:-.5px;background:linear-gradient(135deg,var(--text-primary),var(--accent));-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
    .header-subtitle{font-size:14px;color:var(--text-secondary);font-weight:400}
    .patient-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;position:relative}
    .meta-item{background:var(--bg-card-alt);border-radius:12px;padding:14px 16px;border:1px solid var(--border)}
    .meta-label{font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}
    .meta-value{font-size:16px;font-weight:600;color:var(--text-primary)}
    .meta-value.id{color:var(--accent);font-family:'SF Mono','Fira Code',monospace}
    .visit{position:relative;margin-bottom:32px}
    .visit-card{background:var(--bg-card);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:border-color .2s}
    .visit-header{padding:20px 24px;background:var(--bg-card-alt);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
    .visit-number{font-size:13px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px}
    .visit-date{font-size:13px;color:var(--text-secondary);font-weight:500}
    .visit-body{padding:24px}
    .section{margin-bottom:20px}.section:last-child{margin-bottom:0}
    .section-header{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .section-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px}
    .section-icon.diagnosis{background:rgba(59,130,246,.15)}.section-icon.prescription{background:rgba(168,85,247,.15)}.section-icon.followup{background:rgba(34,197,94,.15)}.section-icon.audit{background:rgba(245,158,11,.15)}.section-icon.audio{background:rgba(148,163,184,.15)}.section-icon.flag{background:rgba(239,68,68,.15)}
    .section-title{font-size:15px;font-weight:700;color:var(--text-primary)}
    .section-content{background:var(--bg-card-alt);border-radius:12px;padding:16px 20px;border:1px solid var(--border);font-size:14px;color:var(--text-secondary);white-space:pre-wrap;word-wrap:break-word;line-height:1.7}
    .audio-info{display:flex;gap:12px;flex-wrap:wrap}
    .audio-chip{background:var(--bg-card-alt);border:1px solid var(--border);border-radius:8px;padding:8px 14px;font-size:12px;color:var(--text-secondary);display:flex;align-items:center;gap:6px}
    .audio-chip span{color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.5px;font-size:10px}
    .followup-item{background:var(--bg-card-alt);border:1px solid var(--border);border-radius:12px;padding:16px 20px;margin-bottom:10px}.followup-item:last-child{margin-bottom:0}
    .followup-question{font-size:13px;font-weight:600;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:6px}
    .followup-answer{font-size:14px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.6}
    .followup-time{font-size:11px;color:var(--text-muted);margin-top:8px}
    .audit-section{border:1px dashed var(--accent-border);border-radius:12px;padding:20px;background:rgba(20,184,166,.03)}
    .audit-label{font-size:11px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;display:flex;align-items:center;gap:6px}
    .reasoning-step{display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;padding-left:4px}.reasoning-step:last-child{margin-bottom:0}
    .step-number{flex-shrink:0;width:24px;height:24px;border-radius:50%;background:var(--accent-glow);border:1px solid var(--accent-border);color:var(--accent);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:2px}
    .step-content{flex:1}
    .step-action{font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:2px}
    .step-detail{font-size:12px;color:var(--text-muted);line-height:1.5}
    .step-conclusion{font-size:12px;color:var(--accent);margin-top:2px;font-weight:500}
    .reasoning-summary{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);font-size:13px;color:var(--text-secondary)}
    .reasoning-summary strong{color:var(--text-primary)}
    .flag-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:6px 12px;font-size:12px;color:var(--red);font-weight:600}
    .footer{text-align:center;padding:32px 0 16px;font-size:12px;color:var(--text-muted)}
    .footer .generated{color:var(--text-secondary);font-weight:500}
    @media(max-width:640px){.container{padding:16px 12px}.header{padding:20px;border-radius:14px}.header-title{font-size:22px}.visit-header{padding:14px 16px}.visit-body{padding:16px}}
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="header-top">
        <div class="header-icon">🏥</div>
        <div>
          <div class="header-title">Visit Record</div>
          <div class="header-subtitle">NurseAI — Isolated Consultation</div>
        </div>
      </div>
      <div class="patient-meta">
        <div class="meta-item">
          <div class="meta-label">Patient ID</div>
          <div class="meta-value id">${escapeHtml(patientId)}</div>
        </div>
        <div class="meta-item">
          <div class="meta-label">Patient Name</div>
          <div class="meta-value">${escapeHtml(patientName)}</div>
        </div>
      </div>
    </div>
    
    ${visitHtml}
    
    <div class="footer">
      <div class="generated">Generated on ${formatDate(generatedAt)}</div>
      <div style="margin-top:4px">NurseAI Clinical Assistant — Visit Snapshot</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Regenerate the HTML file for a patient.
 * Fetches ALL data from DB and writes/overwrites the HTML file.
 * @param {string} userUid - The nurse's user UID
 * @param {string} patientId - The patient ID
 */
async function regeneratePatientHtml(userUid, patientId) {
  if (!patientId) return;

  try {
    ensureRecordsDir();

    // Fetch all data for this patient (same logic as patientRecordController)
    const [audioRecords, transcripts, reasoningLogs, followupLogs, flaggedSuggestions] = await Promise.all([
      dbHelpers.all(
        'SELECT * FROM audio_records WHERE user_uid = $1 AND patient_id = $2 ORDER BY created_at ASC',
        [userUid, patientId]
      ),
      dbHelpers.all(
        'SELECT * FROM transcripts WHERE user_uid = $1 AND patient_id = $2 ORDER BY created_at ASC',
        [userUid, patientId]
      ),
      dbHelpers.all(
        'SELECT * FROM ai_reasoning_log WHERE patient_id = $1 ORDER BY created_at ASC',
        [patientId]
      ),
      dbHelpers.all(
        'SELECT * FROM followup_log WHERE patient_id = $1 ORDER BY created_at ASC',
        [patientId]
      ),
      dbHelpers.all(
        'SELECT * FROM flagged_suggestions WHERE user_uid = $1 AND patient_id = $2 ORDER BY flagged_at ASC',
        [userUid, patientId]
      ),
    ]);

    const patientName =
      transcripts[0]?.patient_name ||
      audioRecords[0]?.patient_name ||
      'Unknown';

    // Build visit map
    const visitMap = new Map();
    audioRecords.forEach((ar, index) => {
      visitMap.set(ar.id, {
        visitNumber: index + 1,
        timestamp: ar.created_at,
        audioRecord: {
          id: ar.id,
          fileName: ar.file_name || null,
          fileSize: ar.file_size || null,
          mimeType: ar.mime_type || null,
          filePath: ar.file_path || null,
          fileUrl: ar.file_url || null,
          photoName: ar.photo_name || null,
          photoPath: ar.photo_path || null,
        },
        diagnosis: null,
        prescription: null,
        followups: [],
        aiAuditTrail: {
          diagnosisReasoning: null,
          prescriptionReasoning: null,
          followupReasoning: [],
        },
        flagged: null,
      });
    });

    transcripts.forEach((t) => {
      const visit = t.audio_record_id ? visitMap.get(t.audio_record_id) : null;
      const entry = {
        id: t.id,
        content: t.content,
        source: t.source,
        title: t.title,
        completed: t.suggestion_completed,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };

      if (visit) {
        if (t.source === 'gemini-diagnosis') visit.diagnosis = entry;
        else if (t.source === 'gemini') visit.prescription = entry;
      }

      const tReasoningLogs = reasoningLogs.filter((rl) => rl.transcript_id === t.id);
      tReasoningLogs.forEach((rl) => {
        const re = {
          input: rl.input_summary,
          reasoningSteps: rl.reasoning_steps,
          output: rl.output_summary,
          modelUsed: rl.model_used,
          createdAt: rl.created_at,
        };
        if (visit) {
          if (rl.stage === 'diagnosis') visit.aiAuditTrail.diagnosisReasoning = re;
          else if (rl.stage === 'prescription') visit.aiAuditTrail.prescriptionReasoning = re;
          else if (rl.stage === 'followup') visit.aiAuditTrail.followupReasoning.push(re);
        }
      });

      const tFollowups = followupLogs.filter((fl) => fl.transcript_id === t.id);
      if (visit) {
        tFollowups.forEach((fl) => {
          visit.followups.push({
            id: fl.id,
            message: fl.message,
            previousContent: fl.previous_content,
            updatedContent: fl.updated_content,
            createdAt: fl.created_at,
          });
        });
      }

      const flagged = flaggedSuggestions.find((fs) => fs.transcript_id === t.id);
      if (visit && flagged) {
        visit.flagged = {reason: flagged.reason, flaggedAt: flagged.flagged_at};
      }
    });

    const visits = Array.from(visitMap.values());
    visits.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    visits.forEach((v, i) => (v.visitNumber = i + 1));

    const record = {
      patientId,
      patientName,
      generatedAt: new Date().toISOString(),
      totalVisits: visits.length,
      visits,
    };

    const html = generatePatientHtml(record);
    const safeId = patientId.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(RECORDS_DIR, `${safeId}.html`);
    fs.writeFileSync(filePath, html, 'utf8');
    console.log(`📄 Patient HTML record updated: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Failed to regenerate patient HTML:', error);
    return null;
  }
}

module.exports = {
  regeneratePatientHtml,
  generateVisitHtml,
};
