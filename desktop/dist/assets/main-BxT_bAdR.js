const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/event-CNmmTsV0.js","assets/core-BEOw45JP.js"])))=>i.map(i=>d[i]);
(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))o(s);new MutationObserver(s=>{for(const n of s)if(n.type==="childList")for(const r of n.addedNodes)r.tagName==="LINK"&&r.rel==="modulepreload"&&o(r)}).observe(document,{childList:!0,subtree:!0});function a(s){const n={};return s.integrity&&(n.integrity=s.integrity),s.referrerPolicy&&(n.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?n.credentials="include":s.crossOrigin==="anonymous"?n.credentials="omit":n.credentials="same-origin",n}function o(s){if(s.ep)return;s.ep=!0;const n=a(s);fetch(s.href,n)}})();const N="modulepreload",F=function(e){return"/"+e},k={},P=function(t,a,o){let s=Promise.resolve();if(a&&a.length>0){document.getElementsByTagName("link");const r=document.querySelector("meta[property=csp-nonce]"),l=r?.nonce||r?.getAttribute("nonce");s=Promise.allSettled(a.map(c=>{if(c=F(c),c in k)return;k[c]=!0;const d=c.endsWith(".css"),z=d?'[rel="stylesheet"]':"";if(document.querySelector(`link[href="${c}"]${z}`))return;const p=document.createElement("link");if(p.rel=d?"stylesheet":N,d||(p.as="script"),p.crossOrigin="",p.href=c,l&&p.setAttribute("nonce",l),document.head.appendChild(p),d)return new Promise((D,R)=>{p.addEventListener("load",D),p.addEventListener("error",()=>R(new Error(`Unable to preload CSS for ${c}`)))})}))}function n(r){const l=new Event("vite:preloadError",{cancelable:!0});if(l.payload=r,window.dispatchEvent(l),!l.defaultPrevented)throw r}return s.then(r=>{for(const l of r||[])l.status==="rejected"&&n(l.reason);return t().catch(n)})};let w=null;function m(){return w!==null||(w=typeof window<"u"&&"__TAURI__"in window&&window.__TAURI__!==void 0),w}async function u(){if(!m())return null;try{const{invoke:e}=await P(async()=>{const{invoke:t}=await import("./core-BEOw45JP.js");return{invoke:t}},[]);return e}catch{return console.warn("Failed to load Tauri API"),null}}async function T(){if(!m())return null;try{const{listen:e,once:t}=await P(async()=>{const{listen:a,once:o}=await import("./event-CNmmTsV0.js");return{listen:a,once:o}},__vite__mapDeps([0,1]));return{listen:e,once:t}}catch{return console.warn("Failed to load Tauri event API"),null}}const $={aiServiceUrl:"http://localhost:3002",timeout:3e4};async function h(e,t={}){const a=new AbortController,o=setTimeout(()=>a.abort(),$.timeout);try{const s=await fetch(`${$.aiServiceUrl}${e}`,{...t,signal:a.signal,headers:{"Content-Type":"application/json",...t.headers}});if(!s.ok)throw new Error(`HTTP ${s.status}: ${s.statusText}`);return await s.json()}finally{clearTimeout(o)}}async function v(){const e=await u();if(e)return e("get_ai_status");try{return{running:!0,ready:(await h("/health")).ready,error:null,pid:null,uptime:null}}catch(t){return{running:!1,ready:!1,error:t instanceof Error?t.message:"Connection failed",pid:null,uptime:null}}}async function q(){const e=await u();if(e){await e("start_ai");return}console.warn("Cannot start AI service in browser mode. Please start it manually.")}async function O(){const e=await u();if(e){await e("stop_ai");return}console.warn("Cannot stop AI service in browser mode. Please stop it manually.")}async function U(){const e=await u();if(e){await e("restart_ai");return}console.warn("Cannot restart AI service in browser mode. Please restart it manually.")}async function S(){const e=await u();if(e)return e("get_model_status");try{const a=(await h("/api/models")).models||[],o=a.filter(n=>n.downloaded).reduce((n,r)=>n+r.size,0),s=a.reduce((n,r)=>n+r.size,0);return{models:a,totalSize:s,downloadedSize:o,ready:a.filter(n=>n.required).every(n=>n.downloaded)}}catch{return{models:[],totalSize:0,downloadedSize:0,ready:!1}}}async function H(e){const t=await u();if(t){await t("download_model",{modelName:e});return}await h("/api/models/download",{method:"POST",body:JSON.stringify({model:e})})}async function j(e){const t=await u();if(t){await t("cancel_download",{modelName:e});return}await h("/api/models/cancel",{method:"POST",body:JSON.stringify({model:e})})}async function G(e){const t=await u();if(t){await t("delete_model",{modelName:e});return}await h(`/api/models/${encodeURIComponent(e)}`,{method:"DELETE"})}async function Y(){const e=await u();return e?e("get_config"):{aiService:{host:"localhost",port:3002,autoStart:!0},models:{llmProvider:"ollama",llmModel:"llama3.2:3b",ttsEnabled:!0,ttsVoice:"en_US-lessac-medium",imageGenEnabled:!1},game:{serverUrl:"ws://localhost:3000",moduleName:"frugworld"}}}async function V(e){const t=await T();if(t)return await t.listen("download-progress",n=>e(n.payload));let a=!0;return(async()=>{for(;a;){try{const s=await S();for(const n of s.models)n.downloadProgress>0&&n.downloadProgress<100&&e({modelName:n.name,bytesDownloaded:n.downloadProgress/100*n.size,totalBytes:n.size,speed:0,eta:0})}catch{}await new Promise(s=>setTimeout(s,1e3))}})(),()=>{a=!1}}async function _(e){const t=await T();if(t)return await t.listen("ai-status-change",r=>e(r.payload));let a=!0,o=null;return(async()=>{for(;a;){try{const n=await v();(!o||n.running!==o.running||n.ready!==o.ready)&&(o=n,e(n))}catch{}await new Promise(n=>setTimeout(n,2e3))}})(),()=>{a=!1}}function b(e){if(e===0)return"0 B";const t=["B","KB","MB","GB","TB"],a=1024,o=Math.floor(Math.log(e)/Math.log(a));return`${(e/Math.pow(a,o)).toFixed(1)} ${t[o]}`}function M(e){return e<60?`${Math.round(e)}s`:e<3600?`${Math.floor(e/60)}m ${Math.round(e%60)}s`:`${Math.floor(e/3600)}h ${Math.floor(e%3600/60)}m`}class J{container;onReady;onError;modelStatus=null;downloadProgress=new Map;unsubscribeProgress=null;pollInterval=null;element=null;constructor(t){this.container=t.container,this.onReady=t.onReady,this.onError=t.onError}async mount(){this.element=this.createContainer(),this.container.appendChild(this.element),this.unsubscribeProgress=await V(t=>{this.downloadProgress.set(t.modelName,t),this.render()}),await this.refreshStatus(),this.pollInterval=window.setInterval(()=>this.refreshStatus(),5e3)}unmount(){this.unsubscribeProgress&&(this.unsubscribeProgress(),this.unsubscribeProgress=null),this.pollInterval!==null&&(clearInterval(this.pollInterval),this.pollInterval=null),this.element&&this.element.parentNode&&(this.element.parentNode.removeChild(this.element),this.element=null)}async refreshStatus(){try{this.modelStatus=await S(),this.render(),this.modelStatus.ready&&this.onReady&&this.onReady()}catch(t){const a=t instanceof Error?t.message:"Failed to get model status";this.onError&&this.onError(a)}}async handleDownload(t){try{await H(t),await this.refreshStatus()}catch(a){const o=a instanceof Error?a.message:"Download failed";this.onError&&this.onError(o)}}async handleCancel(t){try{await j(t),this.downloadProgress.delete(t),await this.refreshStatus()}catch(a){const o=a instanceof Error?a.message:"Cancel failed";this.onError&&this.onError(o)}}async handleDelete(t){try{await G(t),await this.refreshStatus()}catch(a){const o=a instanceof Error?a.message:"Delete failed";this.onError&&this.onError(o)}}createContainer(){const t=document.createElement("div");return t.className="model-downloader",t.innerHTML=`
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
    `,t}render(){if(!this.element)return;const t=this.element.querySelector(".model-downloader-content");if(!t)return;if(!this.modelStatus){t.innerHTML=`
        <div class="model-downloader-loading">
          <div class="loading-spinner"></div>
          <span>Loading model status...</span>
        </div>
      `;return}const{models:a,totalSize:o,downloadedSize:s,ready:n}=this.modelStatus;if(a.length===0){t.innerHTML=`
        <div class="model-downloader-header">
          <div class="model-downloader-title">AI Models</div>
        </div>
        <div class="model-downloader-empty">
          No models configured. AI features may be limited.
        </div>
      `;return}const r=a.filter(d=>d.required),l=a.filter(d=>!d.required),c=r.filter(d=>d.downloaded).length;t.innerHTML=`
      <div class="model-downloader-header">
        <div class="model-downloader-title">AI Models</div>
        <div class="model-downloader-status ${n?"ready":"pending"}">
          ${n?"Ready":`${c}/${r.length} Required`}
        </div>
      </div>
      <div class="model-downloader-summary">
        ${b(s)} / ${b(o)} downloaded
      </div>
      <div class="model-list">
        ${r.map(d=>this.renderModelItem(d)).join("")}
        ${l.map(d=>this.renderModelItem(d)).join("")}
      </div>
    `,this.attachEventListeners()}renderModelItem(t){const a=this.downloadProgress.get(t.name),o=a&&a.bytesDownloaded<a.totalBytes,s=a?Math.round(a.bytesDownloaded/a.totalBytes*100):t.downloadProgress;return`
      <div class="model-item" data-model="${t.name}">
        <div class="model-item-header">
          <div class="model-name">
            ${t.displayName}
            ${t.required?'<span class="model-required-badge">Required</span>':""}
          </div>
          <div class="model-provider">${t.provider}</div>
        </div>
        <div class="model-info">
          <div class="model-size">
            <span>${b(t.size)}</span>
          </div>
          <div class="model-status-indicator ${t.downloaded?"downloaded":"not-downloaded"}">
            ${t.downloaded?"Downloaded":"Not Downloaded"}
          </div>
        </div>
        ${o?`
          <div class="model-progress">
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${s}%"></div>
            </div>
            <div class="progress-text">
              <span>${b(a.bytesDownloaded)} / ${b(a.totalBytes)}</span>
              <span>${a.speed>0?`${b(a.speed)}/s`:""} ${a.eta>0?`ETA: ${M(a.eta)}`:""}</span>
            </div>
          </div>
        `:""}
        <div class="model-actions">
          ${t.downloaded?`
            <button class="model-btn model-btn-delete" data-action="delete" data-model="${t.name}">
              Delete
            </button>
          `:o?`
            <button class="model-btn model-btn-cancel" data-action="cancel" data-model="${t.name}">
              Cancel
            </button>
          `:`
            <button class="model-btn model-btn-download" data-action="download" data-model="${t.name}">
              Download
            </button>
          `}
        </div>
      </div>
    `}attachEventListeners(){if(!this.element)return;this.element.querySelectorAll(".model-btn[data-action]").forEach(a=>{const o=a,s=o.dataset.action,n=o.dataset.model;!s||!n||o.addEventListener("click",async()=>{o.disabled=!0;try{switch(s){case"download":await this.handleDownload(n);break;case"cancel":await this.handleCancel(n);break;case"delete":await this.handleDelete(n);break}}finally{o.disabled=!1}})})}}function K(e){const t=new J(e);return t.mount(),t}class W{container;compact;onStatusChange;status=null;unsubscribeStatus=null;element=null;reconnectAttempts=0;maxReconnectAttempts=3;constructor(t){this.container=t.container,this.compact=t.compact??!1,this.onStatusChange=t.onStatusChange}async mount(){this.element=this.createContainer(),this.container.appendChild(this.element),this.unsubscribeStatus=await _(t=>{this.status=t,this.render(),this.onStatusChange&&this.onStatusChange(t)}),await this.refreshStatus()}unmount(){this.unsubscribeStatus&&(this.unsubscribeStatus(),this.unsubscribeStatus=null),this.element&&this.element.parentNode&&(this.element.parentNode.removeChild(this.element),this.element=null)}getConnectionState(){return this.status?this.status.error?"error":this.status.running?this.status.ready?"connected":"connecting":"disconnected":"connecting"}async refreshStatus(){try{this.status=await v(),this.reconnectAttempts=0,this.render(),this.onStatusChange&&this.onStatusChange(this.status)}catch(t){this.reconnectAttempts++,this.status={running:!1,ready:!1,error:t instanceof Error?t.message:"Connection failed",pid:null,uptime:null},this.render()}}async handleStart(){try{this.setButtonsLoading(!0),await q(),await this.waitForReady()}catch(t){console.error("Failed to start AI service:",t)}finally{this.setButtonsLoading(!1)}}async handleStop(){try{this.setButtonsLoading(!0),await O(),await this.refreshStatus()}catch(t){console.error("Failed to stop AI service:",t)}finally{this.setButtonsLoading(!1)}}async handleRestart(){try{this.setButtonsLoading(!0),await U(),await this.waitForReady()}catch(t){console.error("Failed to restart AI service:",t)}finally{this.setButtonsLoading(!1)}}async waitForReady(t=3e4){const a=Date.now();for(;Date.now()-a<t;){if(await this.refreshStatus(),this.status?.ready)return;await new Promise(o=>setTimeout(o,500))}throw new Error("Timeout waiting for AI service to become ready")}setButtonsLoading(t){if(!this.element)return;this.element.querySelectorAll(".ai-status-btn").forEach(o=>{o.disabled=t})}createContainer(){const t=document.createElement("div");return t.className=`ai-status-indicator ${this.compact?"compact":""}`,t.innerHTML=`
      <style>
        .ai-status-indicator {
          font-family: 'Nunito', sans-serif;
          color: #e2e8f0;
        }

        .ai-status-indicator.compact {
          display: inline-flex;
          align-items: center;
        }

        .ai-status-indicator:not(.compact) {
          background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
          border: 3px solid var(--color-purple, #8b5cf6);
          border-radius: 16px;
          padding: 16px;
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.3), 0 10px 40px rgba(0, 0, 0, 0.5);
        }

        .ai-status-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }

        .ai-status-title {
          font-family: 'Fredoka', sans-serif;
          font-size: 16px;
          font-weight: 600;
          color: #fbbf24;
          text-shadow: 0 0 10px rgba(251, 191, 36, 0.5);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .ai-status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .ai-status-badge.connected {
          background: rgba(74, 222, 128, 0.2);
          color: #4ade80;
          border: 1px solid rgba(74, 222, 128, 0.4);
        }

        .ai-status-badge.disconnected {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.4);
        }

        .ai-status-badge.connecting {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.4);
        }

        .ai-status-badge.error {
          background: rgba(248, 113, 113, 0.2);
          color: #f87171;
          border: 1px solid rgba(248, 113, 113, 0.4);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        .status-dot.connected {
          background: #4ade80;
          box-shadow: 0 0 8px rgba(74, 222, 128, 0.6);
        }

        .status-dot.disconnected {
          background: #f87171;
          box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
          animation: none;
        }

        .status-dot.connecting {
          background: #fbbf24;
          box-shadow: 0 0 8px rgba(251, 191, 36, 0.6);
        }

        .status-dot.error {
          background: #f87171;
          box-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
          animation: none;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.7; transform: scale(0.9); }
        }

        .ai-status-details {
          font-size: 12px;
          color: rgba(196, 181, 253, 0.7);
          margin-bottom: 12px;
        }

        .ai-status-detail-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
        }

        .ai-status-detail-label {
          color: rgba(196, 181, 253, 0.5);
        }

        .ai-status-detail-value {
          color: rgba(196, 181, 253, 0.9);
        }

        .ai-status-error {
          background: rgba(248, 113, 113, 0.1);
          border: 1px solid rgba(248, 113, 113, 0.3);
          border-radius: 8px;
          padding: 10px;
          margin-bottom: 12px;
          font-size: 12px;
          color: #f87171;
        }

        .ai-status-actions {
          display: flex;
          gap: 8px;
        }

        .ai-status-btn {
          padding: 8px 16px;
          border-radius: 10px;
          font-family: 'Nunito', sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          border: 2px solid transparent;
          flex: 1;
        }

        .ai-status-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .ai-status-btn-start {
          background: linear-gradient(135deg, #22c55e, #16a34a);
          color: white;
          border-color: #4ade80;
        }

        .ai-status-btn-start:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
        }

        .ai-status-btn-stop {
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: white;
          border-color: #f87171;
        }

        .ai-status-btn-stop:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);
        }

        .ai-status-btn-restart {
          background: linear-gradient(135deg, #8b5cf6, #7c3aed);
          color: white;
          border-color: #a78bfa;
        }

        .ai-status-btn-restart:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
        }

        .ai-status-hint {
          margin-top: 10px;
          font-size: 11px;
          color: rgba(196, 181, 253, 0.5);
          text-align: center;
          font-style: italic;
        }

        /* Compact mode styles */
        .ai-status-indicator.compact .ai-status-badge {
          padding: 6px 12px;
          border-radius: 14px;
        }

        .ai-status-indicator.compact .status-dot {
          width: 10px;
          height: 10px;
        }

        /* HUD icon button style for compact mode */
        .ai-status-hud-btn {
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #2d1b4e 0%, #1a1033 100%);
          border: 3px solid var(--color-purple, #8b5cf6);
          border-radius: 16px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.3), 0 4px 15px rgba(0, 0, 0, 0.4);
          position: relative;
        }

        .ai-status-hud-btn:hover {
          transform: scale(1.1) translateY(-2px);
          box-shadow: 0 0 30px rgba(139, 92, 246, 0.5), 0 8px 25px rgba(0, 0, 0, 0.5);
          border-color: #a78bfa;
        }

        .ai-status-hud-btn .status-icon {
          font-size: 22px;
        }

        .ai-status-hud-btn .status-tooltip {
          display: none;
          position: absolute;
          bottom: -28px;
          left: 50%;
          transform: translateX(-50%);
          font-family: 'Nunito', sans-serif;
          font-size: 11px;
          font-weight: 600;
          white-space: nowrap;
          background: rgba(26, 16, 51, 0.9);
          padding: 4px 8px;
          border-radius: 6px;
          border: 1px solid rgba(139, 92, 246, 0.3);
        }

        .ai-status-hud-btn:hover .status-tooltip {
          display: block;
        }

        .ai-status-hud-btn.connected {
          border-color: #4ade80;
          box-shadow: 0 0 20px rgba(74, 222, 128, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
        }

        .ai-status-hud-btn.connected .status-tooltip {
          color: #4ade80;
        }

        .ai-status-hud-btn.disconnected {
          border-color: #f87171;
          box-shadow: 0 0 20px rgba(248, 113, 113, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
        }

        .ai-status-hud-btn.disconnected .status-tooltip {
          color: #f87171;
        }

        .ai-status-hud-btn.connecting {
          border-color: #fbbf24;
          box-shadow: 0 0 20px rgba(251, 191, 36, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4);
          animation: connectingPulse 1.5s ease-in-out infinite;
        }

        .ai-status-hud-btn.connecting .status-tooltip {
          color: #fbbf24;
        }

        @keyframes connectingPulse {
          0%, 100% { box-shadow: 0 0 20px rgba(251, 191, 36, 0.4), 0 4px 15px rgba(0, 0, 0, 0.4); }
          50% { box-shadow: 0 0 35px rgba(251, 191, 36, 0.6), 0 4px 15px rgba(0, 0, 0, 0.4); }
        }
      </style>
      <div class="ai-status-content"></div>
    `,t}render(){if(!this.element)return;const t=this.element.querySelector(".ai-status-content");if(!t)return;const a=this.getConnectionState(),o=m();this.compact?t.innerHTML=this.renderCompact(a):t.innerHTML=this.renderFull(a,o),this.attachEventListeners()}renderCompact(t){const a={connected:"🟢",disconnected:"🔴",connecting:"🟡",error:"🔴"},o={connected:"AI Connected",disconnected:"AI Offline",connecting:"Connecting...",error:"AI Error"};return`
      <div class="ai-status-hud-btn ${t}">
        <span class="status-icon">${a[t]}</span>
        <span class="status-tooltip">${o[t]}</span>
      </div>
    `}renderFull(t,a){const o={connected:"Connected",disconnected:"Offline",connecting:"Connecting",error:"Error"},s=this.status?`
        <div class="ai-status-details">
          ${this.status.pid?`
            <div class="ai-status-detail-row">
              <span class="ai-status-detail-label">Process ID</span>
              <span class="ai-status-detail-value">${this.status.pid}</span>
            </div>
          `:""}
          ${this.status.uptime!==null?`
            <div class="ai-status-detail-row">
              <span class="ai-status-detail-label">Uptime</span>
              <span class="ai-status-detail-value">${M(this.status.uptime)}</span>
            </div>
          `:""}
          <div class="ai-status-detail-row">
            <span class="ai-status-detail-label">Status</span>
            <span class="ai-status-detail-value">${this.status.ready?"Ready":"Starting..."}</span>
          </div>
        </div>
      `:"",n=this.status?.error?`
      <div class="ai-status-error">
        ${this.status.error}
      </div>
    `:"",r=a?`
      <div class="ai-status-actions">
        ${t==="disconnected"||t==="error"?`
          <button class="ai-status-btn ai-status-btn-start" data-action="start">
            Start AI
          </button>
        `:t==="connected"?`
          <button class="ai-status-btn ai-status-btn-stop" data-action="stop">
            Stop
          </button>
          <button class="ai-status-btn ai-status-btn-restart" data-action="restart">
            Restart
          </button>
        `:`
          <button class="ai-status-btn ai-status-btn-restart" disabled>
            Starting...
          </button>
        `}
      </div>
    `:`
      <div class="ai-status-hint">
        ${t==="disconnected"?"Start the AI service manually to enable AI features.":""}
      </div>
    `;return`
      <div class="ai-status-header">
        <div class="ai-status-title">AI Service</div>
        <div class="ai-status-badge ${t}">
          <span class="status-dot ${t}"></span>
          ${o[t]}
        </div>
      </div>
      ${s}
      ${n}
      ${r}
    `}attachEventListeners(){if(!this.element)return;this.element.querySelectorAll(".ai-status-btn[data-action]").forEach(o=>{const s=o,n=s.dataset.action;n&&s.addEventListener("click",async()=>{switch(n){case"start":await this.handleStart();break;case"stop":await this.handleStop();break;case"restart":await this.handleRestart();break}})});const a=this.element.querySelector(".ai-status-hud-btn");a&&a.addEventListener("click",()=>{console.log("AI Status clicked, current state:",this.getConnectionState())})}}function X(e){const t=new W(e);return t.mount(),t}const i={initialized:!1,aiStatus:null,modelStatus:null,setupComplete:!1,firstRun:!1};let y=null,x=null;function f(e){const t=document.getElementById("loading-status");t&&(t.textContent=e)}function Q(){const e=document.getElementById("loading-screen");e&&e.classList.remove("hidden")}function B(){const e=document.getElementById("loading-screen");e&&e.classList.add("hidden")}function I(){const e=document.getElementById("desktop-setup");e&&e.classList.add("visible"),B()}function Z(){const e=document.getElementById("desktop-setup");e&&e.classList.remove("visible")}function tt(){const e=document.getElementById("start-game-btn");e&&(e.disabled=!1)}function et(){const e=document.getElementById("start-game-btn");e&&(e.disabled=!0)}async function at(){try{const e=await S();return i.modelStatus=e,e.models.filter(a=>a.required).length>0&&!e.ready}catch{return m()}}async function nt(){try{i.aiStatus=await v(),await _(e=>{i.aiStatus=e,g()})}catch(e){console.warn("Failed to get AI status:",e),i.aiStatus={running:!1,ready:!1,error:"Failed to connect to AI service",pid:null,uptime:null}}}function g(){const e=i.aiStatus?.ready??!1,t=i.modelStatus?.ready??!1;e&&t?tt():et()}function C(){const e=document.getElementById("ai-status-container");e&&(x=X({container:e,onStatusChange:a=>{i.aiStatus=a,g()}}));const t=document.getElementById("model-downloader-container");t&&(y=K({container:t,onReady:()=>{i.modelStatus={...i.modelStatus,ready:!0},g()},onError:a=>{console.error("Model downloader error:",a)}}))}function ot(){y&&(y.unmount(),y=null),x&&(x.unmount(),x=null)}async function E(){Z(),Q(),f("Starting game..."),ot(),i.setupComplete=!0;try{f("Loading game client...");const e=await Y();window.__FRUGWORLD_CONFIG__={serverUrl:e.game.serverUrl,moduleName:e.game.moduleName,aiServiceUrl:`http://${e.aiService.host}:${e.aiService.port}`,isTauri:m()},f("Initializing world..."),await st(!1?"http://localhost:5173/src/main.ts":"/game/main.js"),setTimeout(()=>{B()},500)}catch(e){console.error("Failed to start game:",e),f("Failed to start game. Please restart.")}}function st(e){return new Promise((t,a)=>{const o=document.createElement("script");o.type="module",o.src=e,o.onload=()=>t(),o.onerror=()=>a(new Error(`Failed to load script: ${e}`)),document.head.appendChild(o)})}function rt(){i.setupComplete=!0,E()}function A(){const e=document.getElementById("start-game-btn");e&&e.addEventListener("click",()=>{E()});const t=document.getElementById("skip-setup-btn");t&&t.addEventListener("click",()=>{rt()})}async function L(){console.log("Frugworld Desktop starting..."),console.log("Running in Tauri:",m()),f("Checking system..."),await nt(),i.firstRun=await at(),m()&&i.firstRun?(f("Preparing setup..."),I(),C(),A(),g()):m()&&!i.aiStatus?.ready?(f("AI service offline..."),I(),C(),A(),g()):await E(),i.initialized=!0}document.readyState==="loading"?document.addEventListener("DOMContentLoaded",L):L();
