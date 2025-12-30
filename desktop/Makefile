# Makefile - Developer convenience commands for Frugworld Desktop
#
# Usage:
#   make dev              Start development server
#   make build            Build for current platform
#   make build-all        Build for all platforms (requires Docker for cross-compilation)
#   make download-models  Download AI models
#   make clean            Clean build artifacts
#   make release          Build release version with signing
#   make help             Show all available commands

# Configuration
SHELL := /bin/bash
.DEFAULT_GOAL := help
PROJECT_ROOT := $(shell pwd)
DIST_DIR := $(PROJECT_ROOT)/dist
MODELS_DIR := $(PROJECT_ROOT)/models

# Detect OS
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
    OS := macos
endif
ifeq ($(UNAME_S),Linux)
    OS := linux
endif
ifeq ($(findstring MINGW,$(UNAME_S)),MINGW)
    OS := windows
endif
ifeq ($(findstring MSYS,$(UNAME_S)),MSYS)
    OS := windows
endif

# Detect package manager (prefer pnpm if available)
NPM := $(shell command -v pnpm 2>/dev/null || echo npm)

# Colors (only for terminals that support them)
ifneq ($(TERM),)
    BLUE := \033[0;34m
    GREEN := \033[0;32m
    YELLOW := \033[1;33m
    RED := \033[0;31m
    NC := \033[0m
endif

# ==============================================================================
# Development Commands
# ==============================================================================

.PHONY: dev
dev: node_modules ## Start development server with hot reload
	@echo -e "$(BLUE)Starting development server...$(NC)"
	$(NPM) run dev

.PHONY: dev-frontend
dev-frontend: node_modules ## Start only the frontend dev server
	@echo -e "$(BLUE)Starting frontend dev server...$(NC)"
	$(NPM) run dev:frontend

.PHONY: dev-tauri
dev-tauri: node_modules ## Start Tauri in development mode
	@echo -e "$(BLUE)Starting Tauri dev...$(NC)"
	npx tauri dev

# ==============================================================================
# Build Commands
# ==============================================================================

.PHONY: build
build: node_modules ## Build for current platform
	@echo -e "$(BLUE)Building for $(OS)...$(NC)"
	./scripts/build.sh
	@echo -e "$(GREEN)Build complete! Artifacts in $(DIST_DIR)$(NC)"

.PHONY: build-debug
build-debug: node_modules ## Build debug version for current platform
	@echo -e "$(BLUE)Building debug version...$(NC)"
	./scripts/build.sh --debug

.PHONY: build-all
build-all: node_modules ## Build for all platforms (may require Docker)
	@echo -e "$(BLUE)Building for all platforms...$(NC)"
	./scripts/build-all.sh
	@echo -e "$(GREEN)Cross-platform build complete!$(NC)"

.PHONY: build-macos
build-macos: node_modules ## Build for macOS (universal binary)
ifeq ($(OS),macos)
	./scripts/build-all.sh --macos-only
else
	@echo -e "$(RED)macOS builds must be performed on macOS$(NC)"
	@exit 1
endif

.PHONY: build-linux
build-linux: node_modules ## Build for Linux (requires Linux or Docker)
ifeq ($(OS),linux)
	./scripts/build-all.sh --linux-only
else
	@echo -e "$(YELLOW)Cross-compiling for Linux using Docker...$(NC)"
	./scripts/build-all.sh --linux-only --docker
endif

.PHONY: build-windows
build-windows: node_modules ## Build for Windows (requires Windows or Docker)
ifeq ($(OS),windows)
	./scripts/build-all.sh --windows-only
else
	@echo -e "$(YELLOW)Cross-compiling for Windows using Docker...$(NC)"
	./scripts/build-all.sh --windows-only --docker
endif

.PHONY: build-with-models
build-with-models: download-models ## Build with bundled AI models
	@echo -e "$(BLUE)Building with bundled models...$(NC)"
	./scripts/build.sh --with-models

.PHONY: release
release: node_modules ## Build signed release version
	@echo -e "$(BLUE)Building signed release...$(NC)"
	./scripts/build.sh --sign
	@echo -e "$(GREEN)Release build complete!$(NC)"

# ==============================================================================
# Model Management
# ==============================================================================

.PHONY: download-models
download-models: ## Download AI models (LLM and TTS)
	@echo -e "$(BLUE)Downloading AI models...$(NC)"
	./scripts/download-models.sh
	@echo -e "$(GREEN)Models downloaded to $(MODELS_DIR)$(NC)"

.PHONY: download-models-minimal
download-models-minimal: ## Download minimal set of models
	@echo -e "$(BLUE)Downloading minimal models...$(NC)"
	./scripts/download-models.sh --minimal

.PHONY: verify-models
verify-models: ## Verify downloaded models
	@echo -e "$(BLUE)Verifying models...$(NC)"
	./scripts/download-models.sh --verify

.PHONY: clean-models
clean-models: ## Remove downloaded models
	@echo -e "$(YELLOW)Removing downloaded models...$(NC)"
	rm -rf $(MODELS_DIR)/llm/*
	rm -rf $(MODELS_DIR)/tts/*
	@echo -e "$(GREEN)Models removed$(NC)"

# ==============================================================================
# Testing & Linting
# ==============================================================================

.PHONY: test
test: node_modules ## Run all tests
	@echo -e "$(BLUE)Running tests...$(NC)"
	$(NPM) run test
	cd src-tauri && cargo test

.PHONY: test-frontend
test-frontend: node_modules ## Run frontend tests
	$(NPM) run test

.PHONY: test-rust
test-rust: ## Run Rust tests
	cd src-tauri && cargo test

.PHONY: lint
lint: node_modules ## Run all linters
	@echo -e "$(BLUE)Linting code...$(NC)"
	$(NPM) run lint
	cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings

.PHONY: lint-fix
lint-fix: node_modules ## Fix linting issues automatically
	$(NPM) run lint:fix
	cd src-tauri && cargo clippy --fix --allow-dirty

.PHONY: format
format: node_modules ## Format all code
	$(NPM) run format
	cd src-tauri && cargo fmt

.PHONY: format-check
format-check: node_modules ## Check code formatting
	$(NPM) run format:check
	cd src-tauri && cargo fmt --check

.PHONY: typecheck
typecheck: node_modules ## Run TypeScript type checking
	$(NPM) run typecheck

# ==============================================================================
# Dependency Management
# ==============================================================================

node_modules: package.json package-lock.json
	@echo -e "$(BLUE)Installing Node.js dependencies...$(NC)"
	$(NPM) install
	@touch node_modules

.PHONY: install
install: node_modules ## Install all dependencies
	@echo -e "$(BLUE)Installing Rust dependencies...$(NC)"
	cd src-tauri && cargo fetch

.PHONY: update-deps
update-deps: ## Update all dependencies
	@echo -e "$(BLUE)Updating dependencies...$(NC)"
	$(NPM) update
	cd src-tauri && cargo update
	@echo -e "$(GREEN)Dependencies updated$(NC)"

.PHONY: audit
audit: node_modules ## Security audit of dependencies
	@echo -e "$(BLUE)Auditing dependencies...$(NC)"
	$(NPM) audit || true
	cd src-tauri && cargo audit || true

# ==============================================================================
# Cleanup Commands
# ==============================================================================

.PHONY: clean
clean: ## Clean build artifacts
	@echo -e "$(YELLOW)Cleaning build artifacts...$(NC)"
	rm -rf $(DIST_DIR)
	rm -rf node_modules/.vite
	rm -rf src-tauri/target
	@echo -e "$(GREEN)Clean complete$(NC)"

.PHONY: clean-deps
clean-deps: ## Clean all dependencies (full reset)
	@echo -e "$(YELLOW)Removing all dependencies...$(NC)"
	rm -rf node_modules
	rm -rf src-tauri/target
	@echo -e "$(GREEN)Dependencies removed$(NC)"

.PHONY: clean-all
clean-all: clean clean-deps clean-models ## Clean everything (artifacts, deps, models)
	@echo -e "$(GREEN)Full cleanup complete$(NC)"

.PHONY: reset
reset: clean-all install ## Full reset: clean everything and reinstall
	@echo -e "$(GREEN)Reset complete$(NC)"

# ==============================================================================
# Utility Commands
# ==============================================================================

.PHONY: info
info: ## Show project information
	@echo ""
	@echo "Frugworld Desktop"
	@echo "================="
	@echo ""
	@echo "Platform:        $(OS)"
	@echo "Node.js:         $(shell node --version 2>/dev/null || echo 'not installed')"
	@echo "npm/pnpm:        $(NPM) ($(shell $(NPM) --version 2>/dev/null || echo 'not installed'))"
	@echo "Rust:            $(shell rustc --version 2>/dev/null || echo 'not installed')"
	@echo "Cargo:           $(shell cargo --version 2>/dev/null || echo 'not installed')"
	@echo ""
	@echo "Directories:"
	@echo "  Project root:  $(PROJECT_ROOT)"
	@echo "  Dist:          $(DIST_DIR)"
	@echo "  Models:        $(MODELS_DIR)"
	@echo ""

.PHONY: open
open: ## Open the built app (macOS only)
ifeq ($(OS),macos)
	@if [ -d "$(DIST_DIR)/Frugworld.app" ]; then \
		open "$(DIST_DIR)/Frugworld.app"; \
	elif [ -d "src-tauri/target/release/bundle/macos/Frugworld.app" ]; then \
		open "src-tauri/target/release/bundle/macos/Frugworld.app"; \
	else \
		echo -e "$(RED)No built app found. Run 'make build' first.$(NC)"; \
	fi
else
	@echo -e "$(YELLOW)'make open' is only supported on macOS$(NC)"
endif

.PHONY: logs
logs: ## Show Tauri development logs
	@echo -e "$(BLUE)Showing logs...$(NC)"
	@tail -f ~/.tauri/logs/*.log 2>/dev/null || echo "No log files found"

# ==============================================================================
# Help
# ==============================================================================

.PHONY: help
help: ## Show this help message
	@echo ""
	@echo "Frugworld Desktop - Developer Commands"
	@echo "======================================="
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Examples:"
	@echo "  make dev              Start development server"
	@echo "  make build            Build for current platform"
	@echo "  make download-models  Download AI models"
	@echo "  make clean            Clean build artifacts"
	@echo ""
