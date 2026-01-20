// Editor State
const state = {
  cloneId: null,
  editMode: false,
  links: [],
  images: [],
  pixels: {
    facebook: { enabled: false, id: '' },
    google: { enabled: false, id: '' },
    tiktok: { enabled: false, id: '' },
    customHead: '',
    customBody: ''
  },
  settings: {
    title: '',
    description: '',
    favicon: ''
  },
  selectedImage: null,
  hasChanges: false
};

// DOM Elements
const previewIframe = document.getElementById('previewIframe');
const cloneNameEl = document.getElementById('cloneName');
const toast = document.getElementById('toast');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Get clone ID from URL
  const params = new URLSearchParams(window.location.search);
  state.cloneId = params.get('id');

  if (!state.cloneId) {
    alert('No clone ID specified. Please select a clone to edit.');
    window.location.href = '/';
    return;
  }

  cloneNameEl.textContent = state.cloneId;
  loadClone();
  setupEventListeners();
});

// Load clone into iframe
async function loadClone() {
  const cloneUrl = `/clone/${state.cloneId}/index.html`;
  previewIframe.src = cloneUrl;

  previewIframe.onload = () => {
    extractPageData();
    if (state.editMode) {
      enableEditMode();
    }
  };

  // Load saved edits if any
  try {
    const response = await fetch(`/api/editor/${state.cloneId}`);
    if (response.ok) {
      const data = await response.json();
      if (data.pixels) state.pixels = data.pixels;
      if (data.settings) state.settings = data.settings;
      applyLoadedSettings();
    }
  } catch (e) {
    console.log('No saved edits found');
  }
}

// Extract links and images from the iframe
function extractPageData() {
  try {
    const doc = previewIframe.contentDocument;
    if (!doc) return;

    // Extract links
    state.links = [];
    const links = doc.querySelectorAll('a[href]');
    links.forEach((link, index) => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        state.links.push({
          index,
          original: href,
          current: href,
          text: link.textContent.trim().slice(0, 50) || '[No text]',
          element: link
        });
      }
    });

    // Extract images
    state.images = [];
    const images = doc.querySelectorAll('img[src]');
    images.forEach((img, index) => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:')) {
        state.images.push({
          index,
          original: src,
          current: src,
          alt: img.alt || '',
          element: img
        });
      }
    });

    // Extract page title and meta
    const title = doc.querySelector('title');
    state.settings.title = title ? title.textContent : '';
    const metaDesc = doc.querySelector('meta[name="description"]');
    state.settings.description = metaDesc ? metaDesc.getAttribute('content') : '';

    renderLinksList();
    renderImagesList();
    applyLoadedSettings();
  } catch (e) {
    console.error('Error extracting page data:', e);
  }
}

// Render links list in sidebar
function renderLinksList() {
  const container = document.getElementById('linksList');
  container.innerHTML = '';

  state.links.forEach((link, idx) => {
    const div = document.createElement('div');
    div.className = 'link-item';
    div.innerHTML = `
      <div class="text-xs text-gray-400 mb-1 truncate">${link.text}</div>
      <input type="url" class="input-field text-sm" value="${link.current}"
             data-link-index="${idx}" placeholder="Destination URL">
    `;
    container.appendChild(div);

    // Update link on change
    div.querySelector('input').addEventListener('change', (e) => {
      state.links[idx].current = e.target.value;
      updateLinkInIframe(idx);
      state.hasChanges = true;
    });
  });

  if (state.links.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-sm">No links found on page</p>';
  }
}

// Render images list in sidebar
function renderImagesList() {
  const container = document.getElementById('imagesList');
  container.innerHTML = '';

  state.images.forEach((img, idx) => {
    const div = document.createElement('div');
    div.className = 'image-item cursor-pointer';
    div.innerHTML = `
      <img src="${img.current}" class="w-full h-20 object-cover rounded mb-2 bg-gray-900">
      <div class="text-xs text-gray-400 truncate">${img.alt || 'Image ' + (idx + 1)}</div>
    `;
    container.appendChild(div);

    div.addEventListener('click', () => openImageModal(idx));
  });

  if (state.images.length === 0) {
    container.innerHTML = '<p class="text-gray-500 text-sm">No images found on page</p>';
  }
}

// Update link in iframe
function updateLinkInIframe(idx) {
  try {
    const doc = previewIframe.contentDocument;
    const links = doc.querySelectorAll('a[href]');
    let linkIndex = 0;

    links.forEach(link => {
      const href = link.getAttribute('href');
      if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
        if (linkIndex === idx) {
          link.setAttribute('href', state.links[idx].current);
          // Also update onclick to prevent default navigation in edit mode
          link.setAttribute('data-original-href', state.links[idx].original);
        }
        linkIndex++;
      }
    });
  } catch (e) {
    console.error('Error updating link:', e);
  }
}

