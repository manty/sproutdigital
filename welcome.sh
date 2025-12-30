#!/bin/bash

# Colors
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
WHITE='\033[1;37m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

clear

echo ""
echo -e "${MAGENTA}"
cat << "EOF"
    ██████╗ ███████╗███████╗██╗  ██╗ ██████╗ ██╗   ██╗████████╗
   ██╔════╝ ██╔════╝██╔════╝██║ ██╔╝██╔═══██╗██║   ██║╚══██╔══╝
   ██║  ███╗█████╗  █████╗  █████╔╝ ██║   ██║██║   ██║   ██║
   ██║   ██║██╔══╝  ██╔══╝  ██╔═██╗ ██║   ██║██║   ██║   ██║
   ╚██████╔╝███████╗███████╗██║  ██╗╚██████╔╝╚██████╔╝   ██║
    ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝ ╚═════╝  ╚═════╝    ╚═╝
EOF
echo -e "${NC}"

echo -e "${CYAN}"
cat << "EOF"
   ██╗   ██╗███████╗ ██████╗  █████╗ ███████╗    ██████╗  ██████╗ ██████╗  ██████╗
   ██║   ██║██╔════╝██╔════╝ ██╔══██╗██╔════╝    ╚════██╗██╔═████╗╚════██╗██╔════╝
   ██║   ██║█████╗  ██║  ███╗███████║███████╗     █████╔╝██║██╔██║ █████╔╝███████╗
   ╚██╗ ██╔╝██╔══╝  ██║   ██║██╔══██║╚════██║    ██╔═══╝ ████╔╝██║██╔═══╝ ██╔═══██╗
    ╚████╔╝ ███████╗╚██████╔╝██║  ██║███████║    ███████╗╚██████╔╝███████╗╚██████╔╝
     ╚═══╝  ╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝    ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝
EOF
echo -e "${NC}"

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "                    ${WHITE}${BOLD}LANDING PAGE CLONER WORKSHOP${NC}"
echo -e "                         ${CYAN}by ${BOLD}Samar Hussain${NC}"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}[${WHITE}01${GREEN}]${NC} Clone any landing page with one command"
echo -e "  ${GREEN}[${WHITE}02${GREEN}]${NC} Generate AI variations with Google Gemini"
echo -e "  ${GREEN}[${WHITE}03${GREEN}]${NC} Build with Claude Code - your AI pair programmer"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Environment Check
echo -e "  ${BOLD}${WHITE}ENVIRONMENT STATUS${NC}"
echo ""

# Check Node
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo -e "  ${GREEN}✓${NC} Node.js          ${WHITE}$NODE_VERSION${NC}"
else
    echo -e "  ${RED}✗${NC} Node.js          ${RED}Not installed${NC}"
fi

# Check npm
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo -e "  ${GREEN}✓${NC} npm              ${WHITE}v$NPM_VERSION${NC}"
else
    echo -e "  ${RED}✗${NC} npm              ${RED}Not installed${NC}"
fi

# Check Claude Code
if command -v claude &> /dev/null; then
    CLAUDE_VERSION=$(claude --version 2>/dev/null || echo "installed")
    echo -e "  ${GREEN}✓${NC} Claude Code      ${WHITE}$CLAUDE_VERSION${NC}"
else
    echo -e "  ${RED}✗${NC} Claude Code      ${RED}Not found${NC}"
fi

# Check for node_modules
if [ -d "node_modules" ]; then
    echo -e "  ${GREEN}✓${NC} Dependencies     ${WHITE}Installed${NC}"
else
    echo -e "  ${YELLOW}○${NC} Dependencies     ${YELLOW}Run: npm install${NC}"
fi

echo ""

# API Key Check
echo -e "  ${BOLD}${WHITE}API KEYS${NC}"
echo ""

if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo -e "  ${GREEN}✓${NC} ANTHROPIC_API_KEY is set"
else
    echo -e "  ${YELLOW}○${NC} ANTHROPIC_API_KEY ${YELLOW}not set${NC}"
    echo -e "      ${WHITE}Run: export ANTHROPIC_API_KEY=your_key${NC}"
fi

if [ -n "$GEMINI_API_KEY" ]; then
    echo -e "  ${GREEN}✓${NC} GEMINI_API_KEY is set"
else
    echo -e "  ${YELLOW}○${NC} GEMINI_API_KEY ${YELLOW}not set${NC}"
    echo -e "      ${WHITE}Run: export GEMINI_API_KEY=your_key${NC}"
fi

echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${BOLD}${WHITE}QUICK START${NC}"
echo ""
echo -e "  ${CYAN}1.${NC} Set your API keys (above)"
echo -e "  ${CYAN}2.${NC} Type ${GREEN}claude${NC} to start Claude Code"
echo -e "  ${CYAN}3.${NC} Ask Claude to clone a landing page!"
echo ""
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${MAGENTA}${BOLD}Let's build something amazing together!${NC}"
echo ""
