/**
 * Model Downloader Component
 *
 * A vanilla TypeScript UI component for managing AI model downloads.
 * Displays the status of required models and allows downloading/managing them.
 *
 * This component is designed to work without React, using vanilla DOM manipulation
 * to integrate with the existing Frugworld client architecture.
 */

import {
  getModelStatus,
  downloadModel,
  cancelDownload,
  deleteModel,
  onDownloadProgress,
  formatBytes,
  formatDuration,
  type ModelStatus,
  type ModelInfo,
  type DownloadProgress,
} from '../tauri-bridge';

export interface ModelDownloaderOptions {
  container: HTMLElement;
  onReady?: () => void;
  onError?: (error: string) => void;
}

export class ModelDownloader {
  private container: HTMLElement;
  private onReady?: () => void;
  private onError?: (error: string) => void;
  private modelStatus: ModelStatus | null = null;
  private downloadProgress: Map<string, DownloadProgress> = new Map();
  private unsubscribeProgress: (() => void) | null = null;
  private pollInterval: number | null = null;
  private element: HTMLElement | null = null;

  constructor(options: ModelDownloaderOptions) {
    this.container = options.container;
    this.onReady = options.onReady;
    this.onError = options.onError;
  }

  /**
   * Initialize the component and start monitoring
   */
  async mount(): Promise<void> {
    this.element = this.createContainer();
    this.container.appendChild(this.element);

    // Subscribe to download progress events
    this.unsubscribeProgress = await onDownloadProgress((progress) => {
      this.downloadProgress.set(progress.modelName, progress);
      this.render();
    });

    // Initial status fetch
    await this.refreshStatus();

    // Poll for status updates
    this.pollInterval = window.setInterval(() => this.refreshStatus(), 5000);
  }

