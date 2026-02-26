
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
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
mkdir -p "$HOME/.opencode/plugins"
mkdir -p "$HOME/.opencode/skills"
# Also create in current directory for project-specific skills
mkdir -p ".opencode/skills"
echo "📂 Created .opencode/skills in current directory"

# 2. Download Components
echo "⏬ Downloading OpenCode Plugin..."
curl -sSf "$WITTY_BASE_URL/api/setup/opencode" -o "$HOME/.opencode/plugins/Witty-Skill-Insight.ts"

echo "⏬ Downloading Skill Sync Tool..."
curl -sSf "$WITTY_BASE_URL/sync_skills.ts" -o "$HOME/.witty/sync_skills.ts"

# 3. Configure ~/.witty/.env
WITTY_CONFIG_FILE="$HOME/.witty/.env"
EXISTING_KEY=""
EXISTING_HOST=""
if [ -f "\$WITTY_CONFIG_FILE" ]; then
    # match only UNCOMMENTED lines
    EXISTING_KEY=\$(grep '^WITTY_INSIGHT_API_KEY=' "\$WITTY_CONFIG_FILE" | head -n 1 | cut -d'=' -f2-)
    EXISTING_HOST=\$(grep '^WITTY_INSIGHT_HOST=' "\$WITTY_CONFIG_FILE" | head -n 1 | cut -d'=' -f2-)
fi

# -- API Key Logic --
FINAL_KEY="\$EXISTING_KEY"
if [ -n "\$EXISTING_KEY" ]; then
    echo "🔑 Found existing API Key."
    read -p "👉 Use existing key? (y/N, Default: y): " USE_EXISTING < /dev/tty
    if [[ "\$USE_EXISTING" =~ ^[Nn]$ ]]; then
        read -p "👉 Please enter your NEW API Key: " FINAL_KEY < /dev/tty
    fi
else
    echo "🔑 WITTY_INSIGHT_API_KEY is not set."
    read -p "👉 Please enter your API Key: " FINAL_KEY < /dev/tty
fi

# -- Host Logic --
FINAL_HOST="\$WITTY_HOST"
if [ -n "\$EXISTING_HOST" ] && [ "\$EXISTING_HOST" != "\$WITTY_HOST" ]; then
    echo "🌐 Current Host in config: \$EXISTING_HOST"
    echo "🌐 New Host detected: \$WITTY_HOST"
    read -p "👉 Change to new Host? (y/N, Default: y): " CHANGE_HOST < /dev/tty
    if [[ "\$CHANGE_HOST" =~ ^[Nn]$ ]]; then
        FINAL_HOST="\$EXISTING_HOST"
    fi
elif [ -z "\$EXISTING_HOST" ]; then
    FINAL_HOST="\$WITTY_HOST"
fi

if [ -z "\$FINAL_KEY" ]; then
    echo "⚠️  Warning: No API Key provided. Telemetry upload will fail until you set it in \$WITTY_CONFIG_FILE"
fi

echo "⚙️  Updating configuration..."
touch "\$WITTY_CONFIG_FILE"
# Preserve existing content, only update specific keys
cp "\$WITTY_CONFIG_FILE" "\${WITTY_CONFIG_FILE}.bak"
grep -v "^WITTY_INSIGHT_HOST=" "\${WITTY_CONFIG_FILE}.bak" | grep -v "^WITTY_INSIGHT_API_KEY=" > "\$WITTY_CONFIG_FILE"
echo "WITTY_INSIGHT_HOST=\$FINAL_HOST" >> "\$WITTY_CONFIG_FILE"
echo "WITTY_INSIGHT_API_KEY=\$FINAL_KEY" >> "\$WITTY_CONFIG_FILE"
rm "\${WITTY_CONFIG_FILE}.bak"
echo "✅ Configuration updated at \$WITTY_CONFIG_FILE"

echo ""
echo "🚀 Syncing Opencode Skills..."
if command -v npx &> /dev/null; then
  npx -y tsx "$HOME/.witty/sync_skills.ts" --agent opencode
else
  echo "⚠️  Node.js (npx) not found. Skipping skill sync."
fi

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
echo "1. Run: opencode run 'hello'"
echo "2. Run: claude (Please restart your terminal or run 'source ~/.zshrc' / '.bashrc' first to enable auto-sync)"
echo "------------------------------------------------"
`;

    return new NextResponse(script, {
        headers: {
            'Content-Type': 'text/x-shellscript',
        },
    });
}
