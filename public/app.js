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
const foldersList = document.getElementById('foldersList');

// State
let currentJobId = null;
let currentCloneId = null;
let ws = null;
let completedSteps = new Set();

// Folder/Clone management state
let folders = [];
let clones = [];
let currentFolderId = 'all';
let actionCloneId = null; // Clone being acted upon
let actionType = null; // 'rename', 'delete', 'move'

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadFolders();
  loadClonesList();
  setupModalListeners();
  setupFolderListeners();
});

// ============================================
// FOLDER MANAGEMENT
// ============================================

async function loadFolders() {
  try {
    const response = await fetch('/api/folders');
    folders = await response.json();
    renderFolders();
  } catch (error) {
    console.error('Error loading folders:', error);
  }
}

function renderFolders() {
  const allItem = `
    <div class="folder-item ${currentFolderId === 'all' ? 'active' : ''}" data-folder-id="all">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
      </svg>
      <span>All Clones</span>
    </div>
  `;

  const folderItems = folders.map(folder => `
    <div class="folder-item ${currentFolderId === folder.id ? 'active' : ''}"
         data-folder-id="${folder.id}"
         draggable="false"
         ondragover="handleFolderDragOver(event)"
         ondragleave="handleFolderDragLeave(event)"
         ondrop="handleFolderDrop(event, '${folder.id}')">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
      </svg>
      <span class="flex-1 truncate">${escapeHtml(folder.name)}</span>
      <button class="opacity-0 group-hover:opacity-100 hover:text-red-400" onclick="deleteFolder('${folder.id}', event)">
        <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `).join('');

  // Add "Uncategorized" option for moving
  const uncategorizedItem = `
    <div class="folder-item ${currentFolderId === 'uncategorized' ? 'active' : ''}"
         data-folder-id="uncategorized"
         ondragover="handleFolderDragOver(event)"
         ondragleave="handleFolderDragLeave(event)"
         ondrop="handleFolderDrop(event, null)">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path fill-rule="evenodd" d="M4 4a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2V8a2 2 0 00-2-2h-5L9 4H4zm7 5a1 1 0 10-2 0v1H8a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V9z" clip-rule="evenodd"/>
      </svg>
      <span>Uncategorized</span>
    </div>
  `;

  foldersList.innerHTML = allItem + folderItems + uncategorizedItem;

  // Add click listeners to folder items
  foldersList.querySelectorAll('.folder-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // Ignore delete button clicks
      selectFolder(item.dataset.folderId);
    });
  });
}

function selectFolder(folderId) {
  currentFolderId = folderId;
  renderFolders();
  loadClonesList();
}

async function createFolder(name) {
  try {
    const response = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      await loadFolders();
    }
  } catch (error) {
    console.error('Error creating folder:', error);
  }
}

async function deleteFolder(folderId, event) {
  event.stopPropagation();
  if (!confirm('Delete this folder? Clones will be moved to Uncategorized.')) return;

  try {
    const response = await fetch(`/api/folders/${folderId}`, { method: 'DELETE' });
    if (response.ok) {
      if (currentFolderId === folderId) {
        currentFolderId = 'all';
      }
      await loadFolders();
      await loadClonesList();
    }
  } catch (error) {
    console.error('Error deleting folder:', error);
  }
}

// ============================================
// CLONE MANAGEMENT
// ============================================

async function loadClonesList() {
  try {
    let url = '/api/clones';
    if (currentFolderId && currentFolderId !== 'all') {
      url += `?folderId=${currentFolderId === 'uncategorized' ? '' : currentFolderId}`;
    }

    const response = await fetch(url);
    clones = await response.json();

    // Filter for uncategorized if needed
    if (currentFolderId === 'uncategorized') {
      clones = clones.filter(c => !c.folderId);
    }

    renderClones();
  } catch (error) {
    clonesList.innerHTML = '<p class="text-red-400 col-span-full text-center py-8">Error loading clones</p>';
  }
}

