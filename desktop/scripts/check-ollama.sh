#!/usr/bin/env bash
#
# Frugworld Ollama Status Check Script
# Checks Ollama installation, service status, and available models
#
# Exit codes:
#   0 - Ollama installed, running, and has required models
#   1 - Ollama not installed
#   2 - Ollama installed but service not running
#   3 - Ollama running but missing required models
#

set -uo pipefail

# Configuration
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://localhost:11434}"
REQUIRED_MODELS=("llama3.2:3b")

# Output format: "text" (default), "json", or "quiet"
OUTPUT_FORMAT="${1:-text}"

# Colors (only for text output)
if [[ "$OUTPUT_FORMAT" == "text" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    NC=''
fi

# Status tracking
OLLAMA_INSTALLED=false
OLLAMA_RUNNING=false
OLLAMA_VERSION=""
MODELS_AVAILABLE=()
MISSING_MODELS=()

# Check if Ollama is installed
check_installed() {
    if command -v ollama >/dev/null 2>&1; then
        OLLAMA_INSTALLED=true
        OLLAMA_VERSION=$(ollama --version 2>/dev/null | head -1 || echo "unknown")
        return 0
    fi
    return 1
}

# Check if Ollama service is running
check_service() {
    if curl -s --connect-timeout 2 "${OLLAMA_ENDPOINT}/api/tags" >/dev/null 2>&1; then
        OLLAMA_RUNNING=true
        return 0
    fi
    return 1
}

# Get list of available models
get_models() {
    local models_json
    models_json=$(curl -s --connect-timeout 5 "${OLLAMA_ENDPOINT}/api/tags" 2>/dev/null)

    if [[ -n "$models_json" ]]; then
        # Parse JSON to extract model names
        if command -v jq >/dev/null 2>&1; then
            mapfile -t MODELS_AVAILABLE < <(echo "$models_json" | jq -r '.models[].name' 2>/dev/null)
        else
            # Fallback: use grep/sed for basic parsing
            mapfile -t MODELS_AVAILABLE < <(echo "$models_json" | grep -o '"name":"[^"]*"' | sed 's/"name":"//;s/"//')
        fi
    fi
}

# Check if a specific model is available
model_exists() {
    local model="$1"
    for m in "${MODELS_AVAILABLE[@]}"; do
        # Check exact match or model:tag format
        if [[ "$m" == "$model" ]] || [[ "$m" == "${model}:latest" ]] || [[ "$m" == "${model}:"* ]]; then
            return 0
        fi
    done
    return 1
}

# Check required models
check_required_models() {
    MISSING_MODELS=()
    for model in "${REQUIRED_MODELS[@]}"; do
        if ! model_exists "$model"; then
            MISSING_MODELS+=("$model")
        fi
    done

    [[ ${#MISSING_MODELS[@]} -eq 0 ]]
}

# Output in JSON format
output_json() {
    local status="$1"
    local message="$2"

    # Build models array
    local models_json="[]"
    if [[ ${#MODELS_AVAILABLE[@]} -gt 0 ]]; then
        models_json=$(printf '%s\n' "${MODELS_AVAILABLE[@]}" | jq -R . | jq -s .)
    fi

    # Build missing models array
    local missing_json="[]"
    if [[ ${#MISSING_MODELS[@]} -gt 0 ]]; then
        missing_json=$(printf '%s\n' "${MISSING_MODELS[@]}" | jq -R . | jq -s .)
    fi

    # Use jq if available, otherwise manual JSON
    if command -v jq >/dev/null 2>&1; then
        jq -n \
            --arg status "$status" \
            --arg message "$message" \
            --argjson installed "$OLLAMA_INSTALLED" \
            --argjson running "$OLLAMA_RUNNING" \
            --arg version "$OLLAMA_VERSION" \
            --arg endpoint "$OLLAMA_ENDPOINT" \
            --argjson models "$models_json" \
            --argjson missing "$missing_json" \
            '{
                status: $status,
                message: $message,
                ollama: {
                    installed: $installed,
                    running: $running,
                    version: $version,
                    endpoint: $endpoint
                },
                models: {
                    available: $models,
                    missing: $missing
                }
            }'
    else
        # Fallback manual JSON
        cat <<EOF
{
  "status": "$status",
  "message": "$message",
  "ollama": {
    "installed": $OLLAMA_INSTALLED,
    "running": $OLLAMA_RUNNING,
    "version": "$OLLAMA_VERSION",
    "endpoint": "$OLLAMA_ENDPOINT"
  },
  "models": {
    "available": $models_json,
    "missing": $missing_json
  }
}
EOF
    fi
}

# Output in text format
output_text() {
    local status="$1"
    local message="$2"
    local exit_code="$3"

    echo ""
    echo "Ollama Status Check"
    echo "==================="
    echo ""

    # Installation status
    if [[ "$OLLAMA_INSTALLED" == "true" ]]; then
        echo -e "${GREEN}[OK]${NC} Ollama installed: $OLLAMA_VERSION"
    else
        echo -e "${RED}[FAIL]${NC} Ollama not installed"
    fi

    # Service status
    if [[ "$OLLAMA_RUNNING" == "true" ]]; then
        echo -e "${GREEN}[OK]${NC} Ollama service running at $OLLAMA_ENDPOINT"
    elif [[ "$OLLAMA_INSTALLED" == "true" ]]; then
        echo -e "${RED}[FAIL]${NC} Ollama service not running"
    fi

    # Models
    if [[ "$OLLAMA_RUNNING" == "true" ]]; then
        echo ""
        echo "Available Models:"
        if [[ ${#MODELS_AVAILABLE[@]} -gt 0 ]]; then
            for model in "${MODELS_AVAILABLE[@]}"; do
                echo "  - $model"
            done
        else
            echo "  (none)"
        fi

        echo ""
        echo "Required Models:"
        for model in "${REQUIRED_MODELS[@]}"; do
            if model_exists "$model"; then
                echo -e "  ${GREEN}[OK]${NC} $model"
            else
                echo -e "  ${RED}[MISSING]${NC} $model"
            fi
        done
    fi

    echo ""
    case "$exit_code" in
        0)
            echo -e "${GREEN}Status: Ready${NC}"
            ;;
        1)
            echo -e "${RED}Status: Ollama not installed${NC}"
            echo ""
            echo "Install Ollama:"
            case "$(uname -s)" in
                Darwin)
                    echo "  brew install ollama"
                    echo "  # or download from https://ollama.ai/download"
                    ;;
                Linux)
                    echo "  curl -fsSL https://ollama.ai/install.sh | sh"
                    ;;
                *)
                    echo "  Download from https://ollama.ai/download"
                    ;;
            esac
            ;;
        2)
            echo -e "${YELLOW}Status: Service not running${NC}"
            echo ""
            echo "Start Ollama:"
            echo "  ollama serve"
            ;;
        3)
            echo -e "${YELLOW}Status: Missing models${NC}"
            echo ""
            echo "Download missing models:"
            for model in "${MISSING_MODELS[@]}"; do
                echo "  ollama pull $model"
            done
            ;;
    esac
    echo ""
}

# Main execution
main() {
    # Check installation
    check_installed

    if [[ "$OLLAMA_INSTALLED" != "true" ]]; then
        if [[ "$OUTPUT_FORMAT" == "json" ]]; then
            output_json "error" "Ollama is not installed"
        elif [[ "$OUTPUT_FORMAT" != "quiet" ]]; then
            output_text "error" "Ollama is not installed" 1
        fi
        exit 1
    fi

    # Check service
    check_service

    if [[ "$OLLAMA_RUNNING" != "true" ]]; then
        if [[ "$OUTPUT_FORMAT" == "json" ]]; then
            output_json "error" "Ollama service is not running"
        elif [[ "$OUTPUT_FORMAT" != "quiet" ]]; then
            output_text "error" "Ollama service is not running" 2
        fi
        exit 2
    fi

    # Get available models
    get_models

    # Check required models
    if ! check_required_models; then
        if [[ "$OUTPUT_FORMAT" == "json" ]]; then
            output_json "warning" "Missing required models"
        elif [[ "$OUTPUT_FORMAT" != "quiet" ]]; then
            output_text "warning" "Missing required models" 3
        fi
        exit 3
    fi

    # All checks passed
    if [[ "$OUTPUT_FORMAT" == "json" ]]; then
        output_json "ok" "Ollama is ready"
    elif [[ "$OUTPUT_FORMAT" != "quiet" ]]; then
        output_text "ok" "Ollama is ready" 0
    fi

    exit 0
}

# Show help
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    echo "Usage: $0 [format]"
    echo ""
    echo "Check Ollama installation and service status."
    echo ""
    echo "Format options:"
    echo "  text   Human-readable output (default)"
    echo "  json   JSON output for automation"
    echo "  quiet  No output, exit code only"
    echo ""
    echo "Exit codes:"
    echo "  0  Ollama installed, running, and has required models"
    echo "  1  Ollama not installed"
    echo "  2  Ollama installed but service not running"
    echo "  3  Ollama running but missing required models"
    echo ""
    echo "Environment variables:"
    echo "  OLLAMA_ENDPOINT  Ollama API endpoint (default: http://localhost:11434)"
    echo ""
    exit 0
fi

main "$@"
