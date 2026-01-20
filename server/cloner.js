const { chromium } = require('playwright');
const { parse: parseHtml } = require('node-html-parser');
const fs = require('fs').promises;
const path = require('path');
const {
  hashUrl,
  safeFolderName,
  normalizeUrl,
  getExtension,
  getAssetType,
  isDataUrl,
  resolveUrl,
  parseSrcset,
  extractCssUrls,
} = require('./utils');

/**
 * Main cloning pipeline
 * @param {string} url - URL to clone
 * @param {function} emit - Function to emit log events
 * @param {object} options - Options (headless, etc)
 */
async function clonePage(url, emit, options = {}) {
  const { headless = true } = options;
  let browser = null;

  try {
    // Step 1: Validate and normalize URL
    emit('pipeline', 'Validating URL...');
    const normalizedUrl = normalizeUrl(url);
    emit('pipeline', `Normalized URL: ${normalizedUrl}`);

    // Create output folder
    const folderName = safeFolderName(normalizedUrl);
    const outputDir = path.join(process.cwd(), 'output', folderName);
    const assetsDir = path.join(outputDir, 'assets');
    await fs.mkdir(assetsDir, { recursive: true });
    emit('pipeline', `Output folder: ${folderName}`);

    // Step 2: Launch browser
    emit('step', 'launch');
    emit('pipeline', 'Launching Chromium browser...');
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Track network requests for asset collection
    const networkRequests = new Map();

    // Step 3: Attach listeners
    page.on('console', msg => {
      emit('console', `[${msg.type()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
      emit('console', `[error] ${err.message}`);
    });

    page.on('request', request => {
      const resourceType = request.resourceType();
      emit('network', `[REQ] ${resourceType}: ${request.url().slice(0, 100)}...`);
    });

    page.on('response', async response => {
      const request = response.request();
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || '';

      emit('network', `[RES] ${status} ${request.resourceType()}: ${url.slice(0, 80)}...`);

      // Store for asset downloading
      networkRequests.set(url, {
        contentType,
        status,
        resourceType: request.resourceType(),
      });
    });

    // Step 4: Navigate
    emit('step', 'navigate');
    emit('pipeline', `Navigating to ${normalizedUrl}...`);
    await page.goto(normalizedUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });

    // Wait a bit for initial hydration
    emit('pipeline', 'Waiting for initial hydration...');
    await page.waitForTimeout(2000);

    // Step 5: Auto-scroll to trigger lazy loading
    emit('step', 'scroll');
    emit('pipeline', 'Auto-scrolling to load lazy content...');
    await autoScroll(page, emit);

    // Wait for network to settle
    emit('pipeline', 'Waiting for network idle...');
    try {
      await page.waitForLoadState('networkidle', { timeout: 10000 });
    } catch {
      emit('pipeline', 'Network idle timeout - proceeding anyway');
    }

    // Final wait for any late content
    await page.waitForTimeout(1000);

    // Step 6: Snapshot DOM
    emit('step', 'snapshot');
    emit('pipeline', 'Capturing rendered HTML...');
    let html = await page.content();
    const finalUrl = page.url(); // In case of redirects

    // Close browser early to free resources
    await browser.close();
    browser = null;
    emit('pipeline', 'Browser closed');

    // Step 7: Parse HTML and collect assets
    emit('step', 'download');
    emit('pipeline', 'Parsing HTML and collecting asset URLs...');
    const root = parseHtml(html, { comment: true });

    const assetUrls = new Map(); // url -> local path mapping

    // Collect image sources
    root.querySelectorAll('img[src]').forEach(el => {
      const src = el.getAttribute('src');
      if (src && !isDataUrl(src)) {
        assetUrls.set(resolveUrl(finalUrl, src), null);
      }
    });

    // Collect srcset
    root.querySelectorAll('[srcset]').forEach(el => {
      const srcset = el.getAttribute('srcset');
      parseSrcset(srcset).forEach(url => {
        assetUrls.set(resolveUrl(finalUrl, url), null);
      });
    });

    // Collect stylesheets
    root.querySelectorAll('link[rel="stylesheet"][href]').forEach(el => {
      const href = el.getAttribute('href');
      if (href && !isDataUrl(href)) {
        assetUrls.set(resolveUrl(finalUrl, href), null);
      }
    });

    // Collect scripts
    root.querySelectorAll('script[src]').forEach(el => {
      const src = el.getAttribute('src');
      if (src && !isDataUrl(src)) {
        assetUrls.set(resolveUrl(finalUrl, src), null);
      }
    });

    // Collect video/audio
    root.querySelectorAll('video[src], audio[src], source[src]').forEach(el => {
      const src = el.getAttribute('src');
      if (src && !isDataUrl(src)) {
        assetUrls.set(resolveUrl(finalUrl, src), null);
      }
    });

    // Collect favicon and other link resources
    root.querySelectorAll('link[href]').forEach(el => {
      const href = el.getAttribute('href');
      const rel = el.getAttribute('rel') || '';
      if (href && !isDataUrl(href) && (rel.includes('icon') || rel.includes('apple-touch'))) {
        assetUrls.set(resolveUrl(finalUrl, href), null);
      }
    });

    // Collect background images from inline styles
    root.querySelectorAll('[style]').forEach(el => {
      const style = el.getAttribute('style');
      if (style) {
        extractCssUrls(style).forEach(url => {
          assetUrls.set(resolveUrl(finalUrl, url), null);
        });
      }
    });

    emit('pipeline', `Found ${assetUrls.size} assets to download`);

    // Step 8: Download assets
    const cssFiles = [];
    let downloaded = 0;
    let failed = 0;

    for (const [assetUrl] of assetUrls) {
      try {
        const result = await downloadAsset(assetUrl, assetsDir, networkRequests.get(assetUrl), emit);
        if (result) {
          assetUrls.set(assetUrl, result.localPath);
          if (result.contentType && result.contentType.includes('css')) {
            cssFiles.push({ url: assetUrl, localPath: result.fullPath });
          }
          downloaded++;
        } else {
          failed++;
        }
      } catch (err) {
        emit('pipeline', `Failed to download: ${assetUrl.slice(0, 60)}... - ${err.message}`);
        failed++;
      }
    }

    emit('pipeline', `Downloaded ${downloaded} assets, ${failed} failed`);

    // Step 9: Process CSS files for font URLs
    emit('pipeline', 'Processing CSS files for additional assets...');
    for (const cssFile of cssFiles) {
      try {
        const cssContent = await fs.readFile(cssFile.fullPath, 'utf-8');
        const cssUrls = extractCssUrls(cssContent);
        let updatedCss = cssContent;

        for (const cssUrl of cssUrls) {
          const absoluteUrl = resolveUrl(cssFile.url, cssUrl);
          if (!assetUrls.has(absoluteUrl) && !isDataUrl(cssUrl)) {
            try {
              const result = await downloadAsset(absoluteUrl, assetsDir, null, emit);
              if (result) {
                assetUrls.set(absoluteUrl, result.localPath);
                // Update CSS to use relative path
                const relativePath = path.relative(path.dirname(cssFile.localPath), result.localPath);
                updatedCss = updatedCss.split(cssUrl).join(relativePath.replace(/\\/g, '/'));
              }
            } catch {}
          } else if (assetUrls.has(absoluteUrl)) {
            // Rewrite existing asset reference
            const localPath = assetUrls.get(absoluteUrl);
            if (localPath) {
              const relativePath = path.relative(
                path.dirname(cssFile.fullPath),
                path.join(outputDir, localPath)
              );
              updatedCss = updatedCss.split(cssUrl).join(relativePath.replace(/\\/g, '/'));
            }
          }
        }

        await fs.writeFile(cssFile.fullPath, updatedCss);
      } catch (err) {
        emit('pipeline', `Error processing CSS ${cssFile.url}: ${err.message}`);
      }
    }

    // Step 10: Rewrite HTML references
    emit('step', 'rewrite');
    emit('pipeline', 'Rewriting asset references in HTML...');

    for (const [originalUrl, localPath] of assetUrls) {
      if (localPath) {
        // Replace absolute URLs
        html = html.split(originalUrl).join(localPath);

        // Also try to replace relative versions
        try {
          const parsed = new URL(originalUrl);
          const relativePath = parsed.pathname + parsed.search;
          if (relativePath !== localPath) {
            html = html.split(`"${relativePath}"`).join(`"${localPath}"`);
            html = html.split(`'${relativePath}'`).join(`'${localPath}'`);
          }
        } catch {}
      }
    }

    // Step 11: Save output
    emit('step', 'save');
    emit('pipeline', 'Saving cloned page...');
    const outputHtml = path.join(outputDir, 'index.html');
    await fs.writeFile(outputHtml, html, 'utf-8');

    emit('pipeline', `Clone saved to: ${outputDir}`);
    emit('step', 'done');

    return {
      success: true,
      folderName,
      outputPath: outputDir,
      openUrl: `/clone/${folderName}/index.html`,
      assetsDownloaded: downloaded,
      assetsFailed: failed,
    };
  } catch (error) {
    emit('pipeline', `Error: ${error.message}`);
    emit('step', 'error');
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Auto-scroll the page to trigger lazy loading
 */
async function autoScroll(page, emit) {
  let previousHeight = 0;
  let currentHeight = await page.evaluate(() => document.body.scrollHeight);
  let iterations = 0;
  const maxIterations = 30;

  while (previousHeight !== currentHeight && iterations < maxIterations) {
    previousHeight = currentHeight;

    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight);
    });

    await page.waitForTimeout(300);

    currentHeight = await page.evaluate(() => document.body.scrollHeight);
    iterations++;

    if (iterations % 5 === 0) {
      emit('pipeline', `Scrolling... (iteration ${iterations}, height: ${currentHeight}px)`);
    }
  }

  // Scroll back to top
  await page.evaluate(() => window.scrollTo(0, 0));
  emit('pipeline', `Scroll complete after ${iterations} iterations (final height: ${currentHeight}px)`);
}

/**
 * Download a single asset
 */
async function downloadAsset(url, assetsDir, networkInfo, emit) {
  if (isDataUrl(url)) return null;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || networkInfo?.contentType || '';
    const ext = getExtension(url, contentType) || '';
    const assetType = getAssetType(url, contentType);
    const hash = hashUrl(url);
    const filename = hash + ext;

    const typeDir = path.join(assetsDir, assetType);
    await fs.mkdir(typeDir, { recursive: true });

    const fullPath = path.join(typeDir, filename);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(fullPath, buffer);

    const localPath = `assets/${assetType}/${filename}`;
    return { localPath, fullPath, contentType };
  } catch (error) {
    return null;
  }
}

module.exports = { clonePage };
