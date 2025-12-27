#!/usr/bin/env bash
#
# Frugworld Model Download Script
# Downloads LLM models via Ollama and TTS voices from Hugging Face
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$PROJECT_DIR/models"
TTS_DIR="$MODELS_DIR/tts"
CONFIG_FILE="$MODELS_DIR/models.json"

# Model definitions
LLM_MODELS=(
    "llama3.2:3b"    # Required: Main dialogue model
)
LLM_MODELS_OPTIONAL=(
    "qwen2.5:7b"     # Optional: Blueprint generation
    "phi3:mini"      # Optional: Low-end fallback
)

# TTS voice URLs (Hugging Face)
TTS_BASE_URL="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US"
TTS_VOICES=(
    "lessac/medium/en_US-lessac-medium"
)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Print banner
print_banner() {
    echo ""
    echo "=========================================="
    echo "  Frugworld Model Download Script"
    echo "=========================================="
    echo ""
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check Ollama installation
check_ollama() {
    log_info "Checking Ollama installation..."

    if ! command_exists ollama; then
        log_error "Ollama is not installed!"
        echo ""
        echo "Please install Ollama first:"
        echo ""
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
        echo ""
        return 1
    fi

    log_success "Ollama is installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
    return 0
}

# Check if Ollama service is running
check_ollama_service() {
    log_info "Checking Ollama service..."

    if curl -s --connect-timeout 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
        log_success "Ollama service is running"
        return 0
    else
        log_warn "Ollama service is not running"
        log_info "Attempting to start Ollama..."

        # Try to start Ollama in background
        if [[ "$(uname -s)" == "Darwin" ]]; then
            # macOS: try to open the app
            if [[ -d "/Applications/Ollama.app" ]]; then
                open -a Ollama
                sleep 3
            else
                ollama serve &>/dev/null &
                sleep 2
            fi
        else
            # Linux: start service
            ollama serve &>/dev/null &
            sleep 2
        fi

        # Check again
        if curl -s --connect-timeout 5 http://localhost:11434/api/tags >/dev/null 2>&1; then
            log_success "Ollama service started successfully"
            return 0
        else
            log_error "Could not start Ollama service"
            echo "Please start Ollama manually: ollama serve"
            return 1
        fi
    fi
}

# Get installed Ollama models
get_installed_models() {
    ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' || echo ""
}

# Check if model is installed
is_model_installed() {
    local model="$1"
    local installed
    installed=$(get_installed_models)
    echo "$installed" | grep -q "^${model}$" || echo "$installed" | grep -q "^${model}:"
}

# Download LLM model with progress
download_llm_model() {
    local model="$1"
    local optional="${2:-false}"

    if is_model_installed "$model"; then
        log_success "Model already installed: $model"
        return 0
    fi

    if [[ "$optional" == "true" ]]; then
        log_info "Downloading optional model: $model"
    else
        log_info "Downloading model: $model"
    fi

    if ollama pull "$model"; then
        log_success "Downloaded: $model"
        return 0
    else
        if [[ "$optional" == "true" ]]; then
            log_warn "Failed to download optional model: $model (skipping)"
            return 0
        else
            log_error "Failed to download model: $model"
            return 1
        fi
    fi
}

# Download file with progress bar
download_file() {
    local url="$1"
    local output="$2"
    local description="$3"

    log_info "Downloading: $description"

    # Check if file exists and has content
    if [[ -f "$output" ]] && [[ -s "$output" ]]; then
        log_success "Already exists: $(basename "$output")"
        return 0
    fi

    # Create directory if needed
    mkdir -p "$(dirname "$output")"

    # Download with progress
    if command_exists curl; then
        if curl -L --progress-bar -o "$output" "$url"; then
            log_success "Downloaded: $(basename "$output")"
            return 0
        fi
    elif command_exists wget; then
        if wget --show-progress -q -O "$output" "$url"; then
            log_success "Downloaded: $(basename "$output")"
            return 0
        fi
    else
        log_error "Neither curl nor wget found"
        return 1
    fi

    log_error "Failed to download: $description"
    return 1
}

# Download TTS voices
download_tts_voices() {
    log_info "Downloading TTS voices..."

    mkdir -p "$TTS_DIR"

    local success=0
    local total=${#TTS_VOICES[@]}

    for voice in "${TTS_VOICES[@]}"; do
        local voice_name
        voice_name=$(basename "$voice")
        local onnx_url="${TTS_BASE_URL}/${voice}.onnx"
        local json_url="${TTS_BASE_URL}/${voice}.onnx.json"
        local onnx_file="$TTS_DIR/${voice_name}.onnx"
        local json_file="$TTS_DIR/${voice_name}.onnx.json"

        if download_file "$onnx_url" "$onnx_file" "${voice_name}.onnx"; then
            if download_file "$json_url" "$json_file" "${voice_name}.onnx.json"; then
                ((success++))
            fi
        fi
    done

    if [[ $success -eq $total ]]; then
        log_success "All TTS voices downloaded successfully"
        return 0
    else
        log_warn "Some TTS voices failed to download ($success/$total)"
        return 1
    fi
}

# Verify downloads
verify_downloads() {
    log_info "Verifying downloads..."

    local errors=0

    # Check TTS files
    for voice in "${TTS_VOICES[@]}"; do
        local voice_name
        voice_name=$(basename "$voice")
        local onnx_file="$TTS_DIR/${voice_name}.onnx"
        local json_file="$TTS_DIR/${voice_name}.onnx.json"

        if [[ ! -f "$onnx_file" ]] || [[ ! -s "$onnx_file" ]]; then
            log_error "Missing or empty: $onnx_file"
            ((errors++))
        fi

        if [[ ! -f "$json_file" ]] || [[ ! -s "$json_file" ]]; then
            log_error "Missing or empty: $json_file"
            ((errors++))
        fi
    done

    # Check LLM models
    for model in "${LLM_MODELS[@]}"; do
        if ! is_model_installed "$model"; then
            log_error "Missing LLM model: $model"
            ((errors++))
        fi
    done

    if [[ $errors -eq 0 ]]; then
        log_success "All required models verified"
        return 0
    else
        log_error "Verification failed with $errors errors"
        return 1
    fi
}

# Generate config file with model paths
generate_config() {
    log_info "Generating model configuration..."

    local tts_voice=""
    for voice in "${TTS_VOICES[@]}"; do
        local voice_name
        voice_name=$(basename "$voice")
        if [[ -f "$TTS_DIR/${voice_name}.onnx" ]]; then
            tts_voice="$TTS_DIR/${voice_name}.onnx"
            break
        fi
    done

    local llm_model=""
    for model in "${LLM_MODELS[@]}"; do
        if is_model_installed "$model"; then
            llm_model="$model"
            break
        fi
    done

    cat > "$CONFIG_FILE" << EOF
{
  "version": "1.0",
  "generated": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "llm": {
    "provider": "ollama",
    "model": "$llm_model",
    "endpoint": "http://localhost:11434"
  },
  "tts": {
    "provider": "piper",
    "voice": "$tts_voice",
    "voiceName": "en_US-lessac-medium"
  },
  "paths": {
    "models": "$MODELS_DIR",
    "tts": "$TTS_DIR"
  }
}
EOF

    log_success "Configuration saved to: $CONFIG_FILE"
}

# Show summary
show_summary() {
    echo ""
    echo "=========================================="
    echo "  Download Summary"
    echo "=========================================="
    echo ""

    echo "LLM Models (Ollama):"
    ollama list 2>/dev/null | head -10 || echo "  (could not list models)"
    echo ""

    echo "TTS Voices:"
    if [[ -d "$TTS_DIR" ]]; then
        ls -lh "$TTS_DIR"/*.onnx 2>/dev/null || echo "  (no voices found)"
    else
        echo "  (directory not found)"
    fi
    echo ""

    if [[ -f "$CONFIG_FILE" ]]; then
        echo "Configuration: $CONFIG_FILE"
    fi
    echo ""
}

# Interactive mode - ask about optional models
ask_optional_models() {
    echo ""
    log_info "Optional models available:"
    echo ""
    for model in "${LLM_MODELS_OPTIONAL[@]}"; do
        case "$model" in
            "qwen2.5:7b")
                echo "  - qwen2.5:7b (~4.5GB) - Better reasoning for blueprints"
                ;;
            "phi3:mini")
                echo "  - phi3:mini (~1.5GB) - Fallback for low-end hardware"
                ;;
            *)
                echo "  - $model"
                ;;
        esac
    done
    echo ""

    read -r -p "Download optional models? [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Main execution
main() {
    print_banner

    # Parse arguments
    local skip_optional=false
    local include_optional=false
    local verify_only=false

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --skip-optional)
                skip_optional=true
                shift
                ;;
            --include-optional|--all)
                include_optional=true
                shift
                ;;
            --verify)
                verify_only=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [options]"
                echo ""
                echo "Options:"
                echo "  --skip-optional    Skip optional models (non-interactive)"
                echo "  --include-optional Download all optional models"
                echo "  --all              Same as --include-optional"
                echo "  --verify           Only verify existing downloads"
                echo "  --help, -h         Show this help message"
                echo ""
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    # Verify only mode
    if [[ "$verify_only" == "true" ]]; then
        check_ollama || exit 1
        check_ollama_service || exit 1
        verify_downloads
        exit $?
    fi

    # Check prerequisites
    check_ollama || exit 1
    check_ollama_service || exit 1

    echo ""
    log_info "Starting model downloads..."
    echo ""

    # Download required LLM models
    for model in "${LLM_MODELS[@]}"; do
        download_llm_model "$model" "false" || exit 1
    done

    # Handle optional models
    if [[ "$include_optional" == "true" ]]; then
        for model in "${LLM_MODELS_OPTIONAL[@]}"; do
            download_llm_model "$model" "true"
        done
    elif [[ "$skip_optional" != "true" ]] && [[ -t 0 ]]; then
        # Interactive mode - ask user
        if ask_optional_models; then
            for model in "${LLM_MODELS_OPTIONAL[@]}"; do
                download_llm_model "$model" "true"
            done
        fi
    fi

    # Download TTS voices
    echo ""
    download_tts_voices || log_warn "TTS download had issues, continuing..."

    # Verify and generate config
    echo ""
    verify_downloads
    generate_config

    # Show summary
    show_summary

    echo ""
    log_success "Model setup complete!"
    echo ""
}

# Run main
main "$@"
