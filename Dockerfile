FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Set browser path
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package files first
COPY package*.json ./

# Install dependencies without postinstall
RUN npm install --legacy-peer-deps --ignore-scripts

# Install Playwright browsers explicitly to /ms-playwright
RUN npx playwright install chromium

# List what we have for debugging
RUN ls -la /ms-playwright/ && find /ms-playwright -name "chrome*" -type f | head -5

# Copy application code
COPY server ./server
COPY public ./public

# Expose port
EXPOSE 3000

# Set runtime environment
ENV NODE_ENV=production

# Start the server
CMD ["node", "server/index.js"]
