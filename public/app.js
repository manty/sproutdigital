// DOM Elements
const urlInput = document.getElementById('urlInput');
const cloneBtn = document.getElementById('cloneBtn');
const btnText = document.getElementById('btnText');
const btnSpinner = document.getElementById('btnSpinner');
const jobSection = document.getElementById('jobSection');
const logConsole = document.getElementById('logConsole');
const progressSteps = document.getElementById('progressSteps');
const resultSection = document.getElementById('resultSection');
const errorSection = document.getElementById('errorSection');
const outputPath = document.getElementById('outputPath');
const assetsInfo = document.getElementById('assetsInfo');
const openCloneLink = document.getElementById('openCloneLink');
const editCloneLink = document.getElementById('editCloneLink');
const cloneAnotherBtn = document.getElementById('cloneAnotherBtn');
const errorMessage = document.getElementById('errorMessage');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const particlesContainer = document.getElementById('particles');
const clonesList = document.getElementById('clonesList');

// State
let currentJobId = null;
let currentCloneId = null;
let ws = null;
let completedSteps = new Set();

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadClonesList();
});

// Load list of cloned pages
async function loadClonesList() {
  try {
    const response = await fetch('/api/clones');
    const clones = await response.json();

    if (clones.length === 0) {
      clonesList.innerHTML = '<p class="text-white/50 col-span-full text-center py-8">No cloned pages yet. Clone your first page above!</p>';
      return;
    }

    clonesList.innerHTML = clones.map(clone => `
      <div class="bg-black/40 border border-white/10 rounded-xl p-4 hover:border-cyan-500/50 transition-all">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-cyan-300 truncate">${clone.id}</h3>
          <span class="text-xs text-white/40">${new Date(clone.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="flex gap-2">
          <a href="${clone.previewUrl}" target="_blank" class="flex-1 text-center bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded-lg text-sm transition-all">
            Preview
          </a>
          <a href="${clone.editUrl}" class="flex-1 text-center bg-gradient-to-r from-pink-500 to-cyan-500 px-3 py-2 rounded-lg text-sm font-semibold text-white transition-all hover:opacity-90">
            Edit
          </a>
        </div>
      </div>
    `).join('');
  } catch (error) {
    clonesList.innerHTML = '<p class="text-red-400 col-span-full text-center py-8">Error loading clones</p>';
  }
}

// Initialize particles
function createParticles() {
  const colors = ['#ff00ff', '#00ffff', '#00ff88', '#ffff00', '#ff8800'];
  for (let i = 0; i < 30; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    particle.style.animationDelay = Math.random() * 15 + 's';
    particle.style.animationDuration = (10 + Math.random() * 10) + 's';
    particlesContainer.appendChild(particle);
  }
}

createParticles();

// Event Listeners
cloneBtn.addEventListener('click', startClone);
urlInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') startClone();
});
cloneAnotherBtn.addEventListener('click', resetUI);
tryAgainBtn.addEventListener('click', resetUI);

// Start clone process
async function startClone() {
  const url = urlInput.value.trim();

  if (!url) {
    showError('Please enter a URL');
    return;
  }

  // Reset UI for new job
  setLoading(true);
  jobSection.classList.remove('hidden');
  resultSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  logConsole.innerHTML = '';
  resetProgressSteps();
  completedSteps.clear();

  try {
    // Start clone job
    const response = await fetch('/api/clone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to start clone job');
    }

    const { jobId } = await response.json();
    currentJobId = jobId;

    // Connect to WebSocket for logs
    connectWebSocket(jobId);
  } catch (error) {
    setLoading(false);
    showError(error.message);
  }
}

// Connect to WebSocket
function connectWebSocket(jobId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}?jobId=${jobId}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    addLog('pipeline', 'Connected to clone server...');
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleLogMessage(data);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    addLog('error', 'WebSocket connection error');
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
  };
}