function renderClones() {
  if (clones.length === 0) {
    clonesList.innerHTML = '<p class="text-white/50 col-span-full text-center py-8">No cloned pages yet. Clone your first page above!</p>';
    return;
  }

  clonesList.innerHTML = clones.map(clone => `
    <div class="clone-card" draggable="true" data-clone-id="${clone.id}"
         ondragstart="handleCloneDragStart(event, '${clone.id}')"
         ondragend="handleCloneDragEnd(event)">

      <!-- Three-dot menu -->
      <div class="clone-card-menu">
        <button class="clone-card-menu-btn" onclick="toggleCloneMenu('${clone.id}', event)">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z"/>
          </svg>
        </button>
        <div class="clone-card-dropdown" id="dropdown-${clone.id}">
          <div class="clone-card-dropdown-item" onclick="openRenameModal('${clone.id}', '${escapeHtml(clone.name)}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
            </svg>
            Rename
          </div>
          <div class="clone-card-dropdown-item" onclick="openMoveModal('${clone.id}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
            </svg>
            Move to Folder
          </div>
          <div class="clone-card-dropdown-item" onclick="downloadClone('${clone.id}', 'zip')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            Download ZIP
          </div>
          <div class="clone-card-dropdown-item" onclick="downloadClone('${clone.id}', 'html')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
            </svg>
            Download HTML
          </div>
          <div class="clone-card-dropdown-divider"></div>
          <div class="clone-card-dropdown-item danger" onclick="openDeleteModal('${clone.id}', '${escapeHtml(clone.name)}')">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
            Delete
          </div>
        </div>
      </div>

      <div class="mb-3 pr-8">
        <h3 class="font-semibold text-cyan-300 truncate" title="${escapeHtml(clone.name)}">${escapeHtml(clone.name)}</h3>
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
}

function toggleCloneMenu(cloneId, event) {
  event.stopPropagation();

  // Close all other dropdowns
  document.querySelectorAll('.clone-card-dropdown').forEach(d => {
    if (d.id !== `dropdown-${cloneId}`) {
      d.classList.remove('show');
    }
  });

  const dropdown = document.getElementById(`dropdown-${cloneId}`);
  dropdown.classList.toggle('show');
}

// Close dropdowns when clicking outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.clone-card-menu')) {
    document.querySelectorAll('.clone-card-dropdown').forEach(d => d.classList.remove('show'));
  }
});

// ============================================
// MODALS
// ============================================

function setupModalListeners() {
  // Create Folder Modal
  document.getElementById('addFolderBtn').addEventListener('click', () => {
    document.getElementById('folderNameInput').value = '';
    showModal('createFolderModal');
  });

  document.getElementById('folderCancelBtn').addEventListener('click', () => hideModal('createFolderModal'));
  document.getElementById('folderConfirmBtn').addEventListener('click', async () => {
    const name = document.getElementById('folderNameInput').value.trim();
    if (name) {
      await createFolder(name);
      hideModal('createFolderModal');
    }
  });

  // Rename Modal
  document.getElementById('renameCancelBtn').addEventListener('click', () => hideModal('renameModal'));
  document.getElementById('renameConfirmBtn').addEventListener('click', async () => {
    const name = document.getElementById('renameInput').value.trim();
    if (name && actionCloneId) {
      await renameClone(actionCloneId, name);
      hideModal('renameModal');
    }
  });

  // Delete Modal
  document.getElementById('deleteCancelBtn').addEventListener('click', () => hideModal('deleteModal'));
  document.getElementById('deleteConfirmBtn').addEventListener('click', async () => {
    if (actionCloneId) {
      await deleteClone(actionCloneId);
      hideModal('deleteModal');
    }
  });

  // Move Modal
  document.getElementById('moveCancelBtn').addEventListener('click', () => hideModal('moveModal'));

  // Close modals on background click
  ['renameModal', 'deleteModal', 'moveModal', 'createFolderModal'].forEach(modalId => {
    document.getElementById(modalId).addEventListener('click', (e) => {
      if (e.target.id === modalId) hideModal(modalId);
    });
  });

  // Enter key support for inputs
  document.getElementById('renameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('renameConfirmBtn').click();
  });
  document.getElementById('folderNameInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') document.getElementById('folderConfirmBtn').click();
  });
}

function setupFolderListeners() {
  // Already handled in renderFolders
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  // Focus first input
  const input = modal.querySelector('input');
  if (input) setTimeout(() => input.focus(), 100);
}

function hideModal(modalId) {
  const modal = document.getElementById(modalId);
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  actionCloneId = null;
}

function openRenameModal(cloneId, currentName) {
  actionCloneId = cloneId;
  document.getElementById('renameInput').value = currentName;
  document.querySelectorAll('.clone-card-dropdown').forEach(d => d.classList.remove('show'));
  showModal('renameModal');
}

function openDeleteModal(cloneId, cloneName) {
  actionCloneId = cloneId;
  document.getElementById('deleteCloneName').textContent = cloneName;
  document.querySelectorAll('.clone-card-dropdown').forEach(d => d.classList.remove('show'));
  showModal('deleteModal');
}

function openMoveModal(cloneId) {
  actionCloneId = cloneId;
  document.querySelectorAll('.clone-card-dropdown').forEach(d => d.classList.remove('show'));

  // Render folder options
  const moveFolderList = document.getElementById('moveFolderList');
  const currentClone = clones.find(c => c.id === cloneId);

  let options = `
    <div class="folder-item ${!currentClone?.folderId ? 'active' : ''}" onclick="moveClone('${cloneId}', null)">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
      </svg>
      <span>Uncategorized</span>
    </div>
  `;

  options += folders.map(folder => `
    <div class="folder-item ${currentClone?.folderId === folder.id ? 'active' : ''}" onclick="moveClone('${cloneId}', '${folder.id}')">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
        <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
      </svg>
      <span>${escapeHtml(folder.name)}</span>
    </div>
  `).join('');

  moveFolderList.innerHTML = options;
  showModal('moveModal');
}

// ============================================
// CLONE ACTIONS
// ============================================

async function renameClone(cloneId, name) {
  try {
    const response = await fetch(`/api/clones/${cloneId}/rename`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (response.ok) {
      await loadClonesList();
    }
  } catch (error) {
    console.error('Error renaming clone:', error);
  }
}

async function deleteClone(cloneId) {
  try {
    const response = await fetch(`/api/clones/${cloneId}`, { method: 'DELETE' });
    if (response.ok) {
      await loadClonesList();
    }
  } catch (error) {
    console.error('Error deleting clone:', error);
  }
}

async function moveClone(cloneId, folderId) {
  try {
    const response = await fetch(`/api/clones/${cloneId}/move`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId })
    });
    if (response.ok) {
      hideModal('moveModal');
      await loadClonesList();
    }
  } catch (error) {
    console.error('Error moving clone:', error);
  }
}

function downloadClone(cloneId, format) {
  document.querySelectorAll('.clone-card-dropdown').forEach(d => d.classList.remove('show'));
  window.location.href = `/api/clones/${cloneId}/download?format=${format}`;
}

// ============================================
// DRAG AND DROP
// ============================================

let draggedCloneId = null;

function handleCloneDragStart(event, cloneId) {
  draggedCloneId = cloneId;
  event.target.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', cloneId);
}

function handleCloneDragEnd(event) {
  event.target.classList.remove('dragging');
  draggedCloneId = null;
  // Remove drag-over class from all folders
  document.querySelectorAll('.folder-item').forEach(f => f.classList.remove('drag-over'));
}

function handleFolderDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drag-over');
}

function handleFolderDragLeave(event) {
  event.currentTarget.classList.remove('drag-over');
}

async function handleFolderDrop(event, folderId) {
  event.preventDefault();
  event.currentTarget.classList.remove('drag-over');

  if (draggedCloneId) {
    await moveClone(draggedCloneId, folderId);
  }
}

// ============================================
// EXISTING CODE (clone process, etc.)
// ============================================

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
