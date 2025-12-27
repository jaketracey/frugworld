#Requires -Version 5.1
<#
.SYNOPSIS
    Frugworld Model Download Script for Windows

.DESCRIPTION
    Downloads LLM models via Ollama and TTS voices from Hugging Face
    for the Frugworld desktop application.

.PARAMETER SkipOptional
    Skip optional model downloads (non-interactive mode)

.PARAMETER IncludeOptional
    Download all optional models

.PARAMETER VerifyOnly
    Only verify existing downloads without downloading

.EXAMPLE
    .\download-models.ps1
    .\download-models.ps1 -IncludeOptional
    .\download-models.ps1 -VerifyOnly
#>

param(
    [switch]$SkipOptional,
    [switch]$IncludeOptional,
    [switch]$VerifyOnly,
    [switch]$Help
)

# Strict mode
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Configuration
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$ModelsDir = Join-Path $ProjectDir "models"
$TtsDir = Join-Path $ModelsDir "tts"
$ConfigFile = Join-Path $ModelsDir "models.json"

# Model definitions
$LlmModels = @(
    "llama3.2:3b"    # Required: Main dialogue model
)

$LlmModelsOptional = @(
    "qwen2.5:7b"     # Optional: Blueprint generation
    "phi3:mini"      # Optional: Low-end fallback
)

# TTS voice URLs
$TtsBaseUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US"
$TtsVoices = @(
    @{
        Name = "en_US-lessac-medium"
        Path = "lessac/medium/en_US-lessac-medium"
    }
)

# Logging functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] " -ForegroundColor Blue -NoNewline
    Write-Host $Message
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Err {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Write-Banner {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  Frugworld Model Download Script" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""
}

function Show-Help {
    Write-Host "Usage: .\download-models.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -SkipOptional       Skip optional models (non-interactive)"
    Write-Host "  -IncludeOptional    Download all optional models"
    Write-Host "  -VerifyOnly         Only verify existing downloads"
    Write-Host "  -Help               Show this help message"
    Write-Host ""
}

# Check if Ollama is installed
function Test-OllamaInstalled {
    Write-Info "Checking Ollama installation..."

    $ollamaPath = Get-Command ollama -ErrorAction SilentlyContinue

    if (-not $ollamaPath) {
        Write-Err "Ollama is not installed!"
        Write-Host ""
        Write-Host "Please install Ollama first:"
        Write-Host "  Download from https://ollama.ai/download"
        Write-Host ""
        return $false
    }

    try {
        $version = & ollama --version 2>$null
        Write-Success "Ollama is installed: $version"
    } catch {
        Write-Success "Ollama is installed"
    }

    return $true
}

# Check if Ollama service is running
function Test-OllamaService {
    Write-Info "Checking Ollama service..."

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 2 -ErrorAction Stop
        Write-Success "Ollama service is running"
        return $true
    } catch {
        Write-Warn "Ollama service is not running"
        Write-Info "Attempting to start Ollama..."

        # Try to start Ollama
        try {
            Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
            Start-Sleep -Seconds 3

            # Check again
            $response = Invoke-RestMethod -Uri "http://localhost:11434/api/tags" -TimeoutSec 5 -ErrorAction Stop
            Write-Success "Ollama service started successfully"
            return $true
        } catch {
            Write-Err "Could not start Ollama service"
            Write-Host "Please start Ollama manually or run the Ollama application"
            return $false
        }
    }
}

# Get installed Ollama models
function Get-InstalledModels {
    try {
        $output = & ollama list 2>$null
        $models = @()
        $lines = $output -split "`n" | Select-Object -Skip 1
        foreach ($line in $lines) {
            if ($line -match "^\s*(\S+)") {
                $models += $Matches[1]
            }
        }
        return $models
    } catch {
        return @()
    }
}

# Check if model is installed
function Test-ModelInstalled {
    param([string]$Model)

    $installed = Get-InstalledModels
    foreach ($m in $installed) {
        if ($m -eq $Model -or $m -like "$Model:*" -or $m -like "${Model}:latest") {
            return $true
        }
    }
    return $false
}