// Handle incoming log messages
function handleLogMessage(data) {
  const { type, message } = data;

  switch (type) {
    case 'console':
      addLog('console', message);
      break;

    case 'network':
      addLog('network', message);
      break;

    case 'pipeline':
      addLog('pipeline', message);
      break;

    case 'step':
      updateProgress(message);
      break;

    case 'complete':
      handleComplete(JSON.parse(message));
      break;

    case 'error':
      handleError(message);
      break;

    default:
      addLog('pipeline', message);
  }
}

// Add log entry to console
function addLog(type, message) {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;

  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'console' ? '[console]' :
                 type === 'network' ? '[network]' :
                 type === 'pipeline' ? '[pipeline]' :
                 type === 'error' ? '[error]' : '[log]';

  entry.innerHTML = `<span class="opacity-50">${timestamp}</span> ${prefix} ${escapeHtml(message)}`;
  logConsole.appendChild(entry);

  // Auto-scroll to bottom
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Update progress steps
function updateProgress(step) {
  // Mark current step as active, previous steps as completed
  const allSteps = progressSteps.querySelectorAll('.step-item');
  let foundCurrent = false;

  allSteps.forEach((stepEl) => {
    const stepName = stepEl.dataset.step;

    if (stepName === step) {
      stepEl.classList.remove('completed');
      stepEl.classList.add('active');
      foundCurrent = true;
      completedSteps.add(stepName);
    } else if (completedSteps.has(stepName)) {
      stepEl.classList.remove('active');
      stepEl.classList.add('completed');
    } else {
      stepEl.classList.remove('active', 'completed');
    }
  });

  // Add to completed steps
  completedSteps.add(step);

  // Add step log
  addLog('step', `Step: ${step}`);
}

// Handle clone complete
function handleComplete(result) {
  setLoading(false);

  // Mark all steps as completed
  const allSteps = progressSteps.querySelectorAll('.step-item');
  allSteps.forEach((stepEl) => {
    stepEl.classList.remove('active');
    stepEl.classList.add('completed');
  });

  // Store current clone ID for editing
  currentCloneId = result.folderName;

  // Show result section
  resultSection.classList.remove('hidden');
  outputPath.textContent = result.folderName;
  assetsInfo.textContent = `${result.assetsDownloaded} downloaded, ${result.assetsFailed} failed`;
  openCloneLink.href = result.staticUrl || result.openUrl;
  editCloneLink.href = `/editor.html?id=${result.folderName}`;

  addLog('pipeline', 'Clone completed successfully!');

  // Refresh clones list
  loadClonesList();

  // Close WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }
}

// Handle error
function handleError(message) {
  setLoading(false);

  // Mark current step as error
  const allSteps = progressSteps.querySelectorAll('.step-item');
  allSteps.forEach((stepEl) => {
    if (stepEl.classList.contains('active')) {
      stepEl.classList.remove('active');
      stepEl.classList.add('error');
    }
  });

  // Show error section
  errorSection.classList.remove('hidden');
  errorMessage.textContent = message;

  addLog('error', message);

  // Close WebSocket
  if (ws) {
    ws.close();
    ws = null;
  }
}

// Reset progress steps
function resetProgressSteps() {
  const allSteps = progressSteps.querySelectorAll('.step-item');
  allSteps.forEach((stepEl) => {
    stepEl.classList.remove('active', 'completed', 'error');
  });
}

// Reset UI
function resetUI() {
  urlInput.value = '';
  jobSection.classList.add('hidden');
  resultSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  logConsole.innerHTML = '<div class="p-4 text-white/50 text-center">Waiting for clone job to start...</div>';
  resetProgressSteps();
  completedSteps.clear();
  currentJobId = null;
}

// Show quick error toast
function showError(message) {
  errorSection.classList.remove('hidden');
  errorMessage.textContent = message;
  jobSection.classList.remove('hidden');
}

// Set loading state
function setLoading(isLoading) {
  cloneBtn.disabled = isLoading;
  urlInput.disabled = isLoading;

  if (isLoading) {
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
  } else {
    btnText.classList.remove('hidden');
    btnSpinner.classList.add('hidden');
  }
}

// Escape HTML for safe rendering
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
