#!/usr/bin/env bash
#
# build-all.sh - Cross-platform build script for Frugworld Desktop
#
# Builds the application for macOS, Windows, and Linux using cross-compilation
# or native builds on respective platforms.
#
# Usage:
#   ./scripts/build-all.sh                # Build for all platforms
#   ./scripts/build-all.sh --platform X   # Build for specific platform (macos, windows, linux)
#   ./scripts/build-all.sh --macos-only   # Build only macOS (universal binary)
#   ./scripts/build-all.sh --docker       # Use Docker for cross-compilation
#
# Requirements:
#   - Rust with cross-compilation targets installed
#   - For macOS: Xcode Command Line Tools
#   - For Windows: mingw-w64 or Docker
#   - For Linux on macOS: Docker recommended
#
# Note: True cross-compilation for Tauri is complex. For production releases,
# consider using GitHub Actions matrix builds (see .github/workflows/build.yml)

set -euo pipefail

# ------------------------------------------------------------------------------
# Configuration
# ------------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist"

# Target configurations
MACOS_TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin")
WINDOWS_TARGETS=("x86_64-pc-windows-msvc")
LINUX_TARGETS=("x86_64-unknown-linux-gnu")

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Options
PLATFORM="all"
USE_DOCKER=false

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

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --platform)
                PLATFORM="$2"
                shift 2
                ;;
            --macos-only)
                PLATFORM="macos"
                shift
                ;;
            --windows-only)
                PLATFORM="windows"
                shift
                ;;
            --linux-only)
                PLATFORM="linux"
                shift
                ;;
            --docker)
                USE_DOCKER=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo ""
                echo "Options:"
                echo "  --platform PLATFORM  Build for specific platform (macos, windows, linux, all)"
                echo "  --macos-only         Build only for macOS (universal binary)"
                echo "  --windows-only       Build only for Windows"
                echo "  --linux-only         Build only for Linux"
                echo "  --docker             Use Docker for cross-compilation"
                echo "  --help, -h           Show this help message"
                echo ""
                echo "Note: Cross-platform builds are best done via CI/CD."
                echo "See .github/workflows/build.yml for the recommended approach."
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
}

# Detect current platform
detect_platform() {
    case "$(uname -s)" in
        Darwin)
            echo "macos"
            ;;
        Linux)
            echo "linux"
            ;;
        MINGW*|CYGWIN*|MSYS*)
            echo "windows"
            ;;
        *)
            echo "unknown"
            ;;
    esac
}

# ------------------------------------------------------------------------------
# Rust Target Installation
# ------------------------------------------------------------------------------

install_rust_targets() {
    log_info "Installing Rust cross-compilation targets..."

    case "$PLATFORM" in
        macos|all)
            for target in "${MACOS_TARGETS[@]}"; do
                rustup target add "$target" 2>/dev/null || true
            done
            ;;
    esac

    case "$PLATFORM" in
        windows|all)
            for target in "${WINDOWS_TARGETS[@]}"; do
                rustup target add "$target" 2>/dev/null || true
            done
            ;;
    esac

    case "$PLATFORM" in
        linux|all)
            for target in "${LINUX_TARGETS[@]}"; do
                rustup target add "$target" 2>/dev/null || true
            done
            ;;
    esac

    log_success "Rust targets installed"
}

# ------------------------------------------------------------------------------
# Platform-Specific Builds
# ------------------------------------------------------------------------------