# Download LLM model
function Install-LlmModel {
    param(
        [string]$Model,
        [bool]$Optional = $false
    )

    if (Test-ModelInstalled -Model $Model) {
        Write-Success "Model already installed: $Model"
        return $true
    }

    if ($Optional) {
        Write-Info "Downloading optional model: $Model"
    } else {
        Write-Info "Downloading model: $Model"
    }

    try {
        & ollama pull $Model
        if ($LASTEXITCODE -eq 0) {
            Write-Success "Downloaded: $Model"
            return $true
        } else {
            throw "ollama pull failed"
        }
    } catch {
        if ($Optional) {
            Write-Warn "Failed to download optional model: $Model (skipping)"
            return $true
        } else {
            Write-Err "Failed to download model: $Model"
            return $false
        }
    }
}

# Download file with progress
function Get-FileWithProgress {
    param(
        [string]$Url,
        [string]$Output,
        [string]$Description
    )

    Write-Info "Downloading: $Description"

    # Check if file exists and has content
    if ((Test-Path $Output) -and (Get-Item $Output).Length -gt 0) {
        Write-Success "Already exists: $(Split-Path -Leaf $Output)"
        return $true
    }

    # Create directory if needed
    $dir = Split-Path -Parent $Output
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }

    try {
        # Use BITS for better progress indication if available
        $ProgressPreference = 'Continue'
        Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing

        if ((Test-Path $Output) -and (Get-Item $Output).Length -gt 0) {
            Write-Success "Downloaded: $(Split-Path -Leaf $Output)"
            return $true
        } else {
            throw "Download produced empty file"
        }
    } catch {
        Write-Err "Failed to download: $Description"
        Write-Err $_.Exception.Message
        return $false
    }
}

# Download TTS voices
function Install-TtsVoices {
    Write-Info "Downloading TTS voices..."

    if (-not (Test-Path $TtsDir)) {
        New-Item -ItemType Directory -Path $TtsDir -Force | Out-Null
    }

    $success = 0
    $total = $TtsVoices.Count

    foreach ($voice in $TtsVoices) {
        $voiceName = $voice.Name
        $voicePath = $voice.Path

        $onnxUrl = "$TtsBaseUrl/$voicePath.onnx"
        $jsonUrl = "$TtsBaseUrl/$voicePath.onnx.json"
        $onnxFile = Join-Path $TtsDir "$voiceName.onnx"
        $jsonFile = Join-Path $TtsDir "$voiceName.onnx.json"

        $onnxOk = Get-FileWithProgress -Url $onnxUrl -Output $onnxFile -Description "$voiceName.onnx"
        $jsonOk = Get-FileWithProgress -Url $jsonUrl -Output $jsonFile -Description "$voiceName.onnx.json"

        if ($onnxOk -and $jsonOk) {
            $success++
        }
    }

    if ($success -eq $total) {
        Write-Success "All TTS voices downloaded successfully"
        return $true
    } else {
        Write-Warn "Some TTS voices failed to download ($success/$total)"
        return $false
    }
}

# Verify downloads
function Test-Downloads {
    Write-Info "Verifying downloads..."

    $errors = 0

    # Check TTS files
    foreach ($voice in $TtsVoices) {
        $voiceName = $voice.Name
        $onnxFile = Join-Path $TtsDir "$voiceName.onnx"
        $jsonFile = Join-Path $TtsDir "$voiceName.onnx.json"

        if (-not (Test-Path $onnxFile) -or (Get-Item $onnxFile).Length -eq 0) {
            Write-Err "Missing or empty: $onnxFile"
            $errors++
        }

        if (-not (Test-Path $jsonFile) -or (Get-Item $jsonFile).Length -eq 0) {
            Write-Err "Missing or empty: $jsonFile"
            $errors++
        }
    }

    # Check LLM models
    foreach ($model in $LlmModels) {
        if (-not (Test-ModelInstalled -Model $model)) {
            Write-Err "Missing LLM model: $model"
            $errors++
        }
    }

    if ($errors -eq 0) {
        Write-Success "All required models verified"
        return $true
    } else {
        Write-Err "Verification failed with $errors errors"
        return $false
    }
}