// Apply global link to all links
function applyGlobalLink() {
  const globalUrl = document.getElementById('globalLink').value;
  if (!globalUrl) return;

  state.links.forEach((link, idx) => {
    link.current = globalUrl;
    updateLinkInIframe(idx);
  });

  renderLinksList();
  state.hasChanges = true;
  showToast('Applied to all links!');
}

// Image Modal
function openImageModal(idx) {
  state.selectedImage = idx;
  const img = state.images[idx];
  document.getElementById('modalCurrentImage').src = img.current;
  document.getElementById('modalImageUrl').value = '';
  document.getElementById('imageModal').classList.remove('hidden');
  document.getElementById('imageModal').classList.add('flex');
}

function closeImageModal() {
  document.getElementById('imageModal').classList.add('hidden');
  document.getElementById('imageModal').classList.remove('flex');
  state.selectedImage = null;
}

function applyImageChange() {
  const urlInput = document.getElementById('modalImageUrl').value;
  const fileInput = document.getElementById('modalImageUpload');

  if (fileInput.files.length > 0) {
    // Upload file
    uploadAndReplaceImage(fileInput.files[0], state.selectedImage);
  } else if (urlInput) {
    // Use URL directly
    replaceImage(state.selectedImage, urlInput);
  }

  closeImageModal();
}

async function uploadAndReplaceImage(file, idx) {
  // Convert file to base64
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const response = await fetch('/api/editor/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cloneId: state.cloneId,
          imageData: reader.result,
          filename: file.name
        })
      });

      if (response.ok) {
        const data = await response.json();
        replaceImage(idx, data.url);
        showToast('Image uploaded!');
      } else {
        throw new Error('Upload failed');
      }
    } catch (e) {
      alert('Error uploading image');
    }
  };
  reader.readAsDataURL(file);
}

function replaceImage(idx, newSrc) {
  state.images[idx].current = newSrc;

  // Update in iframe
  try {
    const doc = previewIframe.contentDocument;
    const images = doc.querySelectorAll('img[src]');
    let imgIndex = 0;

    images.forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.startsWith('data:')) {
        if (imgIndex === idx) {
          img.src = newSrc;
        }
        imgIndex++;
      }
    });
  } catch (e) {
    console.error('Error replacing image:', e);
  }

  renderImagesList();
  state.hasChanges = true;
}

// Edit Mode - inline text editing
function toggleEditMode() {
  state.editMode = !state.editMode;
  const btn = document.getElementById('editModeBtn');

  if (state.editMode) {
    btn.textContent = 'Edit Mode: ON';
    btn.style.background = '#00ff88';
    btn.style.color = '#000';
    enableEditMode();
  } else {
    btn.textContent = 'Edit Mode: OFF';
    btn.style.background = '#333';
    btn.style.color = '#fff';
    disableEditMode();
  }
}

function enableEditMode() {
  try {
    const doc = previewIframe.contentDocument;

    // Make text elements editable
    const editableSelectors = 'h1, h2, h3, h4, h5, h6, p, span, a, button, li, td, th, label';
    doc.querySelectorAll(editableSelectors).forEach(el => {
      el.setAttribute('contenteditable', 'true');
      el.classList.add('edit-highlight');

      el.addEventListener('focus', () => el.classList.add('editing'));
      el.addEventListener('blur', () => {
        el.classList.remove('editing');
        state.hasChanges = true;
      });
    });

    // Make images clickable for replacement
    doc.querySelectorAll('img').forEach((img, idx) => {
      img.style.cursor = 'pointer';
      img.classList.add('edit-highlight');
      img.onclick = (e) => {
        e.preventDefault();
        // Find the matching index in our state
        const images = doc.querySelectorAll('img[src]');
        let imgIndex = 0;
        images.forEach((i, iIdx) => {
          if (i === img) imgIndex = iIdx;
        });
        openImageModal(imgIndex);
      };
    });

    // Prevent link navigation
    doc.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (e) => {
        if (state.editMode) e.preventDefault();
      });
    });

    // Inject edit mode styles
    const style = doc.createElement('style');
    style.id = 'edit-mode-styles';
    style.textContent = `
      .edit-highlight:hover { outline: 2px dashed #00ff88 !important; outline-offset: 2px; }
      .editing { outline: 2px solid #ff00ff !important; background: rgba(255,0,255,0.1) !important; }
      [contenteditable]:focus { outline: 2px solid #00ff88 !important; }
    `;
    doc.head.appendChild(style);
  } catch (e) {
    console.error('Error enabling edit mode:', e);
  }
}

