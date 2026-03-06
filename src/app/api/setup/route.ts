
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const host = request.headers.get('host') || '127.0.0.1:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    const baseUrl = `${protocol}://${host}`;

    const script = `#!/bin/bash
# =============================================================================
# Witty-Skill-Insight One-Click Setup
# =============================================================================

WITTY_HOST="${host}"
WITTY_BASE_URL="${baseUrl}"

echo "🚀 Fetching Witty-Skill-Insight telemetry components from $WITTY_BASE_URL..."

# 1. Setup Directories
mkdir -p "$HOME/.witty"
mkdir -p "$HOME/.witty/logs"
mkdir -p "$HOME/.opencode/plugins"
mkdir -p "$HOME/.opencode/skills"
mkdir -p "$HOME/.claude/projects"
mkdir -p "$HOME/.openclaw/agents"
mkdir -p ".opencode/skills"
echo "📂 Created necessary directories"

# 2. Download Components
echo "⏬ Downloading OpenCode Plugin..."
curl -sSf "$WITTY_BASE_URL/api/setup/opencode" -o "$HOME/.opencode/plugins/Witty-Skill-Insight.ts"

echo "⏬ Downloading Skill Sync Tool..."
curl -sSf "$WITTY_BASE_URL/sync_skills.ts" -o "$HOME/.witty/sync_skills.ts"

echo "⏬ Downloading Claude Code Watcher..."
curl -sSf "$WITTY_BASE_URL/api/setup/claude-watcher" -o "$HOME/.witty/claude_watcher_client.ts"

echo "⏬ Downloading OpenClaw Watcher..."
curl -sSf "$WITTY_BASE_URL/api/setup/openclaw-watcher" -o "$HOME/.witty/openclaw_watcher_client.ts"

# 3. Configure ~/.witty/.env
WITTY_CONFIG_FILE="$HOME/.witty/.env"
EXISTING_KEY=""
EXISTING_HOST=""
if [ -f "$WITTY_CONFIG_FILE" ]; then
    EXISTING_KEY=$(grep '^WITTY_INSIGHT_API_KEY=' "$WITTY_CONFIG_FILE" | head -n 1 | cut -d'=' -f2-)
    EXISTING_HOST=$(grep '^WITTY_INSIGHT_HOST=' "$WITTY_CONFIG_FILE" | head -n 1 | cut -d'=' -f2-)
fi

# -- API Key Logic --
FINAL_KEY="$EXISTING_KEY"
if [ -n "$EXISTING_KEY" ]; then
    echo "🔑 Found existing API Key."
    read -p "👉 Use existing key? (y/N, Default: y): " USE_EXISTING < /dev/tty
    if [[ "$USE_EXISTING" =~ ^[Nn]$ ]]; then
        read -p "👉 Please enter your NEW API Key: " FINAL_KEY < /dev/tty
    fi
else
    echo "🔑 WITTY_INSIGHT_API_KEY is not set."
    read -p "👉 Please enter your API Key: " FINAL_KEY < /dev/tty
fi

# -- Host Logic --
FINAL_HOST="$WITTY_HOST"
if [ -n "$EXISTING_HOST" ] && [ "$EXISTING_HOST" != "$WITTY_HOST" ]; then
    echo "🌐 Current Host in config: $EXISTING_HOST"
    echo "🌐 New Host detected: $WITTY_HOST"
    read -p "👉 Change to new Host? (y/N, Default: y): " CHANGE_HOST < /dev/tty
    if [[ "$CHANGE_HOST" =~ ^[Nn]$ ]]; then
        FINAL_HOST="$EXISTING_HOST"
    fi
elif [ -z "$EXISTING_HOST" ]; then
    FINAL_HOST="$WITTY_HOST"
fi

if [ -z "$FINAL_KEY" ]; then
    echo "⚠️  Warning: No API Key provided. Telemetry upload will fail until you set it in $WITTY_CONFIG_FILE"
fi

echo "⚙️  Updating configuration..."
touch "$WITTY_CONFIG_FILE"
cp "$WITTY_CONFIG_FILE" "\${WITTY_CONFIG_FILE}.bak"
grep -v "^WITTY_INSIGHT_HOST=" "\${WITTY_CONFIG_FILE}.bak" | grep -v "^WITTY_INSIGHT_API_KEY=" > "$WITTY_CONFIG_FILE"
echo "WITTY_INSIGHT_HOST=$FINAL_HOST" >> "$WITTY_CONFIG_FILE"
echo "WITTY_INSIGHT_API_KEY=$FINAL_KEY" >> "$WITTY_CONFIG_FILE"
rm "\${WITTY_CONFIG_FILE}.bak"
echo "✅ Configuration updated at $WITTY_CONFIG_FILE"

# 4. Sync Opencode Skills
echo ""
echo "🚀 Syncing Opencode Skills..."
if command -v npx &> /dev/null; then
  npx -y tsx "$HOME/.witty/sync_skills.ts" --agent opencode
else
  echo "⚠️  Node.js (npx) not found. Skipping skill sync."
fi

# 5. Install Watcher Dependencies
echo ""
echo "📦 Installing watcher dependencies..."
if command -v npm &> /dev/null; then
  cd "$HOME/.witty"
  if [ ! -f "package.json" ]; then
    echo '{"name": "witty-watcher", "version": "1.0.0", "type": "module", "dependencies": {}}' > package.json
  fi
  npm install chokidar --save 2>/dev/null
  echo "✅ Dependencies installed"
else
  echo "⚠️  npm not found. Skipping dependency installation."
fi

# 6. Create Watcher Startup Scripts
echo ""
echo "📝 Creating watcher startup scripts..."

# Claude Watcher Start Script
cat > "$HOME/.witty/start_claude_watcher.sh" << 'WATCHER_EOF'
#!/bin/bash
# Stop existing watcher if running
pkill -f "claude_watcher_client.ts" 2>/dev/null

# Start watcher in background
cd "$HOME/.witty" && nohup npx -y tsx "$HOME/.witty/claude_watcher_client.ts" > "$HOME/.witty/logs/claude_watcher.log" 2>&1 &
echo $! > "$HOME/.witty/claude_watcher.pid"
echo "Claude watcher started with PID $(cat $HOME/.witty/claude_watcher.pid)"
WATCHER_EOF
chmod +x "$HOME/.witty/start_claude_watcher.sh"

# OpenClaw Watcher Start Script
cat > "$HOME/.witty/start_openclaw_watcher.sh" << 'WATCHER_EOF'
#!/bin/bash
# Stop existing watcher if running
pkill -f "openclaw_watcher_client.ts" 2>/dev/null

# Start watcher in background
cd "$HOME/.witty" && nohup npx -y tsx "$HOME/.witty/openclaw_watcher_client.ts" > "$HOME/.witty/logs/openclaw_watcher.log" 2>&1 &
echo $! > "$HOME/.witty/openclaw_watcher.pid"
echo "OpenClaw watcher started with PID $(cat $HOME/.witty/openclaw_watcher.pid)"
WATCHER_EOF
chmod +x "$HOME/.witty/start_openclaw_watcher.sh"

# Combined Start Script
cat > "$HOME/.witty/start_watchers.sh" << 'WATCHER_EOF'
#!/bin/bash
echo "Starting Witty-Skill-Insight watchers..."
"$HOME/.witty/start_claude_watcher.sh"
"$HOME/.witty/start_openclaw_watcher.sh"
echo "All watchers started!"
WATCHER_EOF
chmod +x "$HOME/.witty/start_watchers.sh"

# Combined Stop Script
cat > "$HOME/.witty/stop_watchers.sh" << 'WATCHER_EOF'
#!/bin/bash
echo "Stopping Witty-Skill-Insight watchers..."
pkill -f "claude_watcher_client.ts" 2>/dev/null
pkill -f "openclaw_watcher_client.ts" 2>/dev/null
rm -f "$HOME/.witty/claude_watcher.pid"
rm -f "$HOME/.witty/openclaw_watcher.pid"
echo "All watchers stopped!"
WATCHER_EOF
chmod +x "$HOME/.witty/stop_watchers.sh"

echo "✅ Watcher scripts created"

# 6. Start Watchers Now
echo ""
echo "🚀 Starting telemetry watchers..."
if command -v npx &> /dev/null; then
    "$HOME/.witty/start_watchers.sh"
else
    echo "⚠️  Node.js (npx) not found. Skipping watcher startup."
fi

# 7. Setup Auto-start on Login (systemd user service for Linux)
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    echo ""
    echo "🔧 Setting up systemd user service for auto-start..."
    
    # Create systemd user directory
    mkdir -p "$HOME/.config/systemd/user"
    
    # Create systemd service file
    cat > "$HOME/.config/systemd/user/witty-watchers.service" << 'SERVICE_EOF'
[Unit]
Description=Witty-Skill-Insight Telemetry Watchers
After=network.target

[Service]
Type=forking
ExecStart=%h/.witty/start_watchers.sh
ExecStop=%h/.witty/stop_watchers.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
SERVICE_EOF
    
    # Enable the service
    systemctl --user daemon-reload
    systemctl --user enable witty-watchers.service
    echo "✅ Systemd service installed and enabled"
fi

# Setup Auto-start on macOS (launchd)
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo ""
    echo "🔧 Setting up launchd for auto-start on macOS..."
    
    cat > "$HOME/Library/LaunchAgents/com.witty.watchers.plist" << 'PLIST_EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.witty.watchers</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>$HOME/.witty/start_watchers.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$HOME/.witty/logs/launchd_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.witty/logs/launchd_stderr.log</string>
</dict>
</plist>
PLIST_EOF
    
    launchctl load "$HOME/Library/LaunchAgents/com.witty.watchers.plist" 2>/dev/null || true
    echo "✅ LaunchAgent installed"
fi

# 8. Configure Claude Code Auto-Sync Wrapper
echo ""
echo "🔄 Configuring Claude Code Auto-Sync Wrapper..."
CLAUDE_WRAPPER='
# Witty Insight Claude Alliance
witty-claude() {
    if command -v npx &> /dev/null; then
        npx -y tsx "$HOME/.witty/sync_skills.ts" --agent claude >/dev/null 2>&1
    fi
    command claude "$@"
}
alias claude="witty-claude"
'

for rc_file in "$HOME/.bashrc" "$HOME/.zshrc"; do
    if [ -f "$rc_file" ]; then
        if ! grep -q "witty-claude()" "$rc_file" 2>/dev/null; then
            echo "$CLAUDE_WRAPPER" >> "$rc_file"
            echo "✅ Installed Claude wrapper to $rc_file"
        fi
    fi
done

echo ""
echo "🌟 Witty-Skill-Insight Telemetry: READY"
echo "------------------------------------------------"
echo "Installed Components:"
echo "  ✅ OpenCode Plugin: ~/.opencode/plugins/Witty-Skill-Insight.ts"
echo "  ✅ Claude Watcher: ~/.witty/claude_watcher_client.ts"
echo "  ✅ OpenClaw Watcher: ~/.witty/openclaw_watcher_client.ts"
echo ""
echo "Watcher Management:"
echo "  Start:  ~/.witty/start_watchers.sh"
echo "  Stop:   ~/.witty/stop_watchers.sh"
echo "  Logs:   ~/.witty/logs/"
echo ""
echo "Usage:"
echo "  1. Run: opencode run 'hello'"
echo "  2. Run: claude (restart terminal first)"
echo "  3. Watchers will automatically monitor and upload telemetry"
echo "------------------------------------------------"
`;

    return new NextResponse(script, {
        headers: {
            'Content-Type': 'text/x-shellscript',
        },
    });
}
