// Set Playwright browser path FIRST - before any requires
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH || '/ms-playwright';
console.log('PLAYWRIGHT_BROWSERS_PATH set to:', process.env.PLAYWRIGHT_BROWSERS_PATH);

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const archiver = require('archiver');

// Sharp is optional - used for image optimization
let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  console.warn('Sharp not available - image optimization disabled');
}

// html-minifier-terser is optional - used for HTML minification
let minifyHtml = null;
try {
  minifyHtml = require('html-minifier-terser').minify;
} catch (e) {
  console.warn('html-minifier-terser not available - HTML minification disabled');
}
const { clonePage } = require('./cloner');

// ============================================
// METADATA HELPERS
// ============================================
const METADATA_FILE = path.join(__dirname, '..', 'output', 'clone-metadata.json');

async function readMetadata() {
  try {
    const data = await fs.readFile(METADATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    // Return default structure if file doesn't exist
    return { folders: [], clones: {} };
  }
}

async function writeMetadata(metadata) {
  await fs.writeFile(METADATA_FILE, JSON.stringify(metadata, null, 2), 'utf-8');
}

// ============================================
// OPTIMIZATION HELPERS
// ============================================

/**
 * Optimize an image file - convert to WebP and compress
 * @param {string} inputPath - Path to source image
 * @param {string} outputPath - Path to save optimized image
 * @param {object} options - Optimization options
 */
async function optimizeImage(inputPath, outputPath, options = {}) {
  const { quality = 80, maxWidth = 1920, maxHeight = 1080 } = options;

  // If sharp is not available, just copy the file
  if (!sharp) {
    await fs.copyFile(inputPath, outputPath);
    return { optimized: false, reason: 'sharp not available' };
  }

  try {
    const ext = path.extname(inputPath).toLowerCase();

    // Skip if not an image we can process
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.avif'];
    if (!supportedFormats.includes(ext)) {
      // Just copy the file as-is
      await fs.copyFile(inputPath, outputPath);
      return { optimized: false, reason: 'unsupported format' };
    }

    // Get image metadata
    const metadata = await sharp(inputPath).metadata();

    // Skip if already small or SVG
    if (ext === '.svg') {
      await fs.copyFile(inputPath, outputPath);
      return { optimized: false, reason: 'svg' };
    }

    // Create WebP output path
    const webpOutputPath = outputPath.replace(/\.[^.]+$/, '.webp');

    // Process with sharp
    let pipeline = sharp(inputPath);

    // Resize if larger than max dimensions
    if (metadata.width > maxWidth || metadata.height > maxHeight) {
      pipeline = pipeline.resize(maxWidth, maxHeight, {
        fit: 'inside',
        withoutEnlargement: true
      });
    }

    // Convert to WebP with compression
    await pipeline
      .webp({ quality, effort: 6 })
      .toFile(webpOutputPath);

    // Get file sizes for comparison
    const originalSize = (await fs.stat(inputPath)).size;
    const optimizedSize = (await fs.stat(webpOutputPath)).size;

    return {
      optimized: true,
      originalPath: inputPath,
      optimizedPath: webpOutputPath,
      originalSize,
      optimizedSize,
      savings: Math.round((1 - optimizedSize / originalSize) * 100)
    };
  } catch (error) {
    // If optimization fails, just copy the original
    await fs.copyFile(inputPath, outputPath);
    return { optimized: false, reason: error.message };
  }
}

/**
 * Minify HTML content
 * @param {string} html - HTML content to minify
 */
async function optimizeHtml(html) {
  // If minifier not available, return original
  if (!minifyHtml) {
    return html;
  }
  try {
    return await minifyHtml(html, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      useShortDoctype: true,
      minifyCSS: true,
      minifyJS: true
    });
  } catch (error) {
    console.error('HTML minification error:', error.message);
    return html; // Return original if minification fails
  }
}

/**
 * Create an optimized copy of a clone directory
 * @param {string} sourceDir - Source clone directory
 * @param {string} destDir - Destination for optimized copy
 * @param {object} options - Optimization options
 */
