const API_BASE = window.location.hostname === 'localhost' ? 'http://localhost:3000' : '';
const socket = io();
const hospitalId = sessionStorage.getItem('hospitalId');
const role = sessionStorage.getItem('role') || 'pharmacy';
socket.emit('join', { role, hospitalId });

// DOM Elements
const tableBody = document.getElementById('pharmacy-table-body');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search');

// Stats Elements
const statPending = document.getElementById('stat-pending');
const statPrepared = document.getElementById('stat-prepared');
const statDelivered = document.getElementById('stat-delivered');

let prescriptionsList = [];

// --- Initialization ---
function init() {
  loadPrescriptions();
  setupEventListeners();
}

function setupEventListeners() {
  searchInput.addEventListener('input', () => renderTable());

  // Table Actions (Delegation)
  tableBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const id = btn.dataset.id;
    const action = btn.dataset.action;

    if (action === 'prepare') {
      socket.emit('move-patient', { id, pharmacyState: 'prepared' });
      const idx = prescriptionsList.findIndex(x => x.id === parseInt(id));
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'prepared';
        renderTable();
        updateStats();
      }
    } else if (action === 'deliver') {
      socket.emit('move-patient', { id, pharmacyState: 'delivered', status: 'completed' });
      const idx = prescriptionsList.findIndex(x => x.id === parseInt(id));
      if (idx >= 0) {
        prescriptionsList[idx].pharmacyState = 'delivered';
        prescriptionsList[idx].status = 'completed';
        renderTable();
        updateStats();
      }
    } else if (action === 'show-qr') {
      showQRCode(id);
    } else if (action === 'download-pdf') {
      downloadPDF(id);
    }
  });
}

