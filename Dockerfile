FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Set browser path BEFORE npm install so postinstall uses existing browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy package files first
COPY package*.json ./

# Install dependencies (skip browser download - already in image)
RUN npm install --legacy-peer-deps --ignore-scripts && \
    npm rebuild

# Copy application code
COPY server ./server
COPY public ./public

# Expose port
EXPOSE 3000

# Set runtime environment
ENV NODE_ENV=production

# Start the server
CMD ["node", "server/index.js"]