function disableEditMode() {
  try {
    const doc = previewIframe.contentDocument;

    doc.querySelectorAll('[contenteditable]').forEach(el => {
      el.removeAttribute('contenteditable');
      el.classList.remove('edit-highlight', 'editing');
    });

    doc.querySelectorAll('img').forEach(img => {
      img.classList.remove('edit-highlight');
      img.onclick = null;
      img.style.cursor = '';
    });

    const style = doc.getElementById('edit-mode-styles');
    if (style) style.remove();
  } catch (e) {
    console.error('Error disabling edit mode:', e);
  }
}

// Save changes
async function saveChanges() {
  // Get the current HTML from iframe
  let html;
  try {
    const doc = previewIframe.contentDocument;

    // Remove edit mode artifacts
    disableEditMode();

    // Inject pixels
    injectPixels(doc);

    // Update meta tags
    updateMetaTags(doc);

    html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  } catch (e) {
    alert('Error getting page content');
    return;
  }

  try {
    const response = await fetch('/api/editor/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cloneId: state.cloneId,
        html: html,
        pixels: state.pixels,
        settings: state.settings,
        links: state.links.map(l => ({ original: l.original, current: l.current })),
        images: state.images.map(i => ({ original: i.original, current: i.current }))
      })
    });

    if (response.ok) {
      showToast('Saved successfully!');
      state.hasChanges = false;
    } else {
      throw new Error('Save failed');
    }
  } catch (e) {
    alert('Error saving changes');
  }
}

// Inject tracking pixels into document
function injectPixels(doc) {
  // Remove any existing pixel scripts we added
  doc.querySelectorAll('[data-sprout-pixel]').forEach(el => el.remove());

  let headCode = '';
  let bodyCode = '';

  // Facebook Pixel
  if (state.pixels.facebook.enabled && state.pixels.facebook.id) {
    headCode += `
<!-- Facebook Pixel -->
<script data-sprout-pixel="facebook">
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${state.pixels.facebook.id}');
fbq('track', 'PageView');
</script>
<noscript data-sprout-pixel="facebook"><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${state.pixels.facebook.id}&ev=PageView&noscript=1"/></noscript>
`;
  }

  // Google Analytics
  if (state.pixels.google.enabled && state.pixels.google.id) {
    headCode += `
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${state.pixels.google.id}" data-sprout-pixel="google"></script>
<script data-sprout-pixel="google">
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${state.pixels.google.id}');
</script>
`;
  }

  // TikTok Pixel
  if (state.pixels.tiktok.enabled && state.pixels.tiktok.id) {
    headCode += `
<!-- TikTok Pixel -->
<script data-sprout-pixel="tiktok">
!function (w, d, t) {
w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
ttq.load('${state.pixels.tiktok.id}');
ttq.page();
}(window, document, 'ttq');
</script>
`;
  }

  // Custom code
  if (state.pixels.customHead) {
    headCode += `\n<!-- Custom Head Code -->\n${state.pixels.customHead}\n`;
  }
  if (state.pixels.customBody) {
    bodyCode += `\n<!-- Custom Body Code -->\n${state.pixels.customBody}\n`;
  }

  // Inject into document
  if (headCode) {
    const headContainer = doc.createElement('div');
    headContainer.innerHTML = headCode;
    while (headContainer.firstChild) {
      doc.head.appendChild(headContainer.firstChild);
    }
  }
  if (bodyCode) {
    const bodyContainer = doc.createElement('div');
    bodyContainer.innerHTML = bodyCode;
    while (bodyContainer.firstChild) {
      doc.body.appendChild(bodyContainer.firstChild);
    }
  }
}

// Update meta tags
function updateMetaTags(doc) {
  // Title
  if (state.settings.title) {
    let title = doc.querySelector('title');
    if (!title) {
      title = doc.createElement('title');
      doc.head.appendChild(title);
    }
    title.textContent = state.settings.title;
  }

  // Meta description
  if (state.settings.description) {
    let meta = doc.querySelector('meta[name="description"]');
    if (!meta) {
      meta = doc.createElement('meta');
      meta.name = 'description';
      doc.head.appendChild(meta);
    }
    meta.setAttribute('content', state.settings.description);
  }

  // Favicon
  if (state.settings.favicon) {
    let link = doc.querySelector('link[rel="icon"]');
    if (!link) {
      link = doc.createElement('link');
      link.rel = 'icon';
      doc.head.appendChild(link);
    }
    link.href = state.settings.favicon;
  }
}