  /**
   * Clean up resources
   */
  unmount(): void {
    if (this.unsubscribeProgress) {
      this.unsubscribeProgress();
      this.unsubscribeProgress = null;
    }

    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
      this.element = null;
    }
  }

  /**
   * Refresh model status from the backend
   */
  async refreshStatus(): Promise<void> {
    try {
      this.modelStatus = await getModelStatus();
      this.render();

      // Check if all required models are ready
      if (this.modelStatus.ready && this.onReady) {
        this.onReady();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get model status';
      if (this.onError) {
        this.onError(message);
      }
    }
  }

  /**
   * Handle download button click
   */
  private async handleDownload(modelName: string): Promise<void> {
    try {
      await downloadModel(modelName);
      await this.refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      if (this.onError) {
        this.onError(message);
      }
    }
  }

  /**
   * Handle cancel button click
   */
  private async handleCancel(modelName: string): Promise<void> {
    try {
      await cancelDownload(modelName);
      this.downloadProgress.delete(modelName);
      await this.refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Cancel failed';
      if (this.onError) {
        this.onError(message);
      }
    }
  }

  /**
   * Handle delete button click
   */
  private async handleDelete(modelName: string): Promise<void> {
    try {
      await deleteModel(modelName);
      await this.refreshStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Delete failed';
      if (this.onError) {
        this.onError(message);
      }
    }
  }

  /**
   * Create the main container element
   */
  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'model-downloader';
    container.innerHTML = `
      <style>
        .model-downloader {
          background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
          border: 3px solid var(--color-purple, #8b5cf6);
          border-radius: 16px;
          padding: 20px;
          font-family: 'Nunito', sans-serif;
          color: #e2e8f0;
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.3), 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .model-downloader-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 2px solid rgba(139, 92, 246, 0.3);
        }

        .model-downloader-title {
          font-family: 'Fredoka', sans-serif;
          font-size: 18px;
          font-weight: 600;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .model-downloader-status {
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 12px;
          font-weight: 600;
        }

        .model-downloader-status.ready {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.4);
        }

        .model-downloader-status.pending {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.4);
        }

        .model-downloader-summary {
          font-size: 13px;
          color: rgba(196, 181, 253, 0.8);
          margin-bottom: 16px;
        }

        .model-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .model-item {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(139, 92, 246, 0.3);
          border-radius: 12px;
          padding: 14px;
          transition: all 0.2s ease;
        }

        .model-item:hover {
          border-color: rgba(139, 92, 246, 0.5);
          box-shadow: 0 0 15px rgba(139, 92, 246, 0.2);
        }

        .model-item-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 8px;
        }

        .model-name {
          font-weight: 600;
          color: #e2e8f0;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .model-required-badge {
          font-size: 10px;
          background: rgba(236, 72, 153, 0.2);
          color: #ec4899;
          padding: 2px 6px;
          border-radius: 6px;
          border: 1px solid rgba(236, 72, 153, 0.4);
        }

        .model-provider {
          font-size: 11px;
          color: rgba(196, 181, 253, 0.6);
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .model-info {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 12px;
          color: rgba(196, 181, 253, 0.7);
          margin-bottom: 10px;
        }

        .model-size {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .model-status-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .model-status-indicator.downloaded {
          color: #4ade80;
        }

        .model-status-indicator.not-downloaded {
          color: rgba(196, 181, 253, 0.5);
        }

        .model-progress {
          margin-bottom: 10px;
        }

        .progress-bar {
          height: 8px;
          background: rgba(0, 0, 0, 0.4);
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 6px;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #8b5cf6, #a78bfa);
          border-radius: 4px;
          transition: width 0.3s ease;
        }

        .progress-text {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: rgba(196, 181, 253, 0.7);
        }

        .model-actions {
          display: flex;
          gap: 8px;
        }

        .model-btn {
          padding: 6px 14px;
          border-radius: 8px;
          font-family: 'Nunito', sans-serif;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
        }

        .model-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .model-btn-download {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: white;
          border-color: #a78bfa;
        }

        .model-btn-download:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .model-btn-cancel {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.4);
        }

        .model-btn-cancel:hover:not(:disabled) {
          background: rgba(248, 113, 113, 0.3);
        }

        .model-btn-delete {
          background: transparent;
          color: rgba(248, 113, 113, 0.8);
          border-color: transparent;
        }

        .model-btn-delete:hover:not(:disabled) {
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.4);
        }

        .model-downloader-empty {
          text-align: center;
          padding: 24px;
          color: rgba(196, 181, 253, 0.5);
          font-size: 14px;
        }

        .model-downloader-loading {
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          gap: 12px;
          color: rgba(196, 181, 253, 0.7);
        }

        .loading-spinner {
          width: 24px;
          height: 24px;
          border: 3px solid rgba(139, 92, 246, 0.2);
          border-top-color: #8b5cf6;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
      <div class="model-downloader-content"></div>
    `;
    return container;
  }

  /**
   * Render the component
   */
  private render(): void {
    if (!this.element) return;

    const content = this.element.querySelector('.model-downloader-content');
    if (!content) return;

    if (!this.modelStatus) {
      content.innerHTML = `
        <div class="model-downloader-loading">
          <div class="loading-spinner"></div>
          <span>Loading model status...</span>
        </div>
      `;
      return;
    }

    const { models, totalSize, downloadedSize, ready } = this.modelStatus;

    if (models.length === 0) {
      content.innerHTML = `
        <div class="model-downloader-header">
          <div class="model-downloader-title">AI Models</div>
        </div>
        <div class="model-downloader-empty">
          No models configured. AI features may be limited.
        </div>
      `;
      return;
    }

    const requiredModels = models.filter((m) => m.required);
    const optionalModels = models.filter((m) => !m.required);
    const requiredDownloaded = requiredModels.filter((m) => m.downloaded).length;

    content.innerHTML = `
      <div class="model-downloader-header">
        <div class="model-downloader-title">AI Models</div>
        <div class="model-downloader-status ${ready ? 'ready' : 'pending'}">
          ${ready ? 'Ready' : `${requiredDownloaded}/${requiredModels.length} Required`}
        </div>
      </div>
      <div class="model-downloader-summary">
        ${formatBytes(downloadedSize)} / ${formatBytes(totalSize)} downloaded
      </div>
      <div class="model-list">
        ${requiredModels.map((m) => this.renderModelItem(m)).join('')}
        ${optionalModels.map((m) => this.renderModelItem(m)).join('')}
      </div>
    `;

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Render a single model item
   */
  private renderModelItem(model: ModelInfo): string {
    const progress = this.downloadProgress.get(model.name);
    const isDownloading = progress && progress.bytesDownloaded < progress.totalBytes;
    const progressPercent = progress
      ? Math.round((progress.bytesDownloaded / progress.totalBytes) * 100)
      : model.downloadProgress;

    return `
      <div class="model-item" data-model="${model.name}">
        <div class="model-item-header">
          <div class="model-name">
            ${model.displayName}
            ${model.required ? '<span class="model-required-badge">Required</span>' : ''}
          </div>
          <div class="model-provider">${model.provider}</div>
        </div>
        <div class="model-info">
          <div class="model-size">
            <span>${formatBytes(model.size)}</span>
          </div>
          <div class="model-status-indicator ${model.downloaded ? 'downloaded' : 'not-downloaded'}">
            ${model.downloaded ? 'Downloaded' : 'Not Downloaded'}
          </div>
        </div>
        ${
          isDownloading
            ? `
          <div class="model-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${progressPercent}%"></div>
            </div>
            <div class="progress-text">
              <span>${formatBytes(progress!.bytesDownloaded)} / ${formatBytes(progress!.totalBytes)}</span>
              <span>${progress!.speed > 0 ? `${formatBytes(progress!.speed)}/s` : ''} ${progress!.eta > 0 ? `ETA: ${formatDuration(progress!.eta)}` : ''}</span>
            </div>
          </div>
        `
            : ''
        }
        <div class="model-actions">
          ${
            model.downloaded
              ? `
            <button class="model-btn model-btn-delete" data-action="delete" data-model="${model.name}">
              Delete
            </button>
          `
              : isDownloading
                ? `
            <button class="model-btn model-btn-cancel" data-action="cancel" data-model="${model.name}">
              Cancel
            </button>
          `
                : `
            <button class="model-btn model-btn-download" data-action="download" data-model="${model.name}">
              Download
            </button>
          `
          }
        </div>
      </div>
    `;
  }

  /**
   * Attach click event listeners to action buttons
   */
  private attachEventListeners(): void {
    if (!this.element) return;

    const buttons = this.element.querySelectorAll('.model-btn[data-action]');
    buttons.forEach((button) => {
      const btn = button as HTMLButtonElement;
      const action = btn.dataset.action;
      const modelName = btn.dataset.model;

      if (!action || !modelName) return;

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          switch (action) {
            case 'download':
              await this.handleDownload(modelName);
              break;
            case 'cancel':
              await this.handleCancel(modelName);
              break;
            case 'delete':
              await this.handleDelete(modelName);
              break;
          }
        } finally {
          btn.disabled = false;
        }
      });
    });
  }
}

/**
 * Factory function to create and mount a ModelDownloader
 */
export function createModelDownloader(options: ModelDownloaderOptions): ModelDownloader {
  const downloader = new ModelDownloader(options);
  downloader.mount();
  return downloader;
}