build_macos() {
    log_info "Building for macOS..."

    local current_platform
    current_platform=$(detect_platform)

    if [[ "$current_platform" != "macos" ]]; then
        log_error "macOS builds must be performed on macOS"
        log_info "Use GitHub Actions for automated macOS builds"
        return 1
    fi

    cd "${PROJECT_ROOT}"

    # Build universal binary (Apple Silicon + Intel)
    log_info "Building universal macOS binary..."

    # Determine Tauri command
    local tauri_cmd
    if command -v cargo-tauri >/dev/null 2>&1; then
        tauri_cmd="cargo tauri"
    else
        tauri_cmd="npx tauri"
    fi

    # Build for both architectures
    $tauri_cmd build --target universal-apple-darwin

    # Copy artifacts
    local bundle_dir="${PROJECT_ROOT}/src-tauri/target/universal-apple-darwin/release/bundle"
    mkdir -p "${DIST_DIR}/macos"

    if [[ -d "${bundle_dir}/macos" ]]; then
        cp -r "${bundle_dir}/macos"/*.app "${DIST_DIR}/macos/" 2>/dev/null || true
    fi
    if [[ -d "${bundle_dir}/dmg" ]]; then
        cp "${bundle_dir}/dmg"/*.dmg "${DIST_DIR}/macos/" 2>/dev/null || true
    fi

    log_success "macOS build complete"
}

build_windows() {
    log_info "Building for Windows..."

    local current_platform
    current_platform=$(detect_platform)

    if [[ "$USE_DOCKER" == "true" ]] && [[ "$current_platform" != "windows" ]]; then
        build_windows_docker
        return
    fi

    if [[ "$current_platform" != "windows" ]]; then
        log_warn "Windows cross-compilation is limited without Docker"
        log_info "For best results, build on Windows or use GitHub Actions"

        # Attempt cross-compilation with mingw
        if command -v x86_64-w64-mingw32-gcc >/dev/null 2>&1; then
            log_info "Found mingw-w64, attempting cross-compilation..."
            build_windows_cross
        else
            log_error "mingw-w64 not found. Install it or use --docker flag"
            return 1
        fi
    else
        # Native Windows build
        cd "${PROJECT_ROOT}"
        npx tauri build

        local bundle_dir="${PROJECT_ROOT}/src-tauri/target/release/bundle"
        mkdir -p "${DIST_DIR}/windows"

        if [[ -d "${bundle_dir}/msi" ]]; then
            cp "${bundle_dir}/msi"/*.msi "${DIST_DIR}/windows/" 2>/dev/null || true
        fi
        if [[ -d "${bundle_dir}/nsis" ]]; then
            cp "${bundle_dir}/nsis"/*.exe "${DIST_DIR}/windows/" 2>/dev/null || true
        fi
    fi

    log_success "Windows build complete"
}

build_windows_cross() {
    log_info "Cross-compiling for Windows with mingw-w64..."

    cd "${PROJECT_ROOT}"

    # Configure cargo for cross-compilation
    export CC_x86_64_pc_windows_gnu=x86_64-w64-mingw32-gcc
    export CXX_x86_64_pc_windows_gnu=x86_64-w64-mingw32-g++
    export AR_x86_64_pc_windows_gnu=x86_64-w64-mingw32-ar
    export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=x86_64-w64-mingw32-gcc

    npx tauri build --target x86_64-pc-windows-gnu

    local bundle_dir="${PROJECT_ROOT}/src-tauri/target/x86_64-pc-windows-gnu/release/bundle"
    mkdir -p "${DIST_DIR}/windows"

    # Copy artifacts (note: NSIS installer won't work with cross-compilation)
    cp "${PROJECT_ROOT}/src-tauri/target/x86_64-pc-windows-gnu/release"/*.exe \
       "${DIST_DIR}/windows/" 2>/dev/null || true
}

build_windows_docker() {
    log_info "Building Windows target using Docker..."

    # Check for Docker
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker not found. Install Docker to use cross-compilation."
        return 1
    fi

    log_warn "Docker-based Windows cross-compilation is experimental"
    log_info "Consider using GitHub Actions for production Windows builds"

    # Build using a Windows-compatible Docker image
    docker run --rm \
        -v "${PROJECT_ROOT}:/app" \
        -w /app \
        rustlang/rust:nightly \
        bash -c "
            rustup target add x86_64-pc-windows-gnu && \
            apt-get update && apt-get install -y mingw-w64 && \
            cargo build --release --target x86_64-pc-windows-gnu
        "

    mkdir -p "${DIST_DIR}/windows"
    cp "${PROJECT_ROOT}/src-tauri/target/x86_64-pc-windows-gnu/release"/*.exe \
       "${DIST_DIR}/windows/" 2>/dev/null || true
}

build_linux() {
    log_info "Building for Linux..."

    local current_platform
    current_platform=$(detect_platform)

    if [[ "$USE_DOCKER" == "true" ]] && [[ "$current_platform" != "linux" ]]; then
        build_linux_docker
        return
    fi

    if [[ "$current_platform" != "linux" ]]; then
        log_warn "Linux builds are best done on Linux"

        if [[ "$USE_DOCKER" != "true" ]]; then
            log_info "Use --docker flag for Linux cross-compilation"
            log_info "Or use GitHub Actions for automated Linux builds"
            return 1
        fi
    fi

    cd "${PROJECT_ROOT}"

    # Install Linux dependencies
    if command -v apt-get >/dev/null 2>&1; then
        log_info "Installing Linux build dependencies..."
        sudo apt-get update
        sudo apt-get install -y \
            libwebkit2gtk-4.1-dev \
            libappindicator3-dev \
            librsvg2-dev \
            patchelf
    fi

    npx tauri build

    local bundle_dir="${PROJECT_ROOT}/src-tauri/target/release/bundle"
    mkdir -p "${DIST_DIR}/linux"

    if [[ -d "${bundle_dir}/appimage" ]]; then
        cp "${bundle_dir}/appimage"/*.AppImage "${DIST_DIR}/linux/" 2>/dev/null || true
    fi
    if [[ -d "${bundle_dir}/deb" ]]; then
        cp "${bundle_dir}/deb"/*.deb "${DIST_DIR}/linux/" 2>/dev/null || true
    fi
    if [[ -d "${bundle_dir}/rpm" ]]; then
        cp "${bundle_dir}/rpm"/*.rpm "${DIST_DIR}/linux/" 2>/dev/null || true
    fi

    log_success "Linux build complete"
}

build_linux_docker() {
    log_info "Building Linux target using Docker..."

    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker not found. Install Docker to use cross-compilation."
        return 1
    fi

    # Use the official Tauri Docker image for Linux builds
    docker run --rm \
        -v "${PROJECT_ROOT}:/app" \
        -w /app \
        ghcr.io/nicoulaj/tauri:latest \
        bash -c "
            npm ci && \
            npm run build:frontend && \
            npx tauri build
        "

    local bundle_dir="${PROJECT_ROOT}/src-tauri/target/release/bundle"
    mkdir -p "${DIST_DIR}/linux"

    cp "${bundle_dir}/appimage"/*.AppImage "${DIST_DIR}/linux/" 2>/dev/null || true
    cp "${bundle_dir}/deb"/*.deb "${DIST_DIR}/linux/" 2>/dev/null || true
}

# ------------------------------------------------------------------------------
# Main Build Process
# ------------------------------------------------------------------------------

build_frontend_once() {
    log_info "Building frontend..."
    cd "${PROJECT_ROOT}"

    if command -v pnpm >/dev/null 2>&1; then
        pnpm install --frozen-lockfile 2>/dev/null || pnpm install
        pnpm run build:frontend
    else
        npm ci 2>/dev/null || npm install
        npm run build:frontend
    fi

    log_success "Frontend built"
}

print_summary() {
    echo ""
    echo "========================================"
    echo "       Cross-Platform Build Complete"
    echo "========================================"
    echo ""

    log_info "Build artifacts:"
    echo ""

    if [[ -d "${DIST_DIR}/macos" ]]; then
        echo "macOS:"
        ls -lh "${DIST_DIR}/macos" 2>/dev/null || echo "  (no artifacts)"
        echo ""
    fi

    if [[ -d "${DIST_DIR}/windows" ]]; then
        echo "Windows:"
        ls -lh "${DIST_DIR}/windows" 2>/dev/null || echo "  (no artifacts)"
        echo ""
    fi

    if [[ -d "${DIST_DIR}/linux" ]]; then
        echo "Linux:"
        ls -lh "${DIST_DIR}/linux" 2>/dev/null || echo "  (no artifacts)"
        echo ""
    fi

    log_info "For production releases, use GitHub Actions:"
    log_info "  git tag v1.0.0 && git push --tags"
    echo ""
}

main() {
    parse_args "$@"

    echo ""
    echo "========================================"
    echo "  Frugworld Cross-Platform Build"
    echo "========================================"
    echo ""

    # Create dist directory structure
    mkdir -p "${DIST_DIR}"/{macos,windows,linux}

    # Install targets
    install_rust_targets

    # Build frontend once
    build_frontend_once

    # Build for requested platforms
    case "$PLATFORM" in
        macos)
            build_macos
            ;;
        windows)
            build_windows
            ;;
        linux)
            build_linux
            ;;
        all)
            # Build for current platform first, then attempt others
            local current
            current=$(detect_platform)

            case "$current" in
                macos)
                    build_macos
                    [[ "$USE_DOCKER" == "true" ]] && build_linux_docker
                    [[ "$USE_DOCKER" == "true" ]] && build_windows_docker
                    ;;
                linux)
                    build_linux
                    ;;
                windows)
                    build_windows
                    ;;
            esac

            if [[ "$USE_DOCKER" != "true" ]] && [[ "$current" != "all" ]]; then
                log_warn "Only built for $current. Use --docker for cross-platform builds"
                log_info "Recommended: Use GitHub Actions for cross-platform releases"
            fi
            ;;
        *)
            log_error "Unknown platform: $PLATFORM"
            exit 1
            ;;
    esac

    print_summary
}

main "$@"
