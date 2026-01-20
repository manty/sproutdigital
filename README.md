# SPROUTDIGITAL

```
███████╗██████╗ ██████╗  ██████╗ ██╗   ██╗████████╗
██╔════╝██╔══██╗██╔══██╗██╔═══██╗██║   ██║╚══██╔══╝
███████╗██████╔╝██████╔╝██║   ██║██║   ██║   ██║
╚════██║██╔═══╝ ██╔══██╗██║   ██║██║   ██║   ██║
███████║██║     ██║  ██║╚██████╔╝╚██████╔╝   ██║
╚══════╝╚═╝     ╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝

██████╗ ██╗ ██████╗ ██╗████████╗ █████╗ ██╗
██╔══██╗██║██╔════╝ ██║╚══██╔══╝██╔══██╗██║
██║  ██║██║██║  ███╗██║   ██║   ███████║██║
██║  ██║██║██║   ██║██║   ██║   ██╔══██║██║
██████╔╝██║╚██████╔╝██║   ██║   ██║  ██║███████╗
╚═════╝ ╚═╝ ╚═════╝ ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝
```

## Wonka Clone Factory - Website Cloner

> **Clone any public landing page with pixel-perfect accuracy**

---

## Quick Start

### Option 1: One-Click Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/manty/sproutdigital-website-cloner)

### Option 2: Local Development

```bash
# Clone the repo
git clone https://github.com/manty/sproutdigital-website-cloner.git
cd sproutdigital-website-cloner

# Install dependencies (also installs Playwright Chromium)
npm install

# Run the app
npm run dev
```

---

## How to Use

1. **Start the server:**
   ```bash
   npm run dev
   ```

2. **Open your browser:**
   Navigate to `http://localhost:3000`

3. **Clone a website:**
   - Enter any public URL (e.g., `https://example.com`)
   - Click "Clone It!"
   - Watch the live console logs as it:
     - Launches a Chromium browser
     - Navigates to the page
     - Auto-scrolls to trigger lazy loading
     - Captures the full DOM
     - Downloads all assets (images, CSS, JS, fonts)
     - Rewrites references to local paths

4. **View your clone:**
   - Click "Open Cloned Page" when complete
   - Find files in `./output/<hostname>_<timestamp>/`

---

## Project Structure

```
/
├── server/
│   ├── index.js       # Express server + WebSocket
│   ├── cloner.js      # Core cloning pipeline
│   ├── utils.js       # URL handling, hashing, etc.
│   └── self-test.js   # Automated test script
├── public/
│   ├── index.html     # Wonka-themed UI
│   └── app.js         # Frontend logic
├── output/            # Generated clones go here
├── package.json
└── README.md
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/clone` | POST | Start a clone job. Body: `{ url: string }` |
| `/api/jobs/:jobId` | GET | Get job status and result |
| `/api/jobs` | GET | List all jobs |
| `/api/health` | GET | Health check |
| `/clone/<folder>/index.html` | GET | View cloned pages |

---

## WebSocket Logs

Connect to `ws://localhost:3000?jobId=<jobId>` to receive real-time logs:

```json
{ "type": "console", "message": "[log] Page loaded" }
{ "type": "network", "message": "[RES] 200 image: https://..." }
{ "type": "pipeline", "message": "Downloading assets..." }
{ "type": "step", "message": "download" }
{ "type": "complete", "message": "{...result...}" }
```

---

## Run Tests

```bash
npm test
```

This clones `example.com` and verifies:
- Output folder created
- `index.html` exists with content
- Clone is accessible

---

## Troubleshooting

### "Browser not found" error
```bash
npx playwright install chromium
```

### "Permission denied" on Linux
```bash
npx playwright install-deps
```

### Slow on first run
The first clone downloads Chromium (~150MB). Subsequent runs are fast.

### Some assets missing
- Some sites block automated requests
- JavaScript-only content may not fully render
- Try increasing wait times in `cloner.js`

---

## Tech Stack

| Package | Purpose |
|---------|---------|
| **Node.js 20+** | Runtime |
| **Express** | Web server |
| **Playwright** | Browser automation |
| **ws** | WebSocket for real-time logs |
| **node-html-parser** | HTML parsing |

---

## Features

- **Real Browser Rendering**: Uses Playwright Chromium to render JavaScript
- **Auto-Scroll**: Triggers lazy-loading content
- **Asset Download**: Images, CSS, JS, fonts, videos
- **CSS Processing**: Downloads fonts referenced in stylesheets
- **Live Logs**: Real-time console and network logs via WebSocket
- **Progress Tracking**: Step-by-step progress indicators
- **Neon UI**: "Ultra-futuristic Willy Wonka" themed interface

---

## Push to Your Own GitHub

Save your work to your own repo:

```bash
# 1. Create a new repo on GitHub (github.com/new)
#    Name it: website-cloner (or whatever you want)
#    Do NOT initialize with README

# 2. Change the remote to your repo
git remote set-url origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# 3. Push your code
git add -A
git commit -m "SproutDigital Website Cloner"
git push -u origin main
```

---

## Need Help?

Open an issue on GitHub or contact SproutDigital.

---

**Built by SproutDigital**
