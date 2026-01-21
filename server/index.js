const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { clonePage } = require('./cloner');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory job storage
const jobs = new Map();

// Editor data storage (in-memory, persisted to files)
const editorData = new Map();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve cloned sites
app.use('/clone', express.static(path.join(__dirname, '..', 'output')));

// WebSocket connections per job
const jobConnections = new Map();

// WebSocket handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get('jobId');

  if (jobId) {
    if (!jobConnections.has(jobId)) {
      jobConnections.set(jobId, new Set());
    }
    jobConnections.get(jobId).add(ws);

    ws.on('close', () => {
      const conns = jobConnections.get(jobId);
      if (conns) {
        conns.delete(ws);
        if (conns.size === 0) {
          jobConnections.delete(jobId);
        }
      }
    });

    // Send any buffered logs for this job
    const job = jobs.get(jobId);
    if (job && job.logs) {
      job.logs.forEach(log => {
        ws.send(JSON.stringify(log));
      });
    }
  }
});

// Emit log to all WebSocket connections for a job
function emitToJob(jobId, type, message) {
  const log = { type, message, timestamp: Date.now() };

  // Buffer logs in job
  const job = jobs.get(jobId);
  if (job) {
    job.logs.push(log);
  }

  // Send to all connected clients
  const conns = jobConnections.get(jobId);
  if (conns) {
    const data = JSON.stringify(log);
    conns.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }
}

// API Routes

// Start a clone job
app.post('/api/clone', async (req, res) => {
  const { url, headless = true } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  // Generate job ID
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Initialize job
  jobs.set(jobId, {
    id: jobId,
    url,
    status: 'running',
    logs: [],
    result: null,
    error: null,
    createdAt: Date.now(),
  });

  // Return immediately with job ID
  res.json({ jobId });

  // Run clone in background
  const emit = (type, message) => emitToJob(jobId, type, message);

  try {
    const result = await clonePage(url, emit, { headless });

    const job = jobs.get(jobId);
    if (job) {
      job.status = 'completed';
      job.result = result;
      emit('complete', JSON.stringify(result));
    }
  } catch (error) {
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'failed';
      job.error = error.message;
      emit('error', error.message);
    }
  }
});

// Get job status
app.get('/api/jobs/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({
    id: job.id,
    url: job.url,
    status: job.status,
    result: job.result,
    error: job.error,
  });
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const jobList = Array.from(jobs.values()).map(job => ({
    id: job.id,
    url: job.url,
    status: job.status,
    createdAt: job.createdAt,
  }));
  res.json(jobList);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ============================================
// EDITOR API ENDPOINTS
// ============================================

// List all clones available for editing
app.get('/api/clones', async (req, res) => {
  try {
    const outputDir = path.join(__dirname, '..', 'output');
    const folders = await fs.readdir(outputDir);

    const clones = [];
    for (const folder of folders) {
      const folderPath = path.join(outputDir, folder);
      const stat = await fs.stat(folderPath);
      if (stat.isDirectory()) {
        const indexPath = path.join(folderPath, 'index.html');
        const hasIndex = fsSync.existsSync(indexPath);
        if (hasIndex) {
          clones.push({
            id: folder,
            createdAt: stat.mtime,
            previewUrl: `/clone/${folder}/index-static.html`,
            editUrl: `/editor.html?id=${folder}`
          });
        }
      }
    }

    // Sort by newest first
    clones.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(clones);
  } catch (error) {
    res.json([]);
  }
});

// Get editor data for a clone
app.get('/api/editor/:cloneId', async (req, res) => {
  const { cloneId } = req.params;

  try {
    const editorFile = path.join(__dirname, '..', 'output', cloneId, 'editor-data.json');
    if (fsSync.existsSync(editorFile)) {
      const data = await fs.readFile(editorFile, 'utf-8');
      res.json(JSON.parse(data));
    } else {
      res.json({});
    }
  } catch (error) {
    res.json({});
  }
});