# Generate config file
function New-ConfigFile {
    Write-Info "Generating model configuration..."

    $ttsVoice = ""
    foreach ($voice in $TtsVoices) {
        $voiceName = $voice.Name
        $onnxFile = Join-Path $TtsDir "$voiceName.onnx"
        if (Test-Path $onnxFile) {
            $ttsVoice = $onnxFile
            break
        }
    }

    $llmModel = ""
    foreach ($model in $LlmModels) {
        if (Test-ModelInstalled -Model $model) {
            $llmModel = $model
            break
        }
    }

    $config = @{
        version = "1.0"
        generated = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        llm = @{
            provider = "ollama"
            model = $llmModel
            endpoint = "http://localhost:11434"
        }
        tts = @{
            provider = "piper"
            voice = $ttsVoice
            voiceName = "en_US-lessac-medium"
        }
        paths = @{
            models = $ModelsDir
            tts = $TtsDir
        }
    }

    $config | ConvertTo-Json -Depth 10 | Set-Content -Path $ConfigFile -Encoding UTF8

    Write-Success "Configuration saved to: $ConfigFile"
}

# Show summary
function Show-Summary {
    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "  Download Summary" -ForegroundColor Cyan
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "LLM Models (Ollama):"
    try {
        & ollama list 2>$null | Select-Object -First 10
    } catch {
        Write-Host "  (could not list models)"
    }
    Write-Host ""

    Write-Host "TTS Voices:"
    if (Test-Path $TtsDir) {
        Get-ChildItem -Path $TtsDir -Filter "*.onnx" | ForEach-Object {
            $size = [math]::Round($_.Length / 1MB, 2)
            Write-Host "  $($_.Name) - ${size}MB"
        }
    } else {
        Write-Host "  (directory not found)"
    }
    Write-Host ""

    if (Test-Path $ConfigFile) {
        Write-Host "Configuration: $ConfigFile"
    }
    Write-Host ""
}

# Ask about optional models
function Request-OptionalModels {
    Write-Host ""
    Write-Info "Optional models available:"
    Write-Host ""
    foreach ($model in $LlmModelsOptional) {
        switch ($model) {
            "qwen2.5:7b" {
                Write-Host "  - qwen2.5:7b (~4.5GB) - Better reasoning for blueprints"
            }
            "phi3:mini" {
                Write-Host "  - phi3:mini (~1.5GB) - Fallback for low-end hardware"
            }
            default {
                Write-Host "  - $model"
            }
        }
    }
    Write-Host ""

    $response = Read-Host "Download optional models? [y/N]"
    return ($response -match "^[yY]")
}

# Main execution
function Main {
    if ($Help) {
        Show-Help
        exit 0
    }

    Write-Banner

    # Verify only mode
    if ($VerifyOnly) {
        if (-not (Test-OllamaInstalled)) { exit 1 }
        if (-not (Test-OllamaService)) { exit 1 }
        if (Test-Downloads) { exit 0 } else { exit 1 }
    }

    # Check prerequisites
    if (-not (Test-OllamaInstalled)) { exit 1 }
    if (-not (Test-OllamaService)) { exit 1 }

    Write-Host ""
    Write-Info "Starting model downloads..."
    Write-Host ""

    # Download required LLM models
    foreach ($model in $LlmModels) {
        if (-not (Install-LlmModel -Model $model -Optional $false)) {
            exit 1
        }
    }

    # Handle optional models
    if ($IncludeOptional) {
        foreach ($model in $LlmModelsOptional) {
            Install-LlmModel -Model $model -Optional $true | Out-Null
        }
    } elseif (-not $SkipOptional) {
        # Interactive mode
        if (Request-OptionalModels) {
            foreach ($model in $LlmModelsOptional) {
                Install-LlmModel -Model $model -Optional $true | Out-Null
            }
        }
    }

    # Download TTS voices
    Write-Host ""
    Install-TtsVoices | Out-Null

    # Verify and generate config
    Write-Host ""
    Test-Downloads | Out-Null
    New-ConfigFile

    # Show summary
    Show-Summary

    Write-Host ""
    Write-Success "Model setup complete!"
    Write-Host ""
}

# Run main
Main