// --- QR Code Modal ---
async function showQRCode(patientId) {
  let patient = prescriptionsList.find(p => p.id === parseInt(patientId));
  if (!patient) {
    alert('Patient not found.');
    return;
  }

  // If patient doesn't have a publicToken, we need to generate the PDF first to create it
  if (!patient.publicToken) {
    const confirmed = confirm('QR code needs to be generated first. This will create the prescription token. Continue?');
    if (!confirmed) return;

    try {
      // Trigger PDF generation which will create the token
      await fetch(`${API_BASE}/api/prescription-pdf/${patientId}`, {
        method: 'GET',
        credentials: 'include'
      });

      // Wait a moment for the token to be saved
      await new Promise(resolve => setTimeout(resolve, 500));

      // Fetch updated patient data
      const patientResponse = await fetch(`${API_BASE}/api/patients/${patientId}`, {
        credentials: 'include'
      });

      if (patientResponse.ok) {
        patient = await patientResponse.json();
        // Update local list
        const idx = prescriptionsList.findIndex(p => p.id === parseInt(patientId));
        if (idx >= 0) {
          prescriptionsList[idx] = patient;
        }
      }
    } catch (error) {
      console.error('Error generating token:', error);
      alert('Failed to generate QR code. Please try again.');
      return;
    }
  }

  if (!patient.publicToken) {
    alert('Unable to generate QR code. Please try downloading the PDF first.');
    return;
  }

  const portalUrl = `http://localhost:3000/patient-view.html?token=${patient.publicToken}`;

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal" style="max-width: 500px; text-align: center;">
      <div class="modal-header">
        <h2 class="modal-title">Patient Prescription QR Code</h2>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div style="padding: 20px;">
        <p style="margin-bottom: 20px; color: var(--text-muted);">
          <strong>${patient.name}</strong> - Token #${patient.token}
        </p>
        <div id="qr-code-container" style="display: flex; justify-content: center; margin: 20px 0;">
          <div style="padding: 20px; background: white; border-radius: 12px; box-shadow: var(--shadow-md);">
            <canvas id="qr-canvas"></canvas>
          </div>
        </div>
        <p style="font-size: 0.9rem; color: var(--text-muted); margin-top: 20px;">
          Ask the patient to scan this QR code with their phone camera to access their digital prescription.
        </p>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Generate QR code
  loadQRCodeLibrary().then(() => {
    const canvas = document.getElementById('qr-canvas');
    if (canvas && window.QRCode) {
      QRCode.toCanvas(canvas, portalUrl, {
        width: 300,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }, (error) => {
        if (error) {
          console.error('QR Code generation error:', error);
          canvas.parentElement.innerHTML = '<p style="color: red;">Failed to generate QR code</p>';
        }
      });
    }
  });

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

function loadQRCodeLibrary() {
  return new Promise((resolve) => {
    if (window.QRCode) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    script.onload = resolve;
    script.onerror = () => {
      console.error('Failed to load QR code library');
      resolve(); // Resolve anyway to prevent hanging
    };
    document.head.appendChild(script);
  });
}

// --- PDF Download ---
async function downloadPDF(patientId) {
  try {
    const response = await fetch(`${API_BASE}/api/prescription-pdf/${patientId}`, {
      credentials: 'include'
    });

    if (response.status === 401) {
      alert('Session expired. Please log in again.');
      window.location.href = 'login.html';
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to generate PDF');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prescription_${patientId}_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    // Refresh patient data to get the newly generated token
    setTimeout(() => {
      fetch(`${API_BASE}/api/patients/${patientId}`, { credentials: 'include' })
        .then(r => r.json())
        .then(patient => {
          const idx = prescriptionsList.findIndex(p => p.id === parseInt(patientId));
          if (idx >= 0) {
            prescriptionsList[idx] = patient;
          }
        });
    }, 500);
  } catch (error) {
    console.error('PDF download error:', error);
    alert('Failed to download PDF. Please try again.');
  }
}

// --- Data Loading ---
function loadPrescriptions() {
  fetch(`${API_BASE}/api/prescriptions`, { credentials: 'include' }).then(r => r.json()).then(list => {
    prescriptionsList = list;
    renderTable();
    updateStats();
  });
}

// --- Rendering ---
function renderTable() {
  tableBody.innerHTML = '';

  const term = searchInput.value.toLowerCase();
  const filtered = prescriptionsList.filter(p => p.name.toLowerCase().includes(term));

  if (filtered.length === 0) {
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(p => {
    const tr = document.createElement('tr');
    tr.className = 'animate-fade-in';

    // Status Logic
    let status = p.pharmacyState || 'pending';
    let badgeClass = 'pending';
    if (status === 'prepared') badgeClass = 'prepared';
    if (status === 'delivered') badgeClass = 'delivered';

    // Actions
    let actionsHtml = '';
    if (status === 'pending' || !status) {
      actionsHtml = `<button class="btn btn-sm btn-primary" data-id="${p.id}" data-action="prepare">Mark Prepared</button>`;
    } else if (status === 'prepared') {
      actionsHtml = `<button class="btn btn-sm btn-accent" data-id="${p.id}" data-action="deliver">Mark Delivered</button>`;
    } else {
      actionsHtml = '<span class="text-muted">Completed</span>';
    }

    tr.innerHTML = `
      <td><strong>#${p.token}</strong></td>
      <td>
        <div style="font-weight:600;">${p.name}</div>
        <div class="text-muted" style="font-size:0.85rem;">${p.age} / ${p.gender}</div>
      </td>
      <td>
        <div style="white-space: pre-wrap; font-size: 0.9rem;">${p.prescription || '-'}</div>
      </td>
      <td><span class="badge ${badgeClass}">${status.toUpperCase()}</span></td>
      <td>
        ${actionsHtml}
        <button class="btn btn-sm btn-secondary" data-id="${p.id}" data-action="download-pdf" style="margin-left: 8px;">📄 PDF</button>
        <button class="btn btn-sm btn-secondary" data-id="${p.id}" data-action="show-qr" style="margin-left: 8px;">📱 QR</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });
}

function updateStats() {
  statPending.innerText = prescriptionsList.filter(p => !p.pharmacyState || p.pharmacyState === 'pending').length;
  statPrepared.innerText = prescriptionsList.filter(p => p.pharmacyState === 'prepared').length;
  statDelivered.innerText = prescriptionsList.filter(p => p.pharmacyState === 'delivered').length;
}

// --- Socket Events ---
socket.on('queue-updated', ({ patient }) => {
  if (patient) {
    const isRelevant = (patient.prescription && patient.prescription !== '') || patient.status === 'pharmacy' || patient.pharmacyState;

    const idx = prescriptionsList.findIndex(x => x.id === patient.id);
    if (idx >= 0) {
      if (isRelevant) prescriptionsList[idx] = patient;
      else prescriptionsList.splice(idx, 1);
    } else if (isRelevant) {
      prescriptionsList.push(patient);
    }
    renderTable();
    updateStats();
  } else {
    loadPrescriptions();
  }
});

socket.on('prescription-updated', (p) => {
  const idx = prescriptionsList.findIndex(x => x.id === p.id);
  if (idx >= 0) prescriptionsList[idx] = p;
  else prescriptionsList.push(p);
  renderTable();
  updateStats();
});

// Start
init();