// Save editor changes
app.post('/api/editor/save', async (req, res) => {
  const { cloneId, html, pixels, settings, links, images } = req.body;

  if (!cloneId) {
    return res.status(400).json({ error: 'Clone ID is required' });
  }

  try {
    const cloneDir = path.join(__dirname, '..', 'output', cloneId);

    // Check if clone exists
    if (!fsSync.existsSync(cloneDir)) {
      return res.status(404).json({ error: 'Clone not found' });
    }

    // Save the HTML to the static version (which the editor uses)
    if (html) {
      const indexPath = path.join(cloneDir, 'index-static.html');
      await fs.writeFile(indexPath, html, 'utf-8');
    }

    // Save editor metadata
    const editorDataPath = path.join(cloneDir, 'editor-data.json');
    const editorMeta = {
      pixels: pixels || {},
      settings: settings || {},
      links: links || [],
      images: images || [],
      lastModified: Date.now()
    };
    await fs.writeFile(editorDataPath, JSON.stringify(editorMeta, null, 2), 'utf-8');

    res.json({ success: true, message: 'Saved successfully' });
  } catch (error) {
    console.error('Error saving:', error);
    res.status(500).json({ error: 'Failed to save changes' });
  }
});

// Upload image for a clone
app.post('/api/editor/upload-image', async (req, res) => {
  const { cloneId, imageData, filename } = req.body;

  if (!cloneId || !imageData) {
    return res.status(400).json({ error: 'Clone ID and image data are required' });
  }

  try {
    const cloneDir = path.join(__dirname, '..', 'output', cloneId);
    const assetsDir = path.join(cloneDir, 'assets', 'images');

    // Ensure assets directory exists
    await fs.mkdir(assetsDir, { recursive: true });

    // Parse base64 image
    const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid image data' });
    }

    const ext = matches[1];
    const data = matches[2];
    const buffer = Buffer.from(data, 'base64');

    // Generate filename
    const finalFilename = filename || `upload_${Date.now()}.${ext}`;
    const filePath = path.join(assetsDir, finalFilename);

    await fs.writeFile(filePath, buffer);

    const url = `assets/images/${finalFilename}`;
    res.json({ success: true, url, fullUrl: `/clone/${cloneId}/${url}` });
  } catch (error) {
    console.error('Error uploading image:', error);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

// Duplicate a clone for editing
app.post('/api/editor/duplicate', async (req, res) => {
  const { cloneId, newName } = req.body;

  if (!cloneId) {
    return res.status(400).json({ error: 'Clone ID is required' });
  }

  try {
    const sourceDir = path.join(__dirname, '..', 'output', cloneId);
    const newId = newName || `${cloneId}_copy_${Date.now()}`;
    const destDir = path.join(__dirname, '..', 'output', newId);

    // Copy directory recursively
    await copyDir(sourceDir, destDir);

    res.json({ success: true, newCloneId: newId });
  } catch (error) {
    console.error('Error duplicating:', error);
    res.status(500).json({ error: 'Failed to duplicate clone' });
  }
});

// Helper function to copy directory recursively
async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// ============================================
// END EDITOR API ENDPOINTS
// ============================================

// Catch-all for SPA (serve index.html for unmatched routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   ██╗    ██╗ ██████╗ ███╗   ██╗██╗  ██╗ █████╗               ║
║   ██║    ██║██╔═══██╗████╗  ██║██║ ██╔╝██╔══██╗              ║
║   ██║ █╗ ██║██║   ██║██╔██╗ ██║█████╔╝ ███████║              ║
║   ██║███╗██║██║   ██║██║╚██╗██║██╔═██╗ ██╔══██║              ║
║   ╚███╔███╔╝╚██████╔╝██║ ╚████║██║  ██╗██║  ██║              ║
║    ╚══╝╚══╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝              ║
║                                                               ║
║   ═══════════════════════════════════════════════════════    ║
║   W E B S I T E   C L O N E R   F A C T O R Y                ║
║   ═══════════════════════════════════════════════════════    ║
║                                                               ║
║   Server running at: http://localhost:${PORT}                   ║
║   Ready to clone some websites!                               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server };
