const crypto = require('crypto');
const { URL } = require('url');
const path = require('path');

/**
 * Generate a hash from a URL for deterministic filenames
 */
function hashUrl(url) {
  return crypto.createHash('md5').update(url).digest('hex').slice(0, 12);
}

/**
 * Create a safe folder name from hostname and timestamp
 */
function safeFolderName(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
    const timestamp = Date.now();
    return `${hostname}_${timestamp}`;
  } catch {
    return `unknown_${Date.now()}`;
  }
}

/**
 * Validate and normalize URL
 */
function normalizeUrl(urlString) {
  let url = urlString.trim();

  // Add protocol if missing
  if (!url.match(/^https?:\/\//i)) {
    url = 'https://' + url;
  }

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('Invalid protocol');
    }
    return parsed.href;
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
}

/**
 * Get extension from URL or content-type
 */
function getExtension(urlString, contentType = '') {
  // Try to get extension from URL path
  try {
    const url = new URL(urlString);
    const pathname = url.pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext.length > 1 && ext.length < 10) {
      return ext;
    }
  } catch {}

  // Fall back to content-type
  const mimeMap = {
    'text/css': '.css',
    'text/javascript': '.js',
    'application/javascript': '.js',
    'application/x-javascript': '.js',
    'text/html': '.html',
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'font/woff': '.woff',
    'font/woff2': '.woff2',
    'font/ttf': '.ttf',
    'font/otf': '.otf',
    'application/font-woff': '.woff',
    'application/font-woff2': '.woff2',
    'application/x-font-ttf': '.ttf',
    'application/x-font-woff': '.woff',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'application/json': '.json',
  };

  const baseMime = contentType.split(';')[0].trim().toLowerCase();
  return mimeMap[baseMime] || '';
}

/**
 * Determine asset type from URL/extension for folder organization
 */
function getAssetType(urlString, contentType = '') {
  const ext = getExtension(urlString, contentType).toLowerCase();

  if (['.css'].includes(ext)) return 'css';
  if (['.js'].includes(ext)) return 'js';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) return 'images';
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'fonts';
  if (['.mp4', '.webm', '.ogg', '.avi'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) return 'audio';

  // Check content-type as fallback
  if (contentType) {
    if (contentType.includes('css')) return 'css';
    if (contentType.includes('javascript')) return 'js';
    if (contentType.includes('image')) return 'images';
    if (contentType.includes('font')) return 'fonts';
    if (contentType.includes('video')) return 'video';
    if (contentType.includes('audio')) return 'audio';
  }

  return 'other';
}

/**
 * Check if URL is a data URL
 */
function isDataUrl(url) {
  return typeof url === 'string' && url.trim().startsWith('data:');
}

/**
 * Check if URL is absolute
 */
function isAbsoluteUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url.trim());
}

/**
 * Resolve a URL against a base URL
 */
function resolveUrl(base, relative) {
  if (!relative || isDataUrl(relative)) {
    return relative;
  }

  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

/**
 * Parse srcset attribute and return array of URLs
 */
function parseSrcset(srcset) {
  if (!srcset) return [];

  return srcset
    .split(',')
    .map(part => {
      const trimmed = part.trim();
      const [url] = trimmed.split(/\s+/);
      return url;
    })
    .filter(url => url && !isDataUrl(url));
}

/**
 * Extract URLs from CSS content (url(...) patterns)
 */
function extractCssUrls(cssContent) {
  const urls = [];
  const urlRegex = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/gi;
  let match;

  while ((match = urlRegex.exec(cssContent)) !== null) {
    const url = match[2];
    if (url && !isDataUrl(url)) {
      urls.push(url);
    }
  }

  return urls;
}

module.exports = {
  hashUrl,
  safeFolderName,
  normalizeUrl,
  getExtension,
  getAssetType,
  isDataUrl,
  isAbsoluteUrl,
  resolveUrl,
  parseSrcset,
  extractCssUrls,
};
