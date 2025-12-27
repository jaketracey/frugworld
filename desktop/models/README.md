# Frugworld AI Models

This directory contains the AI models required for offline play. Models are downloaded on first run or can be pre-downloaded using the provided scripts.

## Storage Requirements

| Setup | Size | Description |
|-------|------|-------------|
| Minimal | ~3 GB | phi3:mini + TTS voice |
| Recommended | ~5 GB | llama3.2:3b + TTS voice |
| Full | ~10 GB | All models including blueprint generation |

## Recommended Models

### LLM Models (via Ollama)

Frugworld uses Ollama to manage LLM models. Models are stored in Ollama's default location and accessed via its API.

| Model | Size | Purpose | Hardware |
|-------|------|---------|----------|
| `llama3.2:3b` | ~2 GB | NPC dialogue, general chat | 8GB+ RAM |
| `qwen2.5:7b` | ~4.5 GB | Blueprint/structure generation | 16GB+ RAM |
| `phi3:mini` | ~1.5 GB | Fallback for low-end systems | 4GB+ RAM |

#### Model Details

**llama3.2:3b** (Recommended for dialogue)
- Best balance of speed and quality
- Good for real-time NPC conversations
- Works well on most modern hardware

**qwen2.5:7b** (Optional, for blueprints)
- Better reasoning and structured output
- Recommended for generating game blueprints
- Requires more RAM and is slower

**phi3:mini** (Low-end fallback)
- Smallest model with acceptable quality
- For systems with limited RAM
- Faster but less capable responses

### TTS Models (Piper)

Text-to-speech voices for NPC dialogue. Uses ONNX format for cross-platform compatibility.

| Voice | Size | Description |
|-------|------|-------------|
| `en_US-lessac-medium` | ~100 MB | Default voice, clear and natural |
| `en_US-amy-medium` | ~100 MB | Alternative female voice |

## Directory Structure

```
models/
├── llm/           # LLM model files (if using GGUF directly)
│   └── .gitkeep
├── tts/           # Piper TTS voice files
│   ├── en_US-lessac-medium.onnx
│   └── en_US-lessac-medium.onnx.json
└── README.md
```

## Download Instructions

### Automatic Download (Recommended)

Run the download script from the desktop directory:

```bash
# macOS / Linux
./scripts/download-models.sh

# Windows (PowerShell)
.\scripts\download-models.ps1
```

### Manual Download

#### 1. Install Ollama

**macOS:**
```bash
brew install ollama
# or download from https://ollama.ai/download
```

**Linux:**
```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

**Windows:**
Download and install from https://ollama.ai/download

#### 2. Start Ollama Service

```bash
ollama serve
```

#### 3. Download LLM Models

```bash
# Required - main dialogue model
ollama pull llama3.2:3b

# Optional - blueprint generation (larger, better reasoning)
ollama pull qwen2.5:7b

# Optional - fallback for low-end hardware
ollama pull phi3:mini
```

#### 4. Download TTS Voices

Download Piper voices from Hugging Face:

```bash
# Create tts directory
mkdir -p models/tts

# Download lessac voice (default)
curl -L -o models/tts/en_US-lessac-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"

curl -L -o models/tts/en_US-lessac-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
```

## Ollama vs GGUF Format

### Ollama (Recommended)
- **Pros:** Easy installation, automatic updates, managed service
- **Cons:** Requires Ollama to be running, uses Ollama's storage location
- **Best for:** Most users, development, easy setup

### GGUF (Direct)
- **Pros:** Self-contained, can bundle with app, no external service
- **Cons:** Manual updates, larger app bundle, more complex setup
- **Best for:** Offline distribution, kiosk mode, embedded systems

Frugworld defaults to Ollama but can fall back to direct GGUF loading if Ollama is unavailable.

## Verification

Check if models are properly installed:

```bash
# Check Ollama models
ollama list

# Check TTS files
ls -la models/tts/
```

## Troubleshooting

### Ollama not found
- Ensure Ollama is installed and in your PATH
- Try running `ollama --version`
- On macOS, you may need to start Ollama from Applications first

### Model download fails
- Check your internet connection
- Ensure you have enough disk space
- Try running with sudo if permission errors occur

### TTS voice not loading
- Verify both .onnx and .onnx.json files are present
- Check file permissions
- Ensure files aren't corrupted (re-download if needed)

### Out of memory
- Use phi3:mini instead of larger models
- Close other applications
- Consider adding swap space on Linux

## Model Licenses

- **Llama 3.2:** Meta Community License
- **Qwen 2.5:** Apache 2.0
- **Phi-3:** MIT License
- **Piper Voices:** MIT License (lessac voice)

Please review individual model licenses before redistribution.
