#!/bin/bash

# Enable verbose mode to see what's happening
# set -x

# Navigate to the project root directory
cd "$(dirname "$0")/.."

# Auto-initialize environment and data directory
if [ ! -f .env ] && [ -f .env.example ]; then
  echo "No .env found. Initializing from .env.example..."
  cp .env.example .env
fi

if [ ! -d data ]; then
  echo "Creating data directory..."
  mkdir -p data
fi

echo "=== Restart Script (DEV MODE) Started ==="

# Function to find PID using various tools
find_pid_on_port() {
  local port=$1
  local pid=""
  
  if command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -t -i:${port} -sTCP:LISTEN)
  fi
  
  if [ -z "$pid" ] && command -v netstat >/dev/null 2>&1; then
    # Parse netstat output for PIDs
    pid=$(netstat -nlp 2>/dev/null | grep ":$port " | awk '{print $7}' | cut -d'/' -f1)
  fi
  
  if [ -z "$pid" ] && command -v ss >/dev/null 2>&1; then
    pid=$(ss -lptn "sport = :$port" 2>/dev/null | grep -oP 'pid=\K\d+')
  fi
  
  # Return the PID(s)
  echo "$pid"
}

PORT=3000
echo "Checking port $PORT..."

# 1. Try finding PID specifically
PIDS=$(find_pid_on_port $PORT)

if [ -n "$PIDS" ]; then
  echo "Found process(es) occupying port $PORT: $PIDS"
  echo "Killing PIDS..."
  kill -9 $PIDS
else
  echo "No PID found via standard tools (lsof/netstat/ss)."
fi

# 2. Force kill using fuser if available (very reliable)
if command -v fuser >/dev/null 2>&1; then
  echo "Attempting to force kill with fuser..."
  fuser -k -n tcp $PORT >/dev/null 2>&1
fi

# 3. Double check
echo "Waiting for port to release..."
sleep 2

PIDS_REMAINING=$(find_pid_on_port $PORT)
if [ -n "$PIDS_REMAINING" ]; then
  echo "CRITICAL ERROR: Port $PORT is STILL in use by PID: $PIDS_REMAINING"
  echo "Please manually kill this process: kill -9 $PIDS_REMAINING"
  exit 1
fi

echo "Port $PORT is confirmed free."

# 4. Start in DEV mode
echo "-----------------------------------"
echo "Syncing database schema..."
npx prisma db push

echo "Generating Prisma client..."
npx prisma generate

echo "Starting server in DEVELOPMENT mode (npm run dev)..."

nohup npm run dev > server.log 2>&1 &
NEW_PID=$!

echo "Server started successfully."
echo "PID: $NEW_PID"
echo "Log file: server.log"
echo "-----------------------------------"