async function createOptimizedCopy(sourceDir, destDir, options = {}) {
  const { optimizeImages = true, minifyHtml: shouldMinifyHtml = true, quality = 80 } = options;

  await fs.mkdir(destDir, { recursive: true });

  const stats = {
    imagesOptimized: 0,
    imagesSaved: 0,
    htmlMinified: false
  };

  // Process all files recursively
  async function processDir(srcPath, dstPath) {
    await fs.mkdir(dstPath, { recursive: true });
    const entries = await fs.readdir(srcPath, { withFileTypes: true });

    for (const entry of entries) {
      const srcFile = path.join(srcPath, entry.name);
      const dstFile = path.join(dstPath, entry.name);

      if (entry.isDirectory()) {
        await processDir(srcFile, dstFile);
      } else {
        const ext = path.extname(entry.name).toLowerCase();

        // Handle images
        if (optimizeImages && ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff'].includes(ext)) {
          const result = await optimizeImage(srcFile, dstFile, { quality });
          if (result.optimized) {
            stats.imagesOptimized++;
            stats.imagesSaved += result.originalSize - result.optimizedSize;
          }
        }
        // Handle HTML
        else if (shouldMinifyHtml && ext === '.html') {
          const content = await fs.readFile(srcFile, 'utf-8');

          // Update image references to use .webp if we optimized images
          let optimizedContent = content;
          if (optimizeImages) {
            // Replace image extensions in HTML with .webp
            optimizedContent = optimizedContent.replace(
              /(\ssrc=["'][^"']*)\.(jpg|jpeg|png|gif|tiff)(["'])/gi,
              '$1.webp$3'
            );
            optimizedContent = optimizedContent.replace(
              /(\ssrcset=["'][^"']*)\.(jpg|jpeg|png|gif|tiff)([\s,])/gi,
              '$1.webp$3'
            );
          }

          const minified = await optimizeHtml(optimizedContent);
          await fs.writeFile(dstFile, minified, 'utf-8');
          stats.htmlMinified = true;
        }
        // Copy other files as-is
        else {
          await fs.copyFile(srcFile, dstFile);
        }
      }
    }
  }

  await processDir(sourceDir, destDir);
  return stats;
}

function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

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
    const metadata = await readMetadata();
    const { folderId } = req.query; // Optional filter by folder

    const clones = [];
    for (const folder of folders) {
      // Skip metadata file
      if (folder === 'clone-metadata.json') continue;

      const folderPath = path.join(outputDir, folder);
      const stat = await fs.stat(folderPath);
      if (stat.isDirectory()) {
        const indexPath = path.join(folderPath, 'index.html');
        const hasIndex = fsSync.existsSync(indexPath);
        if (hasIndex) {
          const cloneMeta = metadata.clones[folder] || {};
          const clone = {
            id: folder,
            name: cloneMeta.name || folder,
            folderId: cloneMeta.folderId || null,
            createdAt: cloneMeta.createdAt || stat.mtime,
            previewUrl: `/clone/${folder}/index-static.html`,
            editUrl: `/editor.html?id=${folder}`
          };

          // Filter by folder if specified
          if (!folderId || folderId === 'all' || clone.folderId === folderId) {
            clones.push(clone);
          }
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
// FOLDER API ENDPOINTS
// ============================================

// List all folders
app.get('/api/folders', async (req, res) => {
  try {
    const metadata = await readMetadata();
    res.json(metadata.folders || []);
  } catch (error) {
    res.json([]);
  }
});

// Create folder
app.post('/api/folders', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    const metadata = await readMetadata();
    const folder = {
      id: generateId('folder'),
      name,
      createdAt: Date.now()
    };
    metadata.folders.push(folder);
    await writeMetadata(metadata);
    res.json(folder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// Rename folder
app.put('/api/folders/:id', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Folder name is required' });
  }

  try {
    const metadata = await readMetadata();
    const folder = metadata.folders.find(f => f.id === id);
    if (!folder) {
      return res.status(404).json({ error: 'Folder not found' });
    }
    folder.name = name;
    await writeMetadata(metadata);
    res.json(folder);
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename folder' });
  }
});

// Delete folder (moves clones to root)
app.delete('/api/folders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const metadata = await readMetadata();
    const folderIndex = metadata.folders.findIndex(f => f.id === id);
    if (folderIndex === -1) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    // Move clones in this folder to root (null folderId)
    for (const cloneId in metadata.clones) {
      if (metadata.clones[cloneId].folderId === id) {
        metadata.clones[cloneId].folderId = null;
      }
    }

    metadata.folders.splice(folderIndex, 1);
    await writeMetadata(metadata);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ============================================
// CLONE MANAGEMENT ENDPOINTS
// ============================================

// Rename clone
app.put('/api/clones/:id/rename', async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  try {
    const cloneDir = path.join(__dirname, '..', 'output', id);
    if (!fsSync.existsSync(cloneDir)) {
      return res.status(404).json({ error: 'Clone not found' });
    }

    const metadata = await readMetadata();
    if (!metadata.clones[id]) {
      metadata.clones[id] = { createdAt: Date.now() };
    }
    metadata.clones[id].name = name;
    await writeMetadata(metadata);

    res.json({ success: true, name });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename clone' });
  }
});

// Move clone to folder
app.put('/api/clones/:id/move', async (req, res) => {
  const { id } = req.params;
  const { folderId } = req.body; // null for root

  try {
    const cloneDir = path.join(__dirname, '..', 'output', id);
    if (!fsSync.existsSync(cloneDir)) {
      return res.status(404).json({ error: 'Clone not found' });
    }

    const metadata = await readMetadata();

    // Verify folder exists if folderId is provided
    if (folderId && !metadata.folders.find(f => f.id === folderId)) {
      return res.status(404).json({ error: 'Folder not found' });
    }

    if (!metadata.clones[id]) {
      metadata.clones[id] = { createdAt: Date.now() };
    }
    metadata.clones[id].folderId = folderId || null;
    await writeMetadata(metadata);

    res.json({ success: true, folderId: folderId || null });
  } catch (error) {
    res.status(500).json({ error: 'Failed to move clone' });
  }
});

// Delete clone
app.delete('/api/clones/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const cloneDir = path.join(__dirname, '..', 'output', id);
    if (!fsSync.existsSync(cloneDir)) {
      return res.status(404).json({ error: 'Clone not found' });
    }

    // Delete directory recursively
    await fs.rm(cloneDir, { recursive: true, force: true });

    // Remove from metadata
    const metadata = await readMetadata();
    delete metadata.clones[id];
    await writeMetadata(metadata);

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting clone:', error);
    res.status(500).json({ error: 'Failed to delete clone' });
  }
});

// Download clone (ZIP or HTML) with optional optimization
app.get('/api/clones/:id/download', async (req, res) => {
  const { id } = req.params;
  const { format, optimize } = req.query; // format: 'zip' or 'html', optimize: 'true' for optimization

  try {
    const cloneDir = path.join(__dirname, '..', 'output', id);
    if (!fsSync.existsSync(cloneDir)) {
      return res.status(404).json({ error: 'Clone not found' });
    }

    const metadata = await readMetadata();
    const cloneName = metadata.clones[id]?.name || id;
    const safeName = cloneName.replace(/[^a-z0-9]/gi, '_');
    const shouldOptimize = optimize === 'true';

    // If optimization requested, create optimized copy in temp dir
    let sourceDir = cloneDir;
    let tempDir = null;

    if (shouldOptimize) {
      tempDir = path.join(__dirname, '..', 'output', '.temp', `${id}_optimized_${Date.now()}`);
      console.log(`Creating optimized copy at: ${tempDir}`);

      const stats = await createOptimizedCopy(cloneDir, tempDir, {
        optimizeImages: true,
        minifyHtml: true,
        quality: 80
      });

      console.log(`Optimization stats:`, stats);
      sourceDir = tempDir;
    }

    if (format === 'html') {
      // Download just the HTML file
      const htmlPath = path.join(sourceDir, 'index-static.html');
      if (!fsSync.existsSync(htmlPath)) {
        // Cleanup temp dir if it exists
        if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        return res.status(404).json({ error: 'HTML file not found' });
      }

      // Read and potentially minify the HTML
      let htmlContent = await fs.readFile(htmlPath, 'utf-8');
      if (shouldOptimize && !tempDir) {
        // If optimize but no temp dir (shouldn't happen), still minify
        htmlContent = await optimizeHtml(htmlContent);
      }

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}${shouldOptimize ? '_optimized' : ''}.html"`);
      res.send(htmlContent);

      // Cleanup temp dir if it exists
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    } else {
      // Download as ZIP
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}${shouldOptimize ? '_optimized' : ''}.zip"`);

      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', (err) => {
        throw err;
      });

      // Cleanup temp dir after archive is finalized
      archive.on('end', async () => {
        if (tempDir) {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      });

      archive.pipe(res);

      // Add source directory to ZIP
      archive.directory(sourceDir, safeName);
      await archive.finalize();
    }
  } catch (error) {
    console.error('Error downloading clone:', error);
    res.status(500).json({ error: 'Failed to download clone' });
  }
});

// ============================================
// END EDITOR API ENDPOINTS
// ============================================

// Catch-all for SPA (serve index.html for unmatched routes)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start server
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => {
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
