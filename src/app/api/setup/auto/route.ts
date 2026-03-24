import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const apiKey = searchParams.get('apiKey');
    const hostParam = searchParams.get('host');

    if (!apiKey || !hostParam) {
        return new NextResponse('Missing required parameters: apiKey and host', {
            status: 400,
            headers: {
                'Content-Type': 'text/plain',
            },
        });
    }

    const requestHost = request.headers.get('host') || '127.0.0.1:3000';
    const protocol = request.headers.get('x-forwarded-proto') || 'http';
    
    // Detect base path from request URL
    const requestUrl = new URL(request.url);
    const basePath = requestUrl.pathname.replace(/\/api\/setup\/auto\/?$/, '');
    
    const baseUrl = `${protocol}://${requestHost}${basePath}`;

    const script = `#!/bin/bash
# =============================================================================
# Skill-insight Auto Setup (Non-Interactive)
# =============================================================================

WITTY_HOST="${hostParam}"
WITTY_BASE_URL="${baseUrl}"
WITTY_API_KEY="${apiKey}"

echo "🚀 Fetching Skill-insight telemetry components from $WITTY_BASE_URL..."

# 1. Setup Directories
mkdir -p "$HOME/.witty"
mkdir -p "$HOME/.witty/logs"
mkdir -p "$HOME/.opencode/plugins"
mkdir -p "$HOME/.opencode/skills"
mkdir -p "$HOME/.claude/projects"
mkdir -p "$HOME/.openclaw/agents"
mkdir -p ".opencode/skills"
echo "📂 Created necessary directories"

# 2. Interactive Framework Selection with inquirer
echo ""

SELECTOR_SCRIPT="$HOME/.witty/framework_selector.mjs"
SELECTOR_RESULT="$HOME/.witty/.selector_result"

# Install inquirer if not already installed
cd "$HOME/.witty"
if [ ! -d "node_modules/inquirer" ]; then
    echo "📦 Installing inquirer for interactive selection..."
    npm install inquirer --save 2>/dev/null
fi

cat > "$SELECTOR_SCRIPT" << 'SELECTOR_EOF'
import inquirer from 'inquirer';
import fs from 'fs';

const frameworks = [
    { name: 'OpenCode', value: 'opencode' },
    { name: 'Claude Code', value: 'claude' },
    { name: 'OpenClaw', value: 'openclaw' }
];

async function select() {
    console.log('');
    console.log('\\x1b[36m%s\\x1b[0m', '╔══════════════════════════════════════════════════════════╗');
    console.log('\\x1b[36m%s\\x1b[0m', '║                                                          ║');
    console.log('\\x1b[1m\\x1b[36m%s\\x1b[0m', '║                 ✨ Skill-insight ✨                      ║');
    console.log('\\x1b[36m%s\\x1b[0m', '║                                                          ║');
    console.log('\\x1b[36m%s\\x1b[0m', '╚══════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('\\x1b[90m%s\\x1b[0m', '  提示: ↑↓ 移动  |  空格 选择  |  a 全选  |  i 反选  |  Enter 确认');
    console.log('');

    const answers = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'frameworks',
            message: '集成到：',
            choices: frameworks,
            pageSize: 10,
            loop: false
        }
    ]);

    const selected = answers.frameworks;
    
    if (selected.length > 0) {
        console.log('');
        console.log('\\x1b[32m%s\\x1b[0m', '✅ 将安装以下组件:');
        selected.forEach(fw => {
            const name = frameworks.find(f => f.value === fw)?.name || fw;
            console.log('\\x1b[32m%s\\x1b[0m', '   • ' + name);
        });
        console.log('');
    } else {
        console.log('');
        console.log('\\x1b[33m%s\\x1b[0m', '⚠️  未选择任何组件，将不进行安装。');
        console.log('');
    }

    // Write result to file for bash to read
    const resultFile = process.env.SELECTOR_RESULT_FILE || process.env.HOME + '/.witty/.selector_result';
    fs.writeFileSync(resultFile, selected.join(','));
}

select().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
SELECTOR_EOF

# Run the selector interactively from /dev/tty
# Export the result file path so the selector knows where to write
export SELECTOR_RESULT_FILE="$SELECTOR_RESULT"
cd "$HOME/.witty" && npx -y tsx "$SELECTOR_SCRIPT" < /dev/tty

# Read the selection result from file
if [ -f "$SELECTOR_RESULT" ]; then
    SELECTED_FRAMEWORKS=$(cat "$SELECTOR_RESULT")
    rm -f "$SELECTOR_RESULT"
else
    SELECTED_FRAMEWORKS=""
fi

# Set installation flags based on selection
INSTALL_OPENCODE=false
INSTALL_CLAUDE=false
INSTALL_OPENCLAW=false

if [[ "$SELECTED_FRAMEWORKS" == *"opencode"* ]]; then
    INSTALL_OPENCODE=true
fi
if [[ "$SELECTED_FRAMEWORKS" == *"claude"* ]]; then
    INSTALL_CLAUDE=true
fi
if [[ "$SELECTED_FRAMEWORKS" == *"openclaw"* ]]; then
    INSTALL_OPENCLAW=true
fi

# Exit if nothing selected
if [ "$INSTALL_OPENCODE" = "false" ] && [ "$INSTALL_CLAUDE" = "false" ] && [ "$INSTALL_OPENCLAW" = "false" ]; then
    echo "⚠️  未选择任何框架组件，将跳过插件安装。"
    echo "   继续执行配置步骤..."
    echo ""
fi

# 3. Download Components
if [ "$INSTALL_OPENCODE" = "true" ]; then
    echo "⏬ Downloading OpenCode Plugin..."
    curl -sSf "$WITTY_BASE_URL/api/setup/opencode" -o "$HOME/.opencode/plugins/Witty-Skill-Insight.ts"
    
    echo "⏬ Downloading Skill Sync Tool..."
    curl -sSf "$WITTY_BASE_URL/sync_skills.ts" -o "$HOME/.witty/sync_skills.ts"
fi

if [ "$INSTALL_CLAUDE" = "true" ]; then
    echo "⏬ Downloading Claude Code Watcher..."
    curl -sSf "$WITTY_BASE_URL/api/setup/claude-watcher" -o "$HOME/.witty/claude_watcher_client.ts"
fi

if [ "$INSTALL_OPENCLAW" = "true" ]; then
    echo "⏬ Downloading OpenClaw Watcher..."
    curl -sSf "$WITTY_BASE_URL/api/setup/openclaw-watcher" -o "$HOME/.witty/openclaw_watcher_client.ts"
fi

# 4. Configure ~/.witty/.env (Auto mode - no interaction)
WITTY_CONFIG_FILE="$HOME/.witty/.env"

echo "⚙️  Updating configuration..."
touch "$WITTY_CONFIG_FILE"
if [ -f "$WITTY_CONFIG_FILE" ]; then
    cp "$WITTY_CONFIG_FILE" "\${WITTY_CONFIG_FILE}.bak"
    grep -v "^WITTY_INSIGHT_HOST=" "\${WITTY_CONFIG_FILE}.bak" | grep -v "^WITTY_INSIGHT_API_KEY=" > "$WITTY_CONFIG_FILE"
    rm "\${WITTY_CONFIG_FILE}.bak"
fi
echo "WITTY_INSIGHT_HOST=$WITTY_HOST" >> "$WITTY_CONFIG_FILE"
echo "WITTY_INSIGHT_API_KEY=$WITTY_API_KEY" >> "$WITTY_CONFIG_FILE"
echo "✅ Configuration updated at $WITTY_CONFIG_FILE"
echo "   WITTY_INSIGHT_HOST=$WITTY_HOST"
echo "   WITTY_INSIGHT_API_KEY=********"

# 5. Sync Opencode Skills
if [ "$INSTALL_OPENCODE" = "true" ]; then
    echo ""
    echo "🚀 Syncing Opencode Skills..."
    if command -v npx &> /dev/null; then
      npx -y tsx "$HOME/.witty/sync_skills.ts" --agent opencode
    else
      echo "⚠️  Node.js (npx) not found. Skipping skill sync."
    fi
fi

# 6. Install Watcher Dependencies (only if any watcher is selected)
if [ "$INSTALL_CLAUDE" = "true" ] || [ "$INSTALL_OPENCLAW" = "true" ]; then
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
fi

# 7. Create Watcher Startup/Stop Scripts
NEEDS_WATCHER_SCRIPTS=false
if [ "$INSTALL_CLAUDE" = "true" ] || [ "$INSTALL_OPENCLAW" = "true" ]; then
    NEEDS_WATCHER_SCRIPTS=true
fi

if [ "$NEEDS_WATCHER_SCRIPTS" = "true" ]; then
    echo ""
    echo "📝 Creating watcher management scripts..."

    # Claude Watcher Start Script
    if [ "$INSTALL_CLAUDE" = "true" ]; then
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
        echo "✅ Claude watcher start script created"

        # Claude Watcher Stop Script
        cat > "$HOME/.witty/stop_claude_watcher.sh" << 'STOP_CLAUDE_EOF'
#!/bin/bash
echo "Stopping Claude watcher..."
pkill -f "claude_watcher_client.ts" 2>/dev/null
rm -f "$HOME/.witty/claude_watcher.pid"
echo "Claude watcher stopped"
STOP_CLAUDE_EOF
        chmod +x "$HOME/.witty/stop_claude_watcher.sh"
        echo "✅ Claude watcher stop script created"
    fi

    # OpenClaw Watcher Start Script
    if [ "$INSTALL_OPENCLAW" = "true" ]; then
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
        echo "✅ OpenClaw watcher start script created"

        # OpenClaw Watcher Stop Script
        cat > "$HOME/.witty/stop_openclaw_watcher.sh" << 'STOP_OPENCLAW_EOF'
#!/bin/bash
echo "Stopping OpenClaw watcher..."
pkill -f "openclaw_watcher_client.ts" 2>/dev/null
rm -f "$HOME/.witty/openclaw_watcher.pid"
echo "OpenClaw watcher stopped"
STOP_OPENCLAW_EOF
        chmod +x "$HOME/.witty/stop_openclaw_watcher.sh"
        echo "✅ OpenClaw watcher stop script created"
    fi

    # Combined Start Script - Dynamic generation
    cat > "$HOME/.witty/start_watchers.sh" << 'WATCHER_HEADER'
#!/bin/bash
echo "Starting Witty-Skill-Insight watchers..."
WATCHER_HEADER

    if [ "$INSTALL_CLAUDE" = "true" ]; then
        echo '"$HOME/.witty/start_claude_watcher.sh"' >> "$HOME/.witty/start_watchers.sh"
    fi
    if [ "$INSTALL_OPENCLAW" = "true" ]; then
        echo '"$HOME/.witty/start_openclaw_watcher.sh"' >> "$HOME/.witty/start_watchers.sh"
    fi

    echo 'echo "All watchers started!"' >> "$HOME/.witty/start_watchers.sh"
    chmod +x "$HOME/.witty/start_watchers.sh"
    echo "✅ Combined start script created"

    # Combined Stop Script - Dynamic generation
    cat > "$HOME/.witty/stop_watchers.sh" << 'STOP_HEADER'
#!/bin/bash
echo "Stopping Witty-Skill-Insight watchers..."
STOP_HEADER

    if [ "$INSTALL_CLAUDE" = "true" ]; then
        echo '"$HOME/.witty/stop_claude_watcher.sh"' >> "$HOME/.witty/stop_watchers.sh"
    fi
    if [ "$INSTALL_OPENCLAW" = "true" ]; then
        echo '"$HOME/.witty/stop_openclaw_watcher.sh"' >> "$HOME/.witty/stop_watchers.sh"
    fi

    echo 'echo "All watchers stopped!"' >> "$HOME/.witty/stop_watchers.sh"
    chmod +x "$HOME/.witty/stop_watchers.sh"
    echo "✅ Combined stop script created"
fi

# 8. Start Watchers Now
if [ "$NEEDS_WATCHER_SCRIPTS" = "true" ]; then
    echo ""
    echo "🚀 Starting telemetry watchers..."
    if command -v npx &> /dev/null; then
        "$HOME/.witty/start_watchers.sh"
    else
        echo "⚠️  Node.js (npx) not found. Skipping watcher startup."
    fi
fi

# 9. Configure Claude Code Auto-Sync Wrapper
if [ "$INSTALL_CLAUDE" = "true" ]; then
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
fi

# 10. Final Summary
echo ""
echo "🌟 Witty-Skill-Insight Telemetry: READY"
echo "------------------------------------------------"
echo "Installed Components:"
if [ "$INSTALL_OPENCODE" = "true" ]; then
    echo "  ✅ OpenCode Plugin: ~/.opencode/plugins/Witty-Skill-Insight.ts"
fi
if [ "$INSTALL_CLAUDE" = "true" ]; then
    echo "  ✅ Claude Watcher: ~/.witty/claude_watcher_client.ts"
fi
if [ "$INSTALL_OPENCLAW" = "true" ]; then
    echo "  ✅ OpenClaw Watcher: ~/.witty/openclaw_watcher_client.ts"
fi

if [ "$NEEDS_WATCHER_SCRIPTS" = "true" ]; then
    echo ""
    echo "Watcher Management:"
    echo "  Start all:    ~/.witty/start_watchers.sh"
    echo "  Stop all:     ~/.witty/stop_watchers.sh"
    if [ "$INSTALL_CLAUDE" = "true" ]; then
        echo "  Start Claude: ~/.witty/start_claude_watcher.sh"
        echo "  Stop Claude:  ~/.witty/stop_claude_watcher.sh"
    fi
    if [ "$INSTALL_OPENCLAW" = "true" ]; then
        echo "  Start OpenClaw: ~/.witty/start_openclaw_watcher.sh"
        echo "  Stop OpenClaw:  ~/.witty/stop_openclaw_watcher.sh"
    fi
    echo "  Logs:         ~/.witty/logs/"
fi

echo ""
echo "Usage:"
if [ "$INSTALL_OPENCODE" = "true" ]; then
    echo "  1. Run: opencode run 'hello'"
fi
if [ "$INSTALL_CLAUDE" = "true" ]; then
    echo "  2. Run: claude (restart terminal first)"
fi
if [ "$INSTALL_OPENCLAW" = "true" ]; then
    echo "  3. OpenClaw will automatically monitor and upload telemetry"
fi
echo "------------------------------------------------"
`;

    return new NextResponse(script, {
        headers: {
            'Content-Type': 'text/x-shellscript',
        },
    });
}
