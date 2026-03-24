import { NextResponse } from 'next/server';

function detectPlatform(request: Request): 'windows' | 'unix' {
    const userAgent = request.headers.get('user-agent') || '';
    const platformHeader = request.headers.get('x-platform') || '';
    
    if (platformHeader) {
        return platformHeader.toLowerCase() === 'windows' ? 'windows' : 'unix';
    }
    
    if (/windows|win32|win64/i.test(userAgent)) {
        return 'windows';
    }
    
    return 'unix';
}

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
    const platform = detectPlatform(request);

    if (platform === 'windows') {
        return generatePowerShellScript(baseUrl, hostParam, apiKey);
    }
    
    return generateBashScript(baseUrl, hostParam, apiKey);
}

function generateBashScript(baseUrl: string, hostParam: string, apiKey: string): NextResponse {
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

function generatePowerShellScript(baseUrl: string, hostParam: string, apiKey: string): NextResponse {
    const script = [
        '# =============================================================================',
        '# Skill-insight Auto Setup (Non-Interactive) - PowerShell',
        '# =============================================================================',
        '',
        '$WITTY_HOST = "' + hostParam + '"',
        '$WITTY_BASE_URL = "' + baseUrl + '"',
        '$WITTY_API_KEY = "' + apiKey + '"',
        '',
        'Write-Host "🚀 Fetching Skill-insight telemetry components from $WITTY_BASE_URL..."',
        '',
        '# 1. Setup Directories',
        '$wittyDir = Join-Path $env:USERPROFILE ".witty"',
        '$wittyLogsDir = Join-Path $wittyDir "logs"',
        '$opencodePluginsDir = Join-Path $env:USERPROFILE ".opencode\\plugins"',
        '$opencodeSkillsDir = Join-Path $env:USERPROFILE ".opencode\\skills"',
        '$claudeProjectsDir = Join-Path $env:USERPROFILE ".claude\\projects"',
        '$openclawAgentsDir = Join-Path $env:USERPROFILE ".openclaw\\agents"',
        '',
        'New-Item -ItemType Directory -Force -Path $wittyDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path $wittyLogsDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path $opencodePluginsDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path $opencodeSkillsDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path $claudeProjectsDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path $openclawAgentsDir | Out-Null',
        'New-Item -ItemType Directory -Force -Path ".opencode\\skills" | Out-Null',
        'Write-Host "📂 Created necessary directories"',
        '',
        '# 2. Interactive Framework Selection with inquirer',
        'Write-Host ""',
        '',
        '$SELECTOR_SCRIPT = Join-Path $wittyDir "framework_selector.mjs"',
        '$SELECTOR_RESULT = Join-Path $wittyDir ".selector_result"',
        '',
        '# Install inquirer if not already installed',
        'Set-Location $wittyDir',
        'if (-not (Test-Path "node_modules\\inquirer")) {',
        '    Write-Host "📦 Installing inquirer for interactive selection..."',
        '    npm install inquirer --save 2>$null',
        '}',
        '',
        '$selectorLines = @(',
        '    "import inquirer from \'inquirer\';"',
        '    "import fs from \'fs\';"',
        '    ""',
        '    "const frameworks = ["',
        '    "    { name: \'OpenCode\', value: \'opencode\' },"',
        '    "    { name: \'Claude Code\', value: \'claude\' },"',
        '    "    { name: \'OpenClaw\', value: \'openclaw\' }"',
        '    "];"',
        '    ""',
        '    "async function select() {"',
        '    "    console.log(\'\');"',
        '    "    console.log(\'\\x1b[36m%s\\x1b[0m\', \'╔══════════════════════════════════════════════════════════╗\');"',
        '    "    console.log(\'\\x1b[36m%s\\x1b[0m\', \'║                                                          ║\');"',
        '    "    console.log(\'\\x1b[1m\\x1b[36m%s\\x1b[0m\', \'║                 ✨ Skill-insight ✨                      ║\');"',
        '    "    console.log(\'\\x1b[36m%s\\x1b[0m\', \'║                                                          ║\');"',
        '    "    console.log(\'\\x1b[36m%s\\x1b[0m\', \'╚══════════════════════════════════════════════════════════╝\');"',
        '    "    console.log(\'\');"',
        '    "    console.log(\'\\x1b[90m%s\\x1b[0m\', \'  提示: ↑↓ 移动  |  空格 选择  |  a 全选  |  i 反选  |  Enter 确认\');"',
        '    "    console.log(\'\');"',
        '    ""',
        '    "    const answers = await inquirer.prompt(["',
        '    "        {"',
        '    "            type: \'checkbox\',"',
        '    "            name: \'frameworks\',"',
        '    "            message: \'集成到：\',"',
        '    "            choices: frameworks,"',
        '    "            pageSize: 10,"',
        '    "            loop: false"',
        '    "        }"',
        '    "    ]);"',
        '    ""',
        '    "    const selected = answers.frameworks;"',
        '    "    "',
        '    "    if (selected.length > 0) {"',
        '    "        console.log(\'\');"',
        '    "        console.log(\'\\x1b[32m%s\\x1b[0m\', \'✅ 将安装以下组件:\');"',
        '    "        selected.forEach(fw => {"',
        '    "            const name = frameworks.find(f => f.value === fw)?.name || fw;"',
        '    "            console.log(\'\\x1b[32m%s\\x1b[0m\', \'   • \' + name);"',
        '    "        });"',
        '    "        console.log(\'\');"',
        '    "    } else {"',
        '    "        console.log(\'\');"',
        '    "        console.log(\'\\x1b[33m%s\\x1b[0m\', \'⚠️  未选择任何组件，将不进行安装。\');"',
        '    "        console.log(\'\');"',
        '    "    }"',
        '    ""',
        '    "    // Write result to file for PowerShell to read"',
        '    "    const resultFile = process.env.SELECTOR_RESULT_FILE || process.env.USERPROFILE + \'\\\\.witty\\\\.selector_result\';"',
        '    "    fs.writeFileSync(resultFile, selected.join(\',\'));"',
        '    "}"',
        '    ""',
        '    "select().catch(err => {"',
        '    "    console.error(\'Error:\', err);"',
        '    "    process.exit(1);"',
        '    "});"',
        ')',
        '$selectorContent = $selectorLines -join [char]10',
        'Set-Content -Path $SELECTOR_SCRIPT -Value $selectorContent -Encoding UTF8',
        '',
        '# Run the selector interactively',
        '$env:SELECTOR_RESULT_FILE = $SELECTOR_RESULT',
        'Set-Location $wittyDir',
        'npx -y tsx $SELECTOR_SCRIPT',
        '',
        '# Read the selection result from file',
        'if (Test-Path $SELECTOR_RESULT) {',
        '    $SELECTED_FRAMEWORKS = Get-Content $SELECTOR_RESULT',
        '    Remove-Item $SELECTOR_RESULT -Force',
        '} else {',
        '    $SELECTED_FRAMEWORKS = ""',
        '}',
        '',
        '# Set installation flags based on selection',
        '$INSTALL_OPENCODE = $false',
        '$INSTALL_CLAUDE = $false',
        '$INSTALL_OPENCLAW = $false',
        '',
        'if ($SELECTED_FRAMEWORKS -match "opencode") {',
        '    $INSTALL_OPENCODE = $true',
        '}',
        'if ($SELECTED_FRAMEWORKS -match "claude") {',
        '    $INSTALL_CLAUDE = $true',
        '}',
        'if ($SELECTED_FRAMEWORKS -match "openclaw") {',
        '    $INSTALL_OPENCLAW = $true',
        '}',
        '',
        '# Exit if nothing selected',
        'if (-not $INSTALL_OPENCODE -and -not $INSTALL_CLAUDE -and -not $INSTALL_OPENCLAW) {',
        '    Write-Host "⚠️  未选择任何框架组件，将跳过插件安装。"',
        '    Write-Host "   继续执行配置步骤..."',
        '    Write-Host ""',
        '}',
        '',
        '# 3. Download Components',
        'if ($INSTALL_OPENCODE) {',
        '    Write-Host "⏬ Downloading OpenCode Plugin..."',
        '    Invoke-WebRequest -Uri "$WITTY_BASE_URL/api/setup/opencode" -OutFile (Join-Path $opencodePluginsDir "Witty-Skill-Insight.ts")',
        '    ',
        '    Write-Host "⏬ Downloading Skill Sync Tool..."',
        '    Invoke-WebRequest -Uri "$WITTY_BASE_URL/sync_skills.ts" -OutFile (Join-Path $wittyDir "sync_skills.ts")',
        '}',
        '',
        'if ($INSTALL_CLAUDE) {',
        '    Write-Host "⏬ Downloading Claude Code Watcher..."',
        '    Invoke-WebRequest -Uri "$WITTY_BASE_URL/api/setup/claude-watcher" -OutFile (Join-Path $wittyDir "claude_watcher_client.ts")',
        '}',
        '',
        'if ($INSTALL_OPENCLAW) {',
        '    Write-Host "⏬ Downloading OpenClaw Watcher..."',
        '    Invoke-WebRequest -Uri "$WITTY_BASE_URL/api/setup/openclaw-watcher" -OutFile (Join-Path $wittyDir "openclaw_watcher_client.ts")',
        '}',
        '',
        '# 4. Configure ~/.witty/.env (Auto mode - no interaction)',
        '$WITTY_CONFIG_FILE = Join-Path $wittyDir ".env"',
        '',
        'Write-Host "⚙️  Updating configuration..."',
        'if (Test-Path $WITTY_CONFIG_FILE) {',
        '    $existingContent = Get-Content $WITTY_CONFIG_FILE',
        '    $filteredContent = $existingContent | Where-Object { $_ -notmatch "^WITTY_INSIGHT_HOST=" -and $_ -notmatch "^WITTY_INSIGHT_API_KEY=" }',
        '    Set-Content -Path $WITTY_CONFIG_FILE -Value $filteredContent',
        '} else {',
        '    New-Item -ItemType File -Path $WITTY_CONFIG_FILE -Force | Out-Null',
        '}',
        'Add-Content -Path $WITTY_CONFIG_FILE -Value "WITTY_INSIGHT_HOST=$WITTY_HOST"',
        'Add-Content -Path $WITTY_CONFIG_FILE -Value "WITTY_INSIGHT_API_KEY=$WITTY_API_KEY"',
        'Write-Host "✅ Configuration updated at $WITTY_CONFIG_FILE"',
        'Write-Host "   WITTY_INSIGHT_HOST=$WITTY_HOST"',
        'Write-Host "   WITTY_INSIGHT_API_KEY=********"',
        '',
        '# 5. Sync Opencode Skills',
        'if ($INSTALL_OPENCODE) {',
        '    Write-Host ""',
        '    Write-Host "🚀 Syncing Opencode Skills..."',
        '    if (Get-Command npx -ErrorAction SilentlyContinue) {',
        '        npx -y tsx (Join-Path $wittyDir "sync_skills.ts") --agent opencode',
        '    } else {',
        '        Write-Host "⚠️  Node.js (npx) not found. Skipping skill sync."',
        '    }',
        '}',
        '',
        '# 6. Install Watcher Dependencies (only if any watcher is selected)',
        'if ($INSTALL_CLAUDE -or $INSTALL_OPENCLAW) {',
        '    Write-Host ""',
        '    Write-Host "📦 Installing watcher dependencies..."',
        '    if (Get-Command npm -ErrorAction SilentlyContinue) {',
        '        Set-Location $wittyDir',
        '        if (-not (Test-Path "package.json")) {',
        '            \'{"name": "witty-watcher", "version": "1.0.0", "type": "module", "dependencies": {}}\' | Out-File -FilePath "package.json" -Encoding utf8',
        '        }',
        '        npm install chokidar --save 2>$null',
        '        Write-Host "✅ Dependencies installed"',
        '    } else {',
        '        Write-Host "⚠️  npm not found. Skipping dependency installation."',
        '    }',
        '}',
        '',
        '# 7. Create Watcher Startup/Stop Scripts',
        '$NEEDS_WATCHER_SCRIPTS = $INSTALL_CLAUDE -or $INSTALL_OPENCLAW',
        '',
        'if ($NEEDS_WATCHER_SCRIPTS) {',
        '    Write-Host ""',
        '    Write-Host "📝 Creating watcher management scripts..."',
        '',
        '    # Claude Watcher Start Script',
        '    if ($INSTALL_CLAUDE) {',
        '        $startClaudeScript = @\'',
        '# Stop existing watcher if running',
        'Get-Process | Where-Object { $_.CommandLine -like "*claude_watcher_client.ts*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
        '',
        '# Start watcher in background',
        '$wittyDir = Join-Path $env:USERPROFILE ".witty"',
        '$logFile = Join-Path $wittyDir "logs\\claude_watcher.log"',
        '$scriptPath = Join-Path $wittyDir "claude_watcher_client.ts"',
        '',
        'Start-Process -FilePath "npx" -ArgumentList "-y", "tsx", $scriptPath -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $logFile',
        'Write-Host "Claude watcher started"',
        '\'@',
        '        $startClaudePath = Join-Path $wittyDir "start_claude_watcher.ps1"',
        '        Set-Content -Path $startClaudePath -Value $startClaudeScript -Encoding UTF8',
        '        Write-Host "✅ Claude watcher start script created"',
        '',
        '        # Claude Watcher Stop Script',
        '        $stopClaudeScript = @\'',
        'Write-Host "Stopping Claude watcher..."',
        'Get-Process | Where-Object { $_.CommandLine -like "*claude_watcher_client.ts*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
        'Write-Host "Claude watcher stopped"',
        '\'@',
        '        $stopClaudePath = Join-Path $wittyDir "stop_claude_watcher.ps1"',
        '        Set-Content -Path $stopClaudePath -Value $stopClaudeScript -Encoding UTF8',
        '        Write-Host "✅ Claude watcher stop script created"',
        '    }',
        '',
        '    # OpenClaw Watcher Start Script',
        '    if ($INSTALL_OPENCLAW) {',
        '        $startOpenclawScript = @\'',
        '# Stop existing watcher if running',
        'Get-Process | Where-Object { $_.CommandLine -like "*openclaw_watcher_client.ts*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
        '',
        '# Start watcher in background',
        '$wittyDir = Join-Path $env:USERPROFILE ".witty"',
        '$logFile = Join-Path $wittyDir "logs\\openclaw_watcher.log"',
        '$scriptPath = Join-Path $wittyDir "openclaw_watcher_client.ts"',
        '',
        'Start-Process -FilePath "npx" -ArgumentList "-y", "tsx", $scriptPath -NoNewWindow -RedirectStandardOutput $logFile -RedirectStandardError $logFile',
        'Write-Host "OpenClaw watcher started"',
        '\'@',
        '        $startOpenclawPath = Join-Path $wittyDir "start_openclaw_watcher.ps1"',
        '        Set-Content -Path $startOpenclawPath -Value $startOpenclawScript -Encoding UTF8',
        '        Write-Host "✅ OpenClaw watcher start script created"',
        '',
        '        # OpenClaw Watcher Stop Script',
        '        $stopOpenclawScript = @\'',
        'Write-Host "Stopping OpenClaw watcher..."',
        'Get-Process | Where-Object { $_.CommandLine -like "*openclaw_watcher_client.ts*" } | Stop-Process -Force -ErrorAction SilentlyContinue',
        'Write-Host "OpenClaw watcher stopped"',
        '\'@',
        '        $stopOpenclawPath = Join-Path $wittyDir "stop_openclaw_watcher.ps1"',
        '        Set-Content -Path $stopOpenclawPath -Value $stopOpenclawScript -Encoding UTF8',
        '        Write-Host "✅ OpenClaw watcher stop script created"',
        '    }',
        '',
        '    # Combined Start Script',
        '    $startLines = @()',
        '    $startLines += \'Write-Host "Starting Witty-Skill-Insight watchers..."\'',
        '    if ($INSTALL_CLAUDE) {',
        '        $startLines += \'powershell -File "\' + $wittyDir + \'\\start_claude_watcher.ps1"\'',
        '    }',
        '    if ($INSTALL_OPENCLAW) {',
        '        $startLines += \'powershell -File "\' + $wittyDir + \'\\start_openclaw_watcher.ps1"\'',
        '    }',
        '    $startLines += \'Write-Host "All watchers started!"\'',
        '    $startLines -join [char]10 | Set-Content -Path (Join-Path $wittyDir "start_watchers.ps1") -Encoding UTF8',
        '    Write-Host "✅ Combined start script created"',
        '',
        '    # Combined Stop Script',
        '    $stopLines = @()',
        '    $stopLines += \'Write-Host "Stopping Witty-Skill-Insight watchers..."\'',
        '    if ($INSTALL_CLAUDE) {',
        '        $stopLines += \'powershell -File "\' + $wittyDir + \'\\stop_claude_watcher.ps1"\'',
        '    }',
        '    if ($INSTALL_OPENCLAW) {',
        '        $stopLines += \'powershell -File "\' + $wittyDir + \'\\stop_openclaw_watcher.ps1"\'',
        '    }',
        '    $stopLines += \'Write-Host "All watchers stopped!"\'',
        '    $stopLines -join [char]10 | Set-Content -Path (Join-Path $wittyDir "stop_watchers.ps1") -Encoding UTF8',
        '    Write-Host "✅ Combined stop script created"',
        '}',
        '',
        '# 8. Start Watchers Now',
        'if ($NEEDS_WATCHER_SCRIPTS) {',
        '    Write-Host ""',
        '    Write-Host "🚀 Starting telemetry watchers..."',
        '    if (Get-Command npx -ErrorAction SilentlyContinue) {',
        '        & (Join-Path $wittyDir "start_watchers.ps1")',
        '    } else {',
        '        Write-Host "⚠️  Node.js (npx) not found. Skipping watcher startup."',
        '    }',
        '}',
        '',
        '# 9. Configure Claude Code Auto-Sync Wrapper (PowerShell profile)',
        'if ($INSTALL_CLAUDE) {',
        '    Write-Host ""',
        '    Write-Host "🔄 Configuring Claude Code Auto-Sync Wrapper..."',
        '    ',
        '    $claudeWrapper = @\'',
        '',
        '# Witty Insight Claude Alliance',
        'function witty-claude {',
        '    if (Get-Command npx -ErrorAction SilentlyContinue) {',
        '        npx -y tsx "$env:USERPROFILE\\.witty\\sync_skills.ts" --agent claude 2>$null',
        '    }',
        '    claude $args',
        '}',
        'Set-Alias -Name claude -Value witty-claude -Force',
        '\'@',
        '',
        '    $profilePath = $PROFILE',
        '    if (Test-Path $profilePath) {',
        '        $profileContent = Get-Content $profilePath -Raw',
        '        if ($profileContent -notmatch "witty-claude") {',
        '            Add-Content -Path $profilePath -Value $claudeWrapper',
        '            Write-Host "✅ Installed Claude wrapper to $profilePath"',
        '        }',
        '    } else {',
        '        $profileDir = Split-Path $profilePath -Parent',
        '        if (-not (Test-Path $profileDir)) {',
        '            New-Item -ItemType Directory -Path $profileDir -Force | Out-Null',
        '        }',
        '        Set-Content -Path $profilePath -Value $claudeWrapper -Encoding UTF8',
        '        Write-Host "✅ Created PowerShell profile with Claude wrapper at $profilePath"',
        '    }',
        '}',
        '',
        '# 10. Final Summary',
        'Write-Host ""',
        'Write-Host "🌟 Witty-Skill-Insight Telemetry: READY"',
        'Write-Host "------------------------------------------------"',
        'Write-Host "Installed Components:"',
        'if ($INSTALL_OPENCODE) {',
        '    Write-Host "  ✅ OpenCode Plugin: ~/.opencode/plugins/Witty-Skill-Insight.ts"',
        '}',
        'if ($INSTALL_CLAUDE) {',
        '    Write-Host "  ✅ Claude Watcher: ~/.witty/claude_watcher_client.ts"',
        '}',
        'if ($INSTALL_OPENCLAW) {',
        '    Write-Host "  ✅ OpenClaw Watcher: ~/.witty/openclaw_watcher_client.ts"',
        '}',
        '',
        'if ($NEEDS_WATCHER_SCRIPTS) {',
        '    Write-Host ""',
        '    Write-Host "Watcher Management:"',
        '    Write-Host "  Start all:    ~/.witty/start_watchers.ps1"',
        '    Write-Host "  Stop all:     ~/.witty/stop_watchers.ps1"',
        '    if ($INSTALL_CLAUDE) {',
        '        Write-Host "  Start Claude: ~/.witty/start_claude_watcher.ps1"',
        '        Write-Host "  Stop Claude:  ~/.witty/stop_claude_watcher.ps1"',
        '    }',
        '    if ($INSTALL_OPENCLAW) {',
        '        Write-Host "  Start OpenClaw: ~/.witty/start_openclaw_watcher.ps1"',
        '        Write-Host "  Stop OpenClaw:  ~/.witty/stop_openclaw_watcher.ps1"',
        '    }',
        '    Write-Host "  Logs:         ~/.witty/logs/"',
        '}',
        '',
        'Write-Host ""',
        'Write-Host "Usage:"',
        'if ($INSTALL_OPENCODE) {',
        '    Write-Host "  1. Run: opencode run \'hello\'"',
        '}',
        'if ($INSTALL_CLAUDE) {',
        '    Write-Host "  2. Run: claude (restart terminal first)"',
        '}',
        'if ($INSTALL_OPENCLAW) {',
        '    Write-Host "  3. OpenClaw will automatically monitor and upload telemetry"',
        '}',
        'Write-Host "------------------------------------------------"',
    ].join('\n');

    // 加入 UTF-8 BOM (\uFEFF) 以及正确的 Content-Type 防止 PowerShell 中文乱码和解析错误
    return new NextResponse('\uFEFF' + script, {
        headers: {
            'Content-Type': 'application/x-powershell; charset=utf-8',
        },
    });
}