// Apply loaded settings to form
function applyLoadedSettings() {
  document.getElementById('pageTitle').value = state.settings.title || '';
  document.getElementById('metaDescription').value = state.settings.description || '';
  document.getElementById('faviconUrl').value = state.settings.favicon || '';

  document.getElementById('fbPixelEnabled').checked = state.pixels.facebook?.enabled || false;
  document.getElementById('fbPixelId').value = state.pixels.facebook?.id || '';
  document.getElementById('gaEnabled').checked = state.pixels.google?.enabled || false;
  document.getElementById('gaId').value = state.pixels.google?.id || '';
  document.getElementById('ttPixelEnabled').checked = state.pixels.tiktok?.enabled || false;
  document.getElementById('ttPixelId').value = state.pixels.tiktok?.id || '';
  document.getElementById('customHeadCode').value = state.pixels.customHead || '';
  document.getElementById('customBodyCode').value = state.pixels.customBody || '';
}

// Show toast notification
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Device preview
function changeDevice(device) {
  const iframe = previewIframe;
  switch (device) {
    case 'mobile':
      iframe.style.width = '375px';
      iframe.style.margin = '0 auto';
      iframe.style.boxShadow = '0 0 20px rgba(0,0,0,0.3)';
      break;
    case 'tablet':
      iframe.style.width = '768px';
      iframe.style.margin = '0 auto';
      iframe.style.boxShadow = '0 0 20px rgba(0,0,0,0.3)';
      break;
    default:
      iframe.style.width = '100%';
      iframe.style.margin = '0';
      iframe.style.boxShadow = 'none';
  }
}

// Setup event listeners
function setupEventListeners() {
  // Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });

  // Global link
  document.getElementById('applyGlobalLink').addEventListener('click', applyGlobalLink);

  // Image upload buttons
  document.getElementById('uploadBtn').addEventListener('click', () => {
    document.getElementById('imageUpload').click();
  });
  document.getElementById('modalUploadBtn').addEventListener('click', () => {
    document.getElementById('modalImageUpload').click();
  });

  // Image modal
  document.getElementById('modalCancel').addEventListener('click', closeImageModal);
  document.getElementById('modalApply').addEventListener('click', applyImageChange);
  document.getElementById('imageModal').addEventListener('click', (e) => {
    if (e.target.id === 'imageModal') closeImageModal();
  });

  // Edit mode toggle
  document.getElementById('editModeBtn').addEventListener('click', toggleEditMode);

  // Device select
  document.getElementById('deviceSelect').addEventListener('change', (e) => {
    changeDevice(e.target.value);
  });

  // Save button
  document.getElementById('saveBtn').addEventListener('click', saveChanges);

  // Preview button
  document.getElementById('previewBtn').addEventListener('click', () => {
    window.open(`/clone/${state.cloneId}/index.html`, '_blank');
  });

  // Publish button
  document.getElementById('publishBtn').addEventListener('click', async () => {
    await saveChanges();
    const url = `${window.location.origin}/clone/${state.cloneId}/index.html`;
    prompt('Your page is live at:', url);
  });

  // Settings inputs
  document.getElementById('pageTitle').addEventListener('change', (e) => {
    state.settings.title = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('metaDescription').addEventListener('change', (e) => {
    state.settings.description = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('faviconUrl').addEventListener('change', (e) => {
    state.settings.favicon = e.target.value;
    state.hasChanges = true;
  });

  // Pixel inputs
  document.getElementById('fbPixelEnabled').addEventListener('change', (e) => {
    state.pixels.facebook.enabled = e.target.checked;
    state.hasChanges = true;
  });
  document.getElementById('fbPixelId').addEventListener('change', (e) => {
    state.pixels.facebook.id = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('gaEnabled').addEventListener('change', (e) => {
    state.pixels.google.enabled = e.target.checked;
    state.hasChanges = true;
  });
  document.getElementById('gaId').addEventListener('change', (e) => {
    state.pixels.google.id = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('ttPixelEnabled').addEventListener('change', (e) => {
    state.pixels.tiktok.enabled = e.target.checked;
    state.hasChanges = true;
  });
  document.getElementById('ttPixelId').addEventListener('change', (e) => {
    state.pixels.tiktok.id = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('customHeadCode').addEventListener('change', (e) => {
    state.pixels.customHead = e.target.value;
    state.hasChanges = true;
  });
  document.getElementById('customBodyCode').addEventListener('change', (e) => {
    state.pixels.customBody = e.target.value;
    state.hasChanges = true;
  });

  // Warn before leaving with unsaved changes
  window.addEventListener('beforeunload', (e) => {
    if (state.hasChanges) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}
