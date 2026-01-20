const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { clonePage } = require('./cloner');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// In-memory job storage
const jobs = new Map();

// Middleware
app.use(express.json());
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
