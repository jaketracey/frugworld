#!/bin/bash
#
# Dev server script - starts SpacetimeDB, AI server, and Vite client in tmux panes
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SESSION_NAME="frugworld-dev"

# Check if tmux is installed
if ! command -v tmux &> /dev/null; then
    echo "Error: tmux is required. Install with: brew install tmux"
    exit 1
fi

# Kill existing session if it exists
tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true

# Clean up any existing SpacetimeDB
pkill -f spacetimedb-standalone 2>/dev/null || true
rm -f ~/.local/share/spacetime/data/spacetime.pid 2>/dev/null || true
sleep 1

# Create new tmux session - this creates pane %0
tmux new-session -d -s "$SESSION_NAME" -n "dev"

# Get the first pane ID
PANE_STDB=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_id}' | head -1)

# Split right for AI server
tmux split-window -h -t "$PANE_STDB"
PANE_AI=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_id}' | tail -1)

# Split STDB pane down for Vite
tmux split-window -v -t "$PANE_STDB"
PANE_VITE=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_id}' | grep -v "$PANE_STDB" | grep -v "$PANE_AI" | head -1)

# Split AI pane down for Commands
tmux split-window -v -t "$PANE_AI"
PANE_CMD=$(tmux list-panes -t "$SESSION_NAME" -F '#{pane_id}' | tail -1)

# Configure pane titles
tmux select-pane -t "$PANE_STDB" -T "SpacetimeDB"
tmux select-pane -t "$PANE_AI" -T "AI Server"
tmux select-pane -t "$PANE_VITE" -T "Vite"
tmux select-pane -t "$PANE_CMD" -T "Commands"

# Enable pane border status
tmux set-option -t "$SESSION_NAME" pane-border-status top
tmux set-option -t "$SESSION_NAME" pane-border-format " #{pane_title} "

# Send commands to each pane
tmux send-keys -t "$PANE_STDB" "clear && echo '=== SpacetimeDB ===' && ~/.local/bin/spacetime start" Enter
tmux send-keys -t "$PANE_VITE" "clear && echo '=== Vite Client ===' && cd '$PROJECT_ROOT/client' && npm run dev" Enter
tmux send-keys -t "$PANE_AI" "sleep 5 && clear && echo '=== AI Server ===' && cd '$PROJECT_ROOT/ai-service' && npm start" Enter
tmux send-keys -t "$PANE_CMD" "sleep 4 && clear && echo '=== Publishing ===' && cd '$PROJECT_ROOT/server' && ~/.local/bin/spacetime publish frugworld --server local -y && echo '' && echo '✓ Published!' && echo 'Type commands here (e.g., spacetime logs frugworld -f)'" Enter

# Select SpacetimeDB pane
tmux select-pane -t "$PANE_STDB"

# Attach to session
tmux attach-session -t "$SESSION_NAME"
