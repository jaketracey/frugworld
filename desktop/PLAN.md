# Frugworld Desktop App Plan

## Overview

Self-contained desktop application that bundles the Frugworld game client, AI service, and local models into a single executable for fully offline play.

## Architecture

```
desktop/
├── src-tauri/              # Rust Tauri backend
│   ├── src/
│   │   ├── main.rs         # Tauri entry point
│   │   ├── ai_runtime.rs   # AI service integration
│   │   ├── commands.rs     # Tauri IPC commands
│   │   └── config.rs       # Desktop config management
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/                    # Frontend (Vite + existing client)
│   └── main.ts             # Desktop-specific entry
├── models/                 # Bundled AI models (Git LFS)
│   ├── llm/
│   │   └── .gitkeep        # Models downloaded on first run
│   ├── tts/
│   │   └── .gitkeep
│   └── README.md           # Model download instructions
├── scripts/
│   ├── download-models.sh  # Model download script
│   └── build.sh            # Production build script
├── package.json
├── vite.config.ts
└── PLAN.md
```

## Components

### 1. Tauri Backend (Rust)

**File: `src-tauri/src/main.rs`**
- Initialize Tauri application
- Set up system tray (optional)
- Handle window management
- Start embedded AI runtime

**File: `src-tauri/src/ai_runtime.rs`**
- Spawn Node.js child process with ai-service
- Manage AI service lifecycle
- Handle process cleanup on exit

**File: `src-tauri/src/commands.rs`**
- `get_ai_status` - Check if AI is ready
- `get_model_status` - Check downloaded models
- `download_model` - Trigger model download
- `get_config` - Get app configuration
- `set_config` - Update configuration

**File: `src-tauri/src/config.rs`**
- Persistent config storage
- Model paths configuration
- Provider preferences

### 2. Frontend Integration

**File: `src/main.ts`**
- Detect if running in Tauri vs browser
- Use Tauri IPC for AI commands when available
- Fall back to HTTP API for browser mode

**File: `vite.config.ts`**
- Configure for Tauri build
- Handle asset bundling
- Development server setup

### 3. Model Management

**File: `models/README.md`**
- Instructions for downloading models
- Recommended models list
- Storage requirements

**File: `scripts/download-models.sh`**
- Download LLM models (Ollama format or GGUF)
- Download Piper TTS voices
- Verify checksums

### 4. Build Configuration

**File: `src-tauri/tauri.conf.json`**
```json
{
  "build": {
    "distDir": "../dist",
    "devPath": "http://localhost:5173"
  },
  "package": {
    "productName": "Frugworld",
    "version": "0.1.0"
  },
  "tauri": {
    "bundle": {
      "active": true,
      "targets": ["dmg", "app", "msi", "appimage"],
      "identifier": "com.frugworld.app",
      "resources": ["models/*"]
    }
  }
}
```

**File: `package.json`**
```json
{
  "name": "frugworld-desktop",
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "download-models": "./scripts/download-models.sh"
  }
}
```

## Implementation Tasks

### Task 1: Tauri Project Setup
- Initialize Tauri project structure
- Configure Cargo.toml with dependencies
- Set up tauri.conf.json
- Create main.rs entry point

### Task 2: AI Runtime Integration
- Create ai_runtime.rs for Node.js spawning
- Implement commands.rs for IPC
- Handle graceful shutdown
- Manage AI service lifecycle

### Task 3: Frontend Desktop Entry
- Create desktop-specific Vite config
- Add Tauri detection and IPC calls
- Handle offline mode detection
- Create model status UI components

### Task 4: Model Management Scripts
- Create download-models.sh script
- Add model verification
- Create models README with instructions
- Set up Git LFS for model storage

### Task 5: Build Scripts
- Create production build script
- Configure code signing (optional)
- Set up CI/CD for releases
- Test cross-platform builds

## Dependencies

### Rust (Cargo.toml)
```toml
[dependencies]
tauri = { version = "2.0", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1.0", features = ["process", "fs"] }
dirs = "5.0"
```

### Node.js (package.json)
```json
{
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@tauri-apps/api": "^2.0.0",
    "vite": "^5.0.0"
  }
}
```

## Model Recommendations

### LLM Models (via Ollama)
- **Dialogue**: `llama3.2:3b` (~2GB) - Fast responses
- **Blueprint**: `qwen2.5:7b` (~4GB) - Better reasoning
- **Minimal**: `phi3:mini` (~1.5GB) - Low-end hardware

### TTS Models (Piper)
- **Default**: `en_US-lessac-medium.onnx` (~100MB)
- **Alternative**: `en_US-amy-medium.onnx` (~100MB)

### Image Generation (Optional)
- **Fast**: SD-Turbo via ComfyUI (~1.5GB)
- Note: Can be disabled for smaller bundle

## First Run Experience

1. App launches with loading screen
2. Checks for Ollama installation
3. If not found, prompts to install or use bundled
4. Downloads required models (shows progress)
5. Once ready, launches game client
6. AI service runs embedded, no external deps needed

## Platform Notes

### macOS
- Universal binary (Intel + Apple Silicon)
- Notarization for distribution
- .app bundle with models in Resources

### Windows
- MSI installer with model download option
- Portable .exe option (smaller, downloads models)
- Windows Defender exclusion may be needed

### Linux
- AppImage for portability
- .deb/.rpm for package managers
- Flatpak support (future)
