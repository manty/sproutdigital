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
 * Extract actual image URL from Next.js image proxy URLs
 * e.g., /api/proxy-fastimage?source=https%3A%2F%2Fcdn.example.com%2Fimage.jpg
 */
function extractProxyImageUrl(url) {
  try {
    const parsed = new URL(url, 'http://dummy');
    const pathname = parsed.pathname;

    // Check for common Next.js image proxy patterns
    if (pathname.includes('/api/') && pathname.includes('image') ||
        pathname.includes('/_next/image') ||
        pathname.includes('proxy')) {
      // Try to extract source URL from query params
      const source = parsed.searchParams.get('source') ||
                     parsed.searchParams.get('url') ||
                     parsed.searchParams.get('src');
      if (source) {
        return decodeURIComponent(source);
      }
    }
  } catch {}
  return null;
}

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

    // Log browser path for debugging
    const browserPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    emit('pipeline', `Browser path env: ${browserPath || 'not set'}`);

    // Try to find chromium executable
    const possiblePaths = [
      '/ms-playwright/chromium-1200/chrome-linux/chrome',
      '/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell',
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    ].filter(Boolean);

    let executablePath = null;
    const fsSync = require('fs');
    for (const p of possiblePaths) {
      if (fsSync.existsSync(p)) {
        executablePath = p;
        emit('pipeline', `Found browser at: ${p}`);
        break;
      }
    }

    const launchOptions = {
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await chromium.launch(launchOptions);

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
    const proxyUrlMap = new Map(); // proxy url -> real url mapping

    // Helper to add URL with proxy detection
    function addAssetUrl(url) {
      if (!url || isDataUrl(url)) return;
      const resolvedUrl = resolveUrl(finalUrl, url);

      // Check if this is a proxy URL
      const realUrl = extractProxyImageUrl(resolvedUrl);
      if (realUrl) {
        // Store mapping from proxy to real URL
        proxyUrlMap.set(resolvedUrl, realUrl);
        // Download the real URL
        if (!realUrl.startsWith('/')) {
          assetUrls.set(realUrl, null);
        } else {
          assetUrls.set(resolveUrl(finalUrl, realUrl), null);
        }
      } else {
        assetUrls.set(resolvedUrl, null);
      }
    }

    // Collect image sources
    root.querySelectorAll('img[src]').forEach(el => {
      const src = el.getAttribute('src');
      addAssetUrl(src);
    });

    // Collect srcset
    root.querySelectorAll('[srcset]').forEach(el => {
      const srcset = el.getAttribute('srcset');
      parseSrcset(srcset).forEach(url => {
        addAssetUrl(url);
      });
    });

    // Collect imagesrcset (used by Next.js preload)
    root.querySelectorAll('[imagesrcset]').forEach(el => {
      const srcset = el.getAttribute('imagesrcset');
      parseSrcset(srcset).forEach(url => {
        addAssetUrl(url);
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

    // Collect preload fonts and other preloaded resources
    root.querySelectorAll('link[rel="preload"][href]').forEach(el => {
      const href = el.getAttribute('href');
      const as = el.getAttribute('as') || '';
      if (href && !isDataUrl(href) && (as === 'font' || as === 'style' || as === 'script' || as === 'image')) {
        assetUrls.set(resolveUrl(finalUrl, href), null);
      }
    });

    // Collect fonts/images from inline style blocks
    root.querySelectorAll('style').forEach(el => {
      const styleContent = el.textContent || '';
      extractCssUrls(styleContent).forEach(url => {
        assetUrls.set(resolveUrl(finalUrl, url), null);
      });
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
            cssFiles.push({ url: assetUrl, fullPath: result.fullPath, localPath: result.localPath });
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

    // Build a map of all URL variations to local paths
    const urlReplacements = new Map();

    for (const [originalUrl, localPath] of assetUrls) {
      if (localPath) {
        // Add the full absolute URL
        urlReplacements.set(originalUrl, localPath);

        try {
          const parsed = new URL(originalUrl);

          // Add pathname + search
          const pathWithSearch = parsed.pathname + parsed.search;
          urlReplacements.set(pathWithSearch, localPath);

          // Add pathname only (without query string)
          urlReplacements.set(parsed.pathname, localPath);

          // Add protocol-relative URL
          urlReplacements.set('//' + parsed.host + parsed.pathname + parsed.search, localPath);
          urlReplacements.set('//' + parsed.host + parsed.pathname, localPath);

          // Handle CDN URLs - try without query params
          if (parsed.search) {
            urlReplacements.set(parsed.origin + parsed.pathname, localPath);
          }
        } catch {}
      }
    }

    // Also map proxy URLs to the local path of their real images
    for (const [proxyUrl, realUrl] of proxyUrlMap) {
      // Find the local path for the real URL
      let localPath = assetUrls.get(realUrl);
      if (!localPath) {
        // Try resolving the real URL
        localPath = assetUrls.get(resolveUrl(finalUrl, realUrl));
      }
      if (localPath) {
        urlReplacements.set(proxyUrl, localPath);
        // Also add variations of the proxy URL
        try {
          const parsed = new URL(proxyUrl);
          const pathWithSearch = parsed.pathname + parsed.search;
          urlReplacements.set(pathWithSearch, localPath);
          // Add HTML-encoded version (& -> &amp;)
          urlReplacements.set(pathWithSearch.replace(/&/g, '&amp;'), localPath);
        } catch {}
      }
    }

    // Add HTML-encoded versions of all URLs with query strings
    const additionalReplacements = [];
    for (const [url, localPath] of urlReplacements) {
      if (url.includes('&') && !url.includes('&amp;')) {
        additionalReplacements.push([url.replace(/&/g, '&amp;'), localPath]);
      }
    }
    additionalReplacements.forEach(([url, path]) => urlReplacements.set(url, path));

    // Sort replacements by length (longest first) to avoid partial replacements
    const sortedReplacements = [...urlReplacements.entries()].sort((a, b) => b[0].length - a[0].length);

    // Apply all replacements
    for (const [urlVariant, localPath] of sortedReplacements) {
      // Replace in various attribute formats
      html = html.split(`"${urlVariant}"`).join(`"${localPath}"`);
      html = html.split(`'${urlVariant}'`).join(`'${localPath}'`);
      html = html.split(`url(${urlVariant})`).join(`url(${localPath})`);
      html = html.split(`url("${urlVariant}")`).join(`url("${localPath}")`);
      html = html.split(`url('${urlVariant}')`).join(`url('${localPath}')`);
    }

    // Also handle relative URLs that weren't captured
    // Replace any remaining external URLs with local placeholders
    const baseUrl = new URL(finalUrl);

    // Fix relative paths that start with ../  or ./
    html = html.replace(/(?:src|href)="(\.\.?\/[^"]+)"/g, (match, relPath) => {
      const absUrl = resolveUrl(finalUrl, relPath);
      const localPath = assetUrls.get(absUrl);
      if (localPath) {
        return match.replace(relPath, localPath);
      }
      return match;
    });

    html = html.replace(/(?:src|href)='(\.\.?\/[^']+)'/g, (match, relPath) => {
      const absUrl = resolveUrl(finalUrl, relPath);
      const localPath = assetUrls.get(absUrl);
      if (localPath) {
        return match.replace(relPath, localPath);
      }
      return match;
    });

    // Fix relative paths in url() CSS patterns
    html = html.replace(/url\(['"]?(\.\.?\/[^'")]+)['"]?\)/g, (match, relPath) => {
      const absUrl = resolveUrl(finalUrl, relPath);
      const localPath = assetUrls.get(absUrl);
      if (localPath) {
        return `url('${localPath}')`;
      }
      return match;
    });

    // Rewrite srcset and imagesrcset attributes containing proxy URLs
    html = html.replace(/(srcset|imagesrcset)="([^"]+)"/gi, (match, attr, srcsetValue) => {
      // Check if this srcset contains proxy URLs
      if (!srcsetValue.includes('/api/') && !srcsetValue.includes('proxy')) {
        return match;
      }

      // Extract the first proxy URL and find its source image
      const proxyMatch = srcsetValue.match(/\/api\/[^?\s]+\?[^\s,]+/);
      if (proxyMatch) {
        const proxyUrl = proxyMatch[0].replace(/&amp;/g, '&');
        const realUrl = extractProxyImageUrl('http://dummy' + proxyUrl);
        if (realUrl) {
          // Find local path for this image
          let localPath = assetUrls.get(realUrl);
          if (!localPath && !realUrl.startsWith('http')) {
            localPath = assetUrls.get(resolveUrl(finalUrl, realUrl));
          }
          if (localPath) {
            // Replace entire srcset with just the local path
            return `${attr}="${localPath}"`;
          }
        }
      }
      return match;
    });

    // Step 11: Save output
    emit('step', 'save');
    emit('pipeline', 'Saving cloned page...');
    const outputHtml = path.join(outputDir, 'index.html');
    await fs.writeFile(outputHtml, html, 'utf-8');

    // Also create a static version with ALL scripts stripped (for preview without JS errors)
    let staticHtml = html
      // Remove ALL script tags
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<script\b[^>]*\/>/gi, '')
      // Remove noscript tags but keep content (show it since we're removing scripts)
      .replace(/<noscript>([\s\S]*?)<\/noscript>/gi, '$1');

    // Inject comprehensive interactivity script for static clones
    const menuToggleScript = `
<script data-cloner-ui="menu-toggle">
(function() {
  // =============================================
  // PART 1: CSS CHECKBOX DRAWER (cart sidebar)
  // =============================================

  const drawerCheckbox = document.querySelector('#Drawer__checkbox, [class*="drawer"] input[type="checkbox"]');
  const drawerNav = document.querySelector('nav.Drawer__container, nav[class*="Drawer"]');

  if (drawerCheckbox && drawerNav) {
    const originalTransform = drawerNav.style.transform || 'translate3d(100%, 0px, 0px)';

    // Find cart buttons (usually have cart icon SVG)
    const cartButtons = document.querySelectorAll(
      'button[class*="cursor-pointer"]:has(svg), ' +
      '[class*="cart-btn"], [class*="cart-icon"]'
    );

    const toggleDrawer = () => {
      drawerCheckbox.checked = !drawerCheckbox.checked;
      drawerNav.style.transform = drawerCheckbox.checked ? 'translate3d(0, 0, 0)' : originalTransform;
      const overlay = document.querySelector('.Drawer__overlay');
      if (overlay) {
        overlay.style.display = drawerCheckbox.checked ? 'block' : 'none';
        overlay.style.opacity = drawerCheckbox.checked ? '1' : '0';
      }
    };

    // Wire up cart buttons (filter to only those in header area)
    cartButtons.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      if (rect.top < 100) { // Only header buttons
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleDrawer(); });
      }
    });

    // Close button inside drawer
    const closeBtn = drawerNav.querySelector('button:has(svg)');
    if (closeBtn) {
      closeBtn.style.cursor = 'pointer';
      closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (drawerCheckbox.checked) toggleDrawer(); });
    }

    // Overlay click to close
    const overlay = document.querySelector('.Drawer__overlay');
    if (overlay) {
      overlay.style.cursor = 'pointer';
      overlay.addEventListener('click', () => { if (drawerCheckbox.checked) toggleDrawer(); });
    }
  }

  // =============================================
  // PART 2: PRODUCT BUNDLE OPTIONS (Get 1/2/3)
  // =============================================

  const bundleButtons = Array.from(document.querySelectorAll('button')).filter(b =>
    b.textContent?.includes('Get') && (b.textContent?.includes('AirFlow') || b.textContent?.includes('Strap') || b.textContent?.includes('SAVE'))
  );

  if (bundleButtons.length > 0) {
    // Add visual selection state
    const selectBundle = (selectedBtn) => {
      bundleButtons.forEach(btn => {
        if (btn === selectedBtn) {
          btn.style.border = '2px solid #10b981';
          btn.style.background = 'rgba(16, 185, 129, 0.1)';
          btn.setAttribute('data-selected', 'true');
        } else {
          btn.style.border = '';
          btn.style.background = '';
          btn.removeAttribute('data-selected');
        }
      });
    };

    // Select first bundle by default
    if (bundleButtons[0]) selectBundle(bundleButtons[0]);

    bundleButtons.forEach(btn => {
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        selectBundle(btn);
      });
    });
  }

  // =============================================
  // PART 3: ADD TO CART BUTTONS
  // =============================================

  const addToCartBtns = Array.from(document.querySelectorAll('button')).filter(b =>
    b.textContent?.toLowerCase().includes('add to cart')
  );

  addToCartBtns.forEach(btn => {
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      // Open cart drawer if it exists
      if (drawerCheckbox && !drawerCheckbox.checked) {
        drawerCheckbox.checked = true;
        if (drawerNav) drawerNav.style.transform = 'translate3d(0, 0, 0)';
        const overlay = document.querySelector('.Drawer__overlay');
        if (overlay) { overlay.style.display = 'block'; overlay.style.opacity = '1'; }
      }
      // Show feedback
      const originalText = btn.textContent;
      btn.textContent = 'Added!';
      btn.style.background = '#10b981';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 1500);
    });
  });

  // =============================================
  // PART 4: QUANTITY +/- BUTTONS (using aria-label)
  // =============================================

  // Find all minus/plus button pairs by aria-label
  const minusBtns = document.querySelectorAll('button[aria-label="minusButton"]');
  const plusBtns = document.querySelectorAll('button[aria-label="plusButton"]');

  // Process each pair
  minusBtns.forEach((minusBtn, index) => {
    const plusBtn = plusBtns[index];
    if (!plusBtn) return;

    // Find the quantity display between the buttons (usually a span or div with just a number)
    const parent = minusBtn.parentElement;
    const display = parent?.querySelector('span, div:not(button)');
    let qty = parseInt(display?.textContent || '1') || 1;

    // Remove disabled attribute so buttons work
    minusBtn.removeAttribute('disabled');
    plusBtn.removeAttribute('disabled');
    minusBtn.style.cursor = 'pointer';
    plusBtn.style.cursor = 'pointer';
    minusBtn.style.opacity = '1';
    plusBtn.style.opacity = '1';

    minusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (qty > 1) {
        qty--;
        if (display) display.textContent = qty;
      }
    });

    plusBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      qty++;
      if (display) display.textContent = qty;
    });
  });

  // =============================================
  // PART 5: IMAGE CAROUSEL/THUMBNAILS
  // =============================================

  const mainImage = document.querySelector('[class*="main-image"], [class*="product-image"] img, [class*="gallery"] img:first-of-type');
  const thumbnails = document.querySelectorAll('[class*="thumbnail"] img, [class*="gallery"] img');

  if (mainImage && thumbnails.length > 1) {
    thumbnails.forEach(thumb => {
      thumb.style.cursor = 'pointer';
      thumb.addEventListener('click', () => {
        mainImage.src = thumb.src;
        thumbnails.forEach(t => t.style.opacity = t === thumb ? '1' : '0.5');
      });
    });
  }

  // Carousel arrows
  const carouselArrows = document.querySelectorAll('button[class*="absolute"]');
  carouselArrows.forEach(arrow => {
    const rect = arrow.getBoundingClientRect();
    if (rect.width < 60 && rect.height < 60) {
      arrow.style.cursor = 'pointer';
    }
  });

  // =============================================
  // PART 6: COMBOBOX STATE TOGGLE (visual only)
  // =============================================

  document.querySelectorAll('[role="combobox"]').forEach(combobox => {
    combobox.style.cursor = 'pointer';
    combobox.addEventListener('click', () => {
      const currentState = combobox.getAttribute('data-state');
      const newState = currentState === 'open' ? 'closed' : 'open';
      combobox.setAttribute('data-state', newState);
      combobox.setAttribute('aria-expanded', String(newState === 'open'));
      // Rotate chevron if present
      const chevron = combobox.querySelector('svg');
      if (chevron) chevron.style.transform = newState === 'open' ? 'rotate(180deg)' : '';
    });
  });

  // =============================================
  // PART 7: CHECKOUT/CTA BUTTONS
  // =============================================

  const ctaButtons = document.querySelectorAll('button[class*="checkout"], a[class*="checkout"], button[class*="proceed"]');
  ctaButtons.forEach(btn => {
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', (e) => {
      // Don't prevent default for actual links
      if (btn.tagName !== 'A') {
        e.preventDefault();
        alert('Thank you for your interest! This is a preview page.');
      }
    });
  });

  // =============================================
  // PART 8: HAMBURGER MENU (top-left icon)
  // =============================================

  // Find hamburger icon in top-left area (usually a div with cursor-pointer containing SVG)
  const topLeftElements = document.querySelectorAll('div[class*="cursor-pointer"], button');
  let hamburgerIcon = null;

  topLeftElements.forEach(el => {
    const rect = el.getBoundingClientRect();
    // Check if it's in the top-left header area and is small (icon-sized)
    if (rect.top < 80 && rect.left < 150 && rect.width < 60 && rect.height < 60) {
      const hasSvg = el.querySelector('svg');
      const isNotCart = !el.textContent?.includes('0') && !el.closest('.Drawer');
      if (hasSvg && isNotCart && !hamburgerIcon) {
        hamburgerIcon = el;
      }
    }
  });

  // Also check for traditional hamburger selectors
  const traditionalTriggers = document.querySelectorAll(
    '[class*="hamburger"], [class*="menu-btn"], [aria-label*="menu"], .burger'
  );
  traditionalTriggers.forEach(t => { if (!hamburgerIcon) hamburgerIcon = t; });

  // Find possible navigation drawer/menu
  const findNavMenu = () => {
    return document.querySelector(
      '[class*="mobile-nav"], [class*="slide-menu"], [class*="nav-drawer"], ' +
      'nav[class*="fixed"]:not(.Drawer__container), [class*="sidebar"]:not(.Drawer)'
    );
  };

  let navMenu = findNavMenu();

  if (hamburgerIcon) {
    hamburgerIcon.style.cursor = 'pointer';
    hamburgerIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // If there's a nav menu, toggle it
      if (navMenu) {
        const isHidden = navMenu.style.display === 'none' || navMenu.classList.contains('hidden');
        if (isHidden) {
          navMenu.style.display = 'block';
          navMenu.classList.remove('hidden');
          if (navMenu.style.transform?.includes('translate')) {
            navMenu.style.transform = 'translate3d(0, 0, 0)';
          }
        } else {
          navMenu.style.display = 'none';
        }
      } else {
        // No nav menu found - show helpful message
        alert('Navigation menu - This is a cloned preview page.');
      }
    });
  }

  // =============================================
  // PART 9: NAV DROPDOWN MENUS
  // =============================================

  document.querySelectorAll('nav li, ul.menu li').forEach(li => {
    const submenu = li.querySelector('ul, [class*="submenu"], [class*="dropdown"]');
    if (!submenu) return;

    li.addEventListener('mouseenter', () => {
      submenu.classList.remove('hidden', 'invisible', 'opacity-0');
      submenu.style.display = 'block';
    });
    li.addEventListener('mouseleave', () => {
      submenu.classList.add('hidden');
      submenu.style.display = '';
    });
  });

  // =============================================
  // PART 10: MAKE ALL BUTTONS CLICKABLE
  // =============================================

  document.querySelectorAll('button, [role="button"], [class*="cursor-pointer"]').forEach(el => {
    el.style.cursor = 'pointer';
  });
})();
</script>`;

    // Inject before closing body tag
    staticHtml = staticHtml.replace('</body>', menuToggleScript + '</body>');

    const staticOutputHtml = path.join(outputDir, 'index-static.html');
    await fs.writeFile(staticOutputHtml, staticHtml, 'utf-8');

    emit('pipeline', `Clone saved to: ${outputDir}`);
    emit('step', 'done');

    return {
      success: true,
      folderName,
      outputPath: outputDir,
      openUrl: `/clone/${folderName}/index.html`,
      staticUrl: `/clone/${folderName}/index-static.html`,
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
