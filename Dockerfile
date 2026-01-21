FROM mcr.microsoft.com/playwright:v1.57.0-noble

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install ALL dependencies
RUN npm install --legacy-peer-deps

# Copy application code (node_modules excluded via .dockerignore)
COPY server ./server
COPY public ./public

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Start the server
CMD ["node", "server/index.js"]
