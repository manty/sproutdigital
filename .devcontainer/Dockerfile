FROM mcr.microsoft.com/devcontainers/base:ubuntu

# Install system utilities (The "Small Stuff")
RUN apt-get update && apt-get install -y \
    wget curl jq btop zip unzip build-essential tldr \
    libgbm-dev libnss3 libatk-bridge2.0-0 libgtk-3-0

# Pre-install Playwright browsers for the Cloner
RUN npx -y playwright install --with-deps chromium

USER vscode
