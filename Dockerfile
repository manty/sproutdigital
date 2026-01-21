FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app

# Install build tools for native modules (sharp)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Force fresh install - cache bust v2
RUN npm cache clean --force && npm install --verbose

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Start the server
CMD ["npm", "start"]
