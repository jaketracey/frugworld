#!/usr/bin/env bash
#
# build.sh - Production build script for Frugworld Desktop
#
# Builds the frontend with Vite, then builds the Tauri app for the current platform.
# Optionally packages AI models into the bundle.
#
# Usage:
#   ./scripts/build.sh                    # Build without models
#   ./scripts/build.sh --with-models      # Build with bundled models
#   ./scripts/build.sh --debug            # Build debug version
#   ./scripts/build.sh --sign             # Build and sign (requires certificates)
#
# Environment variables:
#   TAURI_SIGNING_PRIVATE_KEY  - Private key for signing (base64 encoded)
#   TAURI_SIGNING_PRIVATE_KEY_PASSWORD - Password for the private key
#   APPLE_CERTIFICATE          - macOS code signing certificate (base64)
#   APPLE_CERTIFICATE_PASSWORD - Password for the certificate
#   APPLE_SIGNING_IDENTITY     - Certificate identity (e.g., "Developer ID Application: ...")
#   APPLE_ID                   - Apple ID for notarization
#   APPLE_PASSWORD             - App-specific password for notarization
#   APPLE_TEAM_ID              - Apple Developer Team ID

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist"
MODELS_DIR="${PROJECT_ROOT}/models"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default options
WITH_MODELS=false
DEBUG_BUILD=false
SIGN_BUILD=false

# ------------------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --with-models)
                WITH_MODELS=true
                shift
                ;;
            --debug)
                DEBUG_BUILD=true
                shift
                ;;
            --sign)
                SIGN_BUILD=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --with-models   Include AI models in the bundle"
                echo "  --debug         Build debug version instead of release"
                echo "  --sign          Sign the application (requires certificates)"
                echo "  --help, -h      Show this help message"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# ------------------------------------------------------------------------------
# Prerequisite Checks
# ------------------------------------------------------------------------------

check_prerequisites() {
    log_info "Checking prerequisites..."

    local missing_deps=()

    # Check Node.js
    if ! command_exists node; then
        missing_deps+=("node")
    else
        local node_version
        node_version=$(node --version | sed 's/v//' | cut -d. -f1)
        if [[ $node_version -lt 20 ]]; then
            log_error "Node.js 20+ required, found $(node --version)"
            exit 1
        fi
    fi

    # Check npm or pnpm
    if ! command_exists npm && ! command_exists pnpm; then
        missing_deps+=("npm or pnpm")
    fi

    # Check Rust/Cargo
    if ! command_exists cargo; then
        missing_deps+=("cargo (Rust)")
    fi

    # Check Tauri CLI
    if ! command_exists cargo-tauri && ! npx tauri --version >/dev/null 2>&1; then
        log_warn "Tauri CLI not found globally, will use npx"
    fi

    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        exit 1
    fi

    log_success "All prerequisites satisfied"
}

# ------------------------------------------------------------------------------
# Build Steps
# ------------------------------------------------------------------------------

# Install Node.js dependencies
install_dependencies() {
    log_info "Installing Node.js dependencies..."
    cd "${PROJECT_ROOT}"

    if command_exists pnpm; then
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
    else
        npm ci 2>/dev/null || npm install
    fi

    log_success "Dependencies installed"
}

# Build the frontend with Vite
build_frontend() {
    log_info "Building frontend with Vite..."
    cd "${PROJECT_ROOT}"

    if command_exists pnpm; then
        pnpm run build:frontend
    else
        npm run build:frontend
    fi

    log_success "Frontend built successfully"
}

# Build the Tauri application
build_tauri() {
    log_info "Building Tauri application..."
    cd "${PROJECT_ROOT}"

    local tauri_args=()

    # Add debug flag if requested
    if [[ "$DEBUG_BUILD" == "true" ]]; then
        tauri_args+=("--debug")
    fi

    # Set up signing environment for macOS
    if [[ "$SIGN_BUILD" == "true" ]]; then
        setup_signing
    fi

    # Determine Tauri command
    local tauri_cmd
    if command_exists cargo-tauri; then
        tauri_cmd="cargo tauri"
    else
        tauri_cmd="npx tauri"
    fi

    # Run the build
    $tauri_cmd build "${tauri_args[@]}"

    log_success "Tauri build completed"
}

# Set up code signing based on platform
setup_signing() {
    log_info "Setting up code signing..."

    case "$(uname -s)" in
        Darwin)
            setup_macos_signing
            ;;
        Linux)
            log_info "Linux builds do not require code signing"
            ;;
        MINGW*|CYGWIN*|MSYS*)
            setup_windows_signing
            ;;
        *)
            log_warn "Unknown platform, skipping signing setup"
            ;;
    esac
}

