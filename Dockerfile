FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Set browser path FIRST - before any npm commands
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install dependencies (skip postinstall, we'll install browsers separately)
RUN npm install --legacy-peer-deps --ignore-scripts

# Verify browsers exist in the image (they should be pre-installed)
RUN echo "=== Checking browser installation ===" && \
    ls -la /ms-playwright/ && \
    find /ms-playwright -name "chrome" -o -name "chrome-headless-shell" | head -10

# Create output directory for cloned sites
RUN mkdir -p /app/output && chmod 777 /app/output

# Copy application code
COPY server ./server
COPY public ./public

# Expose port
EXPOSE 3000

# Start the server
CMD ["node", "server/index.js"]