# Set up macOS code signing and notarization
setup_macos_signing() {
    if [[ -z "${APPLE_CERTIFICATE:-}" ]]; then
        log_warn "APPLE_CERTIFICATE not set, skipping macOS signing"
        return
    fi

    log_info "Setting up macOS code signing..."

    # Create temporary keychain
    local keychain_path
    keychain_path=$(mktemp -d)/build.keychain-db
    local keychain_password
    keychain_password=$(openssl rand -base64 32)

    security create-keychain -p "$keychain_password" "$keychain_path"
    security set-keychain-settings -lut 21600 "$keychain_path"
    security unlock-keychain -p "$keychain_password" "$keychain_path"

    # Import certificate
    echo "$APPLE_CERTIFICATE" | base64 --decode > /tmp/certificate.p12
    security import /tmp/certificate.p12 -P "${APPLE_CERTIFICATE_PASSWORD:-}" \
        -A -t cert -f pkcs12 -k "$keychain_path"
    rm /tmp/certificate.p12

    # Set keychain as default
    security list-keychain -d user -s "$keychain_path"

    # Export signing identity for Tauri
    if [[ -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
        export APPLE_SIGNING_IDENTITY
    fi

    # Set up notarization credentials
    if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]; then
        export APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
        log_info "Notarization credentials configured"
    else
        log_warn "Notarization credentials not fully set, app will be signed but not notarized"
    fi

    log_success "macOS signing configured"
}

# Set up Windows code signing
setup_windows_signing() {
    if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
        log_warn "TAURI_SIGNING_PRIVATE_KEY not set, skipping Windows signing"
        return
    fi

    log_info "Windows signing configured via environment variables"
    export TAURI_SIGNING_PRIVATE_KEY
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
}

# Copy models to the bundle (optional)
package_models() {
    if [[ "$WITH_MODELS" != "true" ]]; then
        return
    fi

    log_info "Packaging AI models..."

    if [[ ! -d "${MODELS_DIR}/llm" ]] || [[ -z "$(ls -A "${MODELS_DIR}/llm" 2>/dev/null)" ]]; then
        log_warn "No LLM models found in ${MODELS_DIR}/llm"
        log_info "Run 'make download-models' first to download models"
    fi

    if [[ ! -d "${MODELS_DIR}/tts" ]] || [[ -z "$(ls -A "${MODELS_DIR}/tts" 2>/dev/null)" ]]; then
        log_warn "No TTS models found in ${MODELS_DIR}/tts"
    fi

    log_success "Models packaged"
}

# Collect build artifacts
collect_artifacts() {
    log_info "Collecting build artifacts..."

    local tauri_target_dir="${PROJECT_ROOT}/src-tauri/target"
    local bundle_dir

    if [[ "$DEBUG_BUILD" == "true" ]]; then
        bundle_dir="${tauri_target_dir}/debug/bundle"
    else
        bundle_dir="${tauri_target_dir}/release/bundle"
    fi

    # Create dist directory
    mkdir -p "${DIST_DIR}"

    # Copy platform-specific artifacts
    case "$(uname -s)" in
        Darwin)
            # Copy .app and .dmg
            if [[ -d "${bundle_dir}/macos" ]]; then
                cp -r "${bundle_dir}/macos"/*.app "${DIST_DIR}/" 2>/dev/null || true
            fi
            if [[ -d "${bundle_dir}/dmg" ]]; then
                cp "${bundle_dir}/dmg"/*.dmg "${DIST_DIR}/" 2>/dev/null || true
            fi
            ;;
        Linux)
            # Copy AppImage and .deb
            if [[ -d "${bundle_dir}/appimage" ]]; then
                cp "${bundle_dir}/appimage"/*.AppImage "${DIST_DIR}/" 2>/dev/null || true
            fi
            if [[ -d "${bundle_dir}/deb" ]]; then
                cp "${bundle_dir}/deb"/*.deb "${DIST_DIR}/" 2>/dev/null || true
            fi
            ;;
        MINGW*|CYGWIN*|MSYS*)
            # Copy .msi and .exe
            if [[ -d "${bundle_dir}/msi" ]]; then
                cp "${bundle_dir}/msi"/*.msi "${DIST_DIR}/" 2>/dev/null || true
            fi
            if [[ -d "${bundle_dir}/nsis" ]]; then
                cp "${bundle_dir}/nsis"/*.exe "${DIST_DIR}/" 2>/dev/null || true
            fi
            ;;
    esac

    log_success "Artifacts collected in ${DIST_DIR}"
}

# Print build summary
print_summary() {
    echo ""
    echo "========================================"
    echo "         Build Complete"
    echo "========================================"
    echo ""
    log_info "Platform: $(uname -s) ($(uname -m))"
    log_info "Build type: $(if [[ "$DEBUG_BUILD" == "true" ]]; then echo "Debug"; else echo "Release"; fi)"
    log_info "Models included: $WITH_MODELS"
    log_info "Signed: $SIGN_BUILD"
    echo ""
    log_info "Artifacts:"
    ls -lh "${DIST_DIR}" 2>/dev/null || log_warn "No artifacts found in ${DIST_DIR}"
    echo ""
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------

main() {
    parse_args "$@"

    echo ""
    echo "========================================"
    echo "    Frugworld Desktop Build Script"
    echo "========================================"
    echo ""

    check_prerequisites
    install_dependencies
    build_frontend
    package_models
    build_tauri
    collect_artifacts
    print_summary
}

main "$@"
