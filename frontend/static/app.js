// ===== CONFIGURATION =====
console.log("=== APP.JS INITIALIZING ===");
const API_BASE_URL = window.location.origin;
const API_URL = API_BASE_URL;
const SUPPORTED_EXTENSIONS = ['.txt', '.csv', '.json', '.md', '.vtt', '.srt', '.xlsx', '.xls'];

// ===== AUTH =====
function getToken() {
    return localStorage.getItem('dos_token');
}

function authHeaders() {
    const token = getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
}

async function fetchWithAuth(url, options = {}) {
    const headers = { ...authHeaders(), ...(options.headers || {}) };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        localStorage.removeItem('dos_token');
        localStorage.removeItem('dos_email');
        window.location.href = '/login';
        throw new Error('Not authenticated');
    }
    return res;
}

// ===== APPLICATION STATE =====
const state = {
    uploadedFiles: [],
    currentRunId: null,
    selectedStrategy: 'Improve Retention',
    currentReport: null,
    currentPage: 'dashboard',
    recentAnalyses: [],
    isProcessing: false,
    visibleColumns: {
        severity: true, priority: true, confidence: true,
        segments: true, trend: true, sentiment: true,
        goalTag: true, betSize: true, sourceDiversity: true
    }
};

// ===== INITIALIZATION =====
document.addEventListener('DOMContentLoaded', () => {
    // Auth guard
    if (!getToken()) {
        window.location.href = '/login';
        return;
    }

    // Show user email
    const email = localStorage.getItem('dos_email') || 'Admin';
    const emailEl = document.getElementById('userEmailDisplay');
    const avatarEl = document.getElementById('userAvatar');
    if (emailEl) emailEl.textContent = email.split('@')[0];
    if (avatarEl) avatarEl.textContent = email[0].toUpperCase();

    // Logout
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('dos_token');
            localStorage.removeItem('dos_email');
            window.location.href = '/';
        });
    }

    loadState();
    setupNavigation();
    setupUploadZone();
    setupInsightsControls();
    updateDashboard();
    
    // Check if we have a run to show
    if (state.currentRunId && state.currentReport) {
        document.querySelector('[data-page="insights"]').classList.remove('disabled');
        document.querySelector('[data-page="summary"]').classList.remove('disabled');
        document.querySelector('[data-page="roadmap"]').classList.remove('disabled');
    } else {
        document.querySelector('[data-page="insights"]').classList.add('disabled');
        document.querySelector('[data-page="summary"]').classList.add('disabled');
        document.querySelector('[data-page="roadmap"]').classList.add('disabled');
    }
    
    navigateToPage(state.currentPage);
});

// ===== STATE MANAGEMENT =====
function loadState() {
    const saved = localStorage.getItem('discoveryos_recent');
    if (saved) {
        try {
            state.recentAnalyses = JSON.parse(saved);
        } catch (e) { console.error('Error parsing recent analyses'); }
    }
}
function saveState() {
    localStorage.setItem('discoveryos_recent', JSON.stringify(state.recentAnalyses.slice(0, 10)));
}

// ===== NAVIGATION =====
function setupNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (item.classList.contains('disabled')) return;
            const page = item.dataset.page;
            if (page) navigateToPage(page);
        });
    });

    document.getElementById('headerUploadBtn').addEventListener('click', () => navigateToPage('upload'));
}

function navigateToPage(page) {
    if (state.isProcessing && page !== 'processing') {
        showToast('Processing in progress. Please wait.', 'warning');
        return;
    }
    
    state.currentPage = page;
    
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    
    // Show active page (handle kebab-case to camelCase conversion)
    const pageId = page.replace(/-([a-z])/g, (_, c) => c.toUpperCase()) + 'Page';
    const pageEl = document.getElementById(pageId);
    if (pageEl) pageEl.classList.add('active');
    
    // Update nav
    const navEl = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');
    
    // Breadcrumb
    const breadcrumbs = {
        dashboard: 'Dashboard',
        upload: 'Upload Feedback',
        processing: 'Processing',
        insights: 'Insights',
        summary: 'Executive Summary',
        roadmap: 'AI Roadmap',
        'engineering-view': 'Engineering View',
        'sales-view': 'Sales View'
    };
    document.getElementById('headerBreadcrumb').textContent = breadcrumbs[page] || 'Dashboard';
    
    // Page specific logic
    if (page === 'dashboard') updateDashboard();
    if (page === 'insights' && state.currentReport) renderInsights();
    if (page === 'summary' && state.currentReport) renderSummary();
    if (page === 'roadmap' && state.currentReport) setupRoadmapPage();
    if (page === 'engineering-view') renderEngineeringView();
    if (page === 'sales-view') renderSalesView();
}

let currentConfigSource = null;

function openConfigModal(source) {
    currentConfigSource = source;
    document.getElementById('configModalTitle').textContent = 'Configure ' + source.charAt(0).toUpperCase() + source.slice(1);
    document.getElementById('configToken').value = '';
    document.getElementById('configModal').classList.remove('hidden');
}

function closeConfigModal() {
    currentConfigSource = null;
    document.getElementById('configModal').classList.add('hidden');
}

async function saveConfig() {
    if (!currentConfigSource) return;
    
    const adminKey = document.getElementById('configAdminKey').value;
    const token = document.getElementById('configToken').value;
    
    if (!adminKey || !token) {
        showToast('Admin key and Token are required', 'error');
        return;
    }
    
    const btn = document.getElementById('saveConfigBtn');
    btn.textContent = 'Saving...';
    btn.disabled = true;
    
    try {
        const response = await fetchWithAuth(`${API_URL}/config/credentials`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Admin-Key': adminKey
            },
            body: JSON.stringify({
                source_name: currentConfigSource,
                token: token
            })
        });
        
        if (response.ok) {
            showToast('Credentials saved successfully', 'success');
            closeConfigModal();
        } else {
            showToast('Failed to save credentials. Check Admin Key.', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error saving credentials', 'error');
    } finally {
        btn.textContent = 'Save';
        btn.disabled = false;
    }
}

async function syncSource(source) {
    const statusEl = document.getElementById(`${source}Status`);
    if (statusEl) statusEl.textContent = 'Syncing...';
    
    try {
        const response = await fetchWithAuth(`${API_URL}/sync/${source}`, { method: 'POST' });
        if (response.ok) {
            const data = await response.json();
            showToast(`Synced ${data.inserted} items from ${source}`, 'success');
            if (statusEl) statusEl.textContent = `Synced ${data.inserted} items`;
        } else {
            const errorData = await response.json().catch(()=>({}));
            showToast(errorData.detail || `Failed to sync ${source}`, 'error');
            if (statusEl) statusEl.textContent = 'Sync failed (Missing Config?)';
        }
    } catch (err) {
        console.error(err);
        showToast(`Error syncing ${source}`, 'error');
        if (statusEl) statusEl.textContent = 'Error';
    }
}

async function syncAll() {
    showToast('Syncing all sources...', 'info');
    try {
        const response = await fetchWithAuth(`${API_URL}/sync_all`, { method: 'POST' });
        if (response.ok) {
            const data = await response.json();
            showToast(`Sync complete! Total inserted: ${data.total_inserted}`, 'success');
            
            for (const [source, count] of Object.entries(data.details)) {
                const statusEl = document.getElementById(`${source}Status`);
                if (statusEl) statusEl.textContent = `Synced ${count} items`;
            }
        } else {
            showToast('Failed to sync some sources', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Error syncing all sources', 'error');
    }
}

async function askInsights() {
    const input = document.getElementById('insightsAskInput');
    const responseContainer = document.getElementById('insightsAskResponse');
    const askBtn = document.getElementById('insightsAskBtn');
    
    if (!input || !state.currentRunId) return;
    
    const question = input.value.trim();
    if (!question) return;
    
    askBtn.disabled = true;
    askBtn.textContent = 'Thinking...';
    responseContainer.style.display = 'block';
    responseContainer.innerHTML = `<div style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 13px;">
        <div class="step-spinner" style="width:16px; height:16px; border-width: 2px;"></div>
        AI is reviewing report data...
    </div>`;
    
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/ask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                run_id: state.currentRunId,
                question: question
            })
        });
        
        if (!response.ok) throw new Error('Failed to fetch response');
        
        const data = await response.json();
        
        let formattedAnswer = escapeHtml(data.answer)
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            
        responseContainer.innerHTML = `
            <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; letter-spacing: 0.05em;">AI Response</div>
            <div style="color: var(--text-primary); line-height: 1.5;">${formattedAnswer}</div>
        `;
    } catch (err) {
        console.error(err);
        responseContainer.innerHTML = `<div style="color: #DC2626;">Error: ${escapeHtml(err.message)}</div>`;
    } finally {
        askBtn.disabled = false;
        askBtn.textContent = 'Ask AI';
    }
}

window.app = { 
    navigateTo: navigateToPage,
    openConfigModal,
    closeConfigModal,
    syncSource,
    syncAll,
    showEvidence,
    toggleRow,
    askInsights,
    toggleColumn
};

// ===== DASHBOARD =====
function updateDashboard() {
    const tbody = document.getElementById('recentAnalysesBody');
    if (!tbody) return;
    
    if (state.recentAnalyses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">
            <div class="empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg></div>
            <h3 style="margin-bottom: 8px;">No analyses yet</h3>
            <p style="color: var(--text-secondary); margin-bottom: 16px;">Upload customer feedback to generate your first product insights report.</p>
            <button class="btn btn-primary" onclick="app.navigateTo('upload')">Upload Feedback</button>
        </td></tr>`;
        
        document.getElementById('kpiThemes').textContent = '-';
        document.getElementById('kpiPainPoints').textContent = '-';
        document.getElementById('kpiConfidence').textContent = '-';
        return;
    }
    
    tbody.innerHTML = state.recentAnalyses.map(a => `
        <tr style="cursor: pointer;" onclick="loadPastAnalysis(${a.run_id})">
            <td>#${a.run_id}</td>
            <td style="font-weight: 500;">${a.strategy}</td>
            <td>${a.files}</td>
            <td>${a.themes}</td>
            <td>${a.created}</td>
            <td><span class="status-badge status-success">✓ ${a.status}</span></td>
        </tr>
    `).join('');
    
    const latest = state.recentAnalyses[0];
    document.getElementById('kpiThemes').textContent = latest.themes;
    document.getElementById('kpiPainPoints').textContent = Math.round(latest.themes * 2.8);
    document.getElementById('kpiConfidence').textContent = '87%'; // Hardcoded display metric based on typical runs
}

async function loadPastAnalysis(runId) {
    if (state.isProcessing) return;
    try {
        state.isProcessing = true;
        const res = await fetchWithAuth(`${API_BASE_URL}/report?run_id=${runId}`);
        if (!res.ok) throw new Error('Report not found');
        const reportData = await res.json();
        
        state.currentRunId = reportData.run_id;
        state.currentReport = reportData;
        state.selectedStrategy = state.recentAnalyses.find(a => a.run_id === runId)?.strategy || 'Improve Retention';
        
        document.getElementById('strategySelect').value = state.selectedStrategy;
        document.querySelector('[data-page="insights"]').classList.remove('disabled');
        document.querySelector('[data-page="summary"]').classList.remove('disabled');
        document.querySelector('[data-page="roadmap"]').classList.remove('disabled');
        
        navigateToPage('insights');
        showToast('Analysis loaded', 'success');
    } catch (e) {
        console.error(e);
        showToast('Failed to load past analysis', 'error');
    } finally {
        state.isProcessing = false;
    }
}

// ===== UPLOAD LOGIC =====
function setupUploadZone() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const clearBtn = document.getElementById('clearQueueBtn');
    const analyzeBtn = document.getElementById('analyzeBtn');
    
    if (!dropZone) return;

    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    
    dropZone.addEventListener('click', (e) => {
        if(e.target.tagName !== 'SPAN') fileInput.click();
    });
    document.querySelector('.dropzone-desc span').addEventListener('click', (e) => {
        e.stopPropagation(); fileInput.click();
    });
    
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    clearBtn.addEventListener('click', clearFiles);
    analyzeBtn.addEventListener('click', processFeedbackFlow);
}

function handleFiles(files) {
    const newFiles = Array.from(files).filter(f => {
        const ext = '.' + f.name.split('.').pop().toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    });
    
    if (newFiles.length < files.length) {
        showToast('Some files were ignored (unsupported format)', 'warning');
    }
    
    if (newFiles.length > 0) {
        state.uploadedFiles.push(...newFiles.map(f => ({ file: f, name: f.name, size: formatSize(f.size) })));
        renderFileQueue();
    }
}

function removeFile(idx) {
    state.uploadedFiles.splice(idx, 1);
    renderFileQueue();
}

function clearFiles() {
    state.uploadedFiles = [];
    document.getElementById('fileInput').value = '';
    renderFileQueue();
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B', 'KB', 'MB'], i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function renderFileQueue() {
    const section = document.getElementById('fileQueueSection');
    const list = document.getElementById('fileList');
    const count = document.getElementById('fileCount');
    const btn = document.getElementById('analyzeBtn');
    
    if (state.uploadedFiles.length === 0) {
        section.classList.add('hidden');
        btn.disabled = true;
        return;
    }
    
    section.classList.remove('hidden');
    count.textContent = state.uploadedFiles.length;
    btn.disabled = false;
    
    list.innerHTML = state.uploadedFiles.map((f, i) => `
        <div class="file-item">
            <div class="file-info">
                <svg class="icon file-icon" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                <div>
                    <div class="file-name">${f.name}</div>
                    <div class="file-meta">${f.size}</div>
                </div>
            </div>
            <div class="file-actions">
                <span class="status-badge status-info" style="background: var(--bg-primary); color: var(--text-secondary);">Queued</span>
                <button class="btn btn-ghost" onclick="removeFile(${i})">
                    <svg class="icon icon-sm text-danger" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
            </div>
        </div>
    `).join('');
}

// ===== PROCESSING WORKFLOW =====
async function processFeedbackFlow() {
    if (state.uploadedFiles.length === 0) return;
    
    state.isProcessing = true;
    navigateToPage('processing');
    resetProcessingSteps();
    
    try {
        const formData = new FormData();
        state.uploadedFiles.forEach(f => formData.append('file', f.file, f.name));
        
        // Step 1: Ingest
        setStepStatus('step-upload', 'active');
        const uploadRes = await fetchWithAuth(`${API_BASE_URL}/ingest`, { method: 'POST', body: formData });
        const uploadBody = await uploadRes.text();
        if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadBody}`);
        setStepStatus('step-upload', 'completed');
        
        // Step 2: Process (Triggers asynchronous AI processing)
        const processRes = await fetchWithAuth(`${API_BASE_URL}/process?strategy=${encodeURIComponent(state.selectedStrategy)}`, { method: 'POST' });
        const processBody = await processRes.text();
        if (!processRes.ok) throw new Error(`Processing failed: ${processBody}`);
        
        const processData = JSON.parse(processBody);
        state.currentRunId = processData.run_id;
        
        // Now poll the status endpoint
        let isDone = false;
        let lastStage = '';
        
        while (!isDone) {
            // Wait 1 second
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const statusRes = await fetchWithAuth(`${API_BASE_URL}/process/status?run_id=${state.currentRunId}`);
            if (!statusRes.ok) throw new Error('Failed to fetch processing status');
            const statusData = await statusRes.json();
            
            if (statusData.status === 'completed') {
                isDone = true;
                // Mark all steps as completed
                setStepStatus('step-read', 'completed');
                setStepStatus('step-extract', 'completed');
                setStepStatus('step-discover', 'completed');
                setStepStatus('step-prioritize', 'completed');
                setStepStatus('step-report', 'completed');
            } else if (statusData.status === 'failed') {
                throw new Error(`AI processing failed: ${statusData.error || 'Unknown error'}`);
            } else {
                const stage = statusData.stage;
                if (stage !== lastStage) {
                    lastStage = stage;
                    if (stage === 'Reading feedback items') {
                        setStepStatus('step-read', 'active');
                    } else if (stage === 'Extracting pain points') {
                        setStepStatus('step-read', 'completed');
                        setStepStatus('step-extract', 'active');
                    } else if (stage === 'Clustering into themes') {
                        setStepStatus('step-read', 'completed');
                        setStepStatus('step-extract', 'completed');
                        setStepStatus('step-discover', 'active');
                    } else if (stage === 'Scoring priorities') {
                        setStepStatus('step-read', 'completed');
                        setStepStatus('step-extract', 'completed');
                        setStepStatus('step-discover', 'completed');
                        setStepStatus('step-prioritize', 'active');
                    } else if (stage === 'Generating summary') {
                        setStepStatus('step-read', 'completed');
                        setStepStatus('step-extract', 'completed');
                        setStepStatus('step-discover', 'completed');
                        setStepStatus('step-prioritize', 'completed');
                        setStepStatus('step-report', 'active');
                    }
                }
            }
        }
        
        // Step 3: Report
        const reportRes = await fetchWithAuth(`${API_BASE_URL}/report?run_id=${state.currentRunId}`);
        if (!reportRes.ok) throw new Error('Failed to fetch report');
        state.currentReport = await reportRes.json();
        
        // Finalize
        document.getElementById('processingPercent').textContent = '100%';
        document.getElementById('processingRing').style.strokeDasharray = "100, 100";
        
        state.recentAnalyses.unshift({
            run_id: state.currentRunId,
            strategy: state.selectedStrategy,
            files: state.uploadedFiles.length,
            themes: state.currentReport.themes.length,
            created: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
            status: 'Completed'
        });
        saveState();
        
        document.querySelector('[data-page="insights"]').classList.remove('disabled');
        document.querySelector('[data-page="summary"]').classList.remove('disabled');
        document.querySelector('[data-page="roadmap"]').classList.remove('disabled');
        
        setTimeout(() => {
            clearFiles();
            state.isProcessing = false;
            showToast('Analysis complete!', 'success');
            navigateToPage('insights');
        }, 1000);
        
    } catch (err) {
        console.error("Workflow error:", err);
        showToast(err.message, 'error');
        state.isProcessing = false;
        navigateToPage('upload');
    }
}

function resetProcessingSteps() {
    document.querySelectorAll('.process-step').forEach(el => {
        el.className = 'process-step';
        el.querySelector('.step-icon-wrapper').innerHTML = '<svg class="icon"><circle cx="12" cy="12" r="10"></circle></svg>';
    });
    document.getElementById('processingPercent').textContent = '0%';
    document.getElementById('processingRing').style.strokeDasharray = "0, 100";
}

function setStepStatus(id, status) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `process-step ${status}`;
    const iconW = el.querySelector('.step-icon-wrapper');
    if (status === 'active') {
        iconW.innerHTML = '<div class="step-spinner"></div>';
        
        // Map steps to fake % for UI polish (since it's a blocking sync backend)
        const percents = {
            'step-upload': '15%', 'step-read': '30%', 'step-extract': '50%',
            'step-discover': '70%', 'step-prioritize': '85%', 'step-report': '95%'
        };
        const p = percents[id] || '50%';
        document.getElementById('processingPercent').textContent = p;
        document.getElementById('processingRing').style.strokeDasharray = `${parseInt(p)}, 100`;
        
    } else if (status === 'completed') {
        iconW.innerHTML = '<svg class="icon text-success"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    }
}

// ===== INSIGHTS =====
function setupInsightsControls() {
    const sel = document.getElementById('strategySelect');
    if (sel) {
        sel.addEventListener('change', async (e) => {
            const strat = e.target.value;
            if (strat === state.selectedStrategy || !state.currentRunId) return;
            
            try {
                // Show loading state
                document.getElementById('insightsContent').innerHTML = `
                    <div style="padding: 40px; text-align: center;">
                        <div class="spinner-container" style="width:40px; height:40px;"><div class="step-spinner" style="width:40px; height:40px;"></div></div>
                        <p style="color: var(--text-secondary); margin-top: 16px;">Re-ranking based on ${strat}...</p>
                    </div>`;
                    
                const res = await fetchWithAuth(`${API_BASE_URL}/reprocess?run_id=${state.currentRunId}&strategy=${encodeURIComponent(strat)}`, { method: 'POST' });
                if (!res.ok) throw new Error('Reprocess failed');
                
                const reportRes = await fetchWithAuth(`${API_BASE_URL}/report?run_id=${state.currentRunId}`);
                if (!reportRes.ok) throw new Error('Failed to fetch updated report');
                
                state.currentReport = await reportRes.json();
                state.selectedStrategy = strat;
                
                // Update recent analysis array
                const ra = state.recentAnalyses.find(a => a.run_id === state.currentRunId);
                if (ra) { ra.strategy = strat; saveState(); }
                
                renderInsights();
                showToast(`Ranked for ${strat}`, 'success');
            } catch (err) {
                console.error(err);
                showToast('Failed to change strategy', 'error');
                sel.value = state.selectedStrategy; // Revert
                renderInsights();
            }
        });
    }
    
    document.getElementById('exportBtn').addEventListener('click', handleExport);
    document.getElementById('summaryExportBtn').addEventListener('click', handleExport);
}

function renderInsights() {
    if (!state.currentReport) return;
    
    // Show Ask DiscoveryOS box
    const askContainer = document.getElementById('insightsAskContainer');
    if (askContainer) {
        askContainer.classList.remove('hidden');
        document.getElementById('insightsAskInput').value = '';
        document.getElementById('insightsAskResponse').style.display = 'none';
    }
    
    const themes = state.currentReport.themes || [];
    document.getElementById('insightsSubtitle').textContent = `Analyzed on ${new Date().toLocaleDateString()} • ${themes.length} Themes`;
    document.getElementById('strategySelect').value = state.selectedStrategy;
    
    const container = document.getElementById('insightsContent');
    
    if (themes.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No themes found.</p></div>`;
        return;
    }
    
    // Sort themes by priority_score descending
    const sortedThemes = [...themes].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
    
    // Build KPI Row
    const totalFreq = sortedThemes.reduce((acc, t) => acc + (t.frequency || 0), 0);
    const avgConf = Math.round(sortedThemes.reduce((acc, t) => acc + (t.confidence_pct || 0), 0) / sortedThemes.length);
    
    // Build Column Toggle Bar
    const colDefs = [
        { key: 'severity', label: 'Severity' },
        { key: 'priority', label: 'Priority Score' },
        { key: 'confidence', label: 'Confidence' },
        { key: 'segments', label: 'Segments' },
        { key: 'sentiment', label: 'Sentiment' },
        { key: 'goalTag', label: 'Goal Tag' },
        { key: 'betSize', label: 'Bet Size' },
        { key: 'sourceDiversity', label: 'Source Diversity' },
        { key: 'trend', label: 'Trend' }
    ];

    const toggleBar = `
        <div style="margin-bottom: var(--spacing-md); display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #F8FAFC; padding: 12px; border-radius: var(--border-radius-sm); border: 1px solid var(--border-color);">
            <span style="font-size: 12.2px; font-weight: 600; color: var(--text-secondary); margin-right: 8px;">Visible Columns:</span>
            ${colDefs.map(c => {
                const active = state.visibleColumns[c.key];
                return `
                    <button type="button" class="btn" onclick="app.toggleColumn('${c.key}')" style="padding: 4px 10px; font-size: 12px; font-weight: 500; border-radius: 6px; border: 1px solid ${active ? 'var(--primary-blue)' : 'var(--border-color)'}; background: ${active ? 'var(--primary-blue)' : 'white'}; color: ${active ? 'white' : 'var(--text-secondary)'}; cursor: pointer; transition: all 0.15s ease;">
                        ${c.label}
                    </button>
                `;
            }).join('')}
        </div>
    `;
    
    let html = `
        <div class="kpi-grid">
            <div class="card" style="margin-bottom:0;">
                <div class="kpi-label">Themes Identified</div>
                <div class="kpi-value">${sortedThemes.length}</div>
            </div>
            <div class="card" style="margin-bottom:0;">
                <div class="kpi-label">Pain Points Extracted</div>
                <div class="kpi-value">${Math.round(sortedThemes.length * 2.8)}</div>
            </div>
            <div class="card" style="margin-bottom:0;">
                <div class="kpi-label">Total Mentions</div>
                <div class="kpi-value">${totalFreq}</div>
            </div>
            <div class="card" style="margin-bottom:0;">
                <div class="kpi-label">Avg Confidence</div>
                <div class="kpi-value">${avgConf}%</div>
            </div>
        </div>
        
        <h3 style="margin-top: var(--spacing-xl); margin-bottom: var(--spacing-md);">Prioritized Themes</h3>
        
        ${toggleBar}
        
        <!-- Insights Table Wrapper -->
        <div class="card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--border-radius-lg);">
            <table class="insights-table" style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
                <thead>
                    <tr style="background: #F9FAFB; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-weight: 600;">
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Theme Name</th>
                        ${state.visibleColumns.severity ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Severity</th>` : ''}
                        ${state.visibleColumns.priority ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Priority Score</th>` : ''}
                        ${state.visibleColumns.confidence ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Confidence</th>` : ''}
                        ${state.visibleColumns.segments ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Segments</th>` : ''}
                        ${state.visibleColumns.sentiment ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Sentiment</th>` : ''}
                        ${state.visibleColumns.goalTag ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Goal Tag</th>` : ''}
                        ${state.visibleColumns.betSize ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Bet Size</th>` : ''}
                        ${state.visibleColumns.sourceDiversity ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Sources</th>` : ''}
                        ${state.visibleColumns.trend ? `<th style="padding: var(--spacing-md) var(--spacing-lg);">Trend</th>` : ''}
                    </tr>
                </thead>
                <tbody>
                    ${sortedThemes.map((t, idx) => {
                        const segments = getSegments(t);
                        const isAccelerating = (t.trend_flag || '').toLowerCase().includes('accelerat') || t.priority_score >= 50;
                        const severityDot = renderSeverityDot(t.severity);
                        const segmentsBadges = renderSegmentsBadges(segments);
                        
                        const priorityDots = renderPriorityDots(t.priority_score, t.severity);
                        const sentimentBadge = renderSentimentBadge(t.sentiment);
                        const goalTagBadge = renderGoalTagBadge(t.goal_tag);
                        const betSize = t.bet_size || (t.priority_score >= 65 ? 'L' : t.priority_score >= 40 ? 'M' : 'S');
                        const betBadge = renderBetBadge(betSize);
                        const sourceDiversity = t.source_counts ? Object.keys(t.source_counts).length : 0;
                        
                        // Score breakdown math
                        const ciVal = (t.customer_impact || 0) * 20;
                        const sevVal = (t.severity || 0) * 20;
                        const biVal = (t.business_impact || 0) * 20;
                        const saVal = (t.strategic_alignment || 0) * 20;
                        const ciCont = ciVal * 0.30;
                        const sevCont = sevVal * 0.25;
                        const biCont = biVal * 0.20;
                        const saCont = saVal * 0.15;
                        const remaining = (t.priority_score || 0) - (ciCont + sevCont + biCont + saCont);
                        const svCont = Math.max(0, remaining);
                        const svVal = svCont / 0.10;
                        
                        const mockBD = getMockBreakdown(t);
                        const colSpan = 1 + Object.values(state.visibleColumns).filter(Boolean).length;
                        
                        return `
                        <tr id="main-row-${idx}" class="table-row-main" onclick="app.toggleRow(${idx})">
                            <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 600; color: var(--text-primary);">
                                ${escapeHtml(t.theme)}
                                ${t.is_new ? `<span class="status-badge status-success" style="margin-left: 8px; font-size: 10px; padding: 2px 6px; background: #DEF7EC; color: #03543F; border: 1px solid #BCF0DA;">NEW</span>` : ''}
                            </td>
                            ${state.visibleColumns.severity ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${severityDot}</td>` : ''}
                            ${state.visibleColumns.priority ? `<td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 700; color: var(--text-primary);">
                                <div style="font-weight: 700; color: var(--text-primary); margin-bottom: 2px;">${t.priority_score.toFixed(1)}</div>
                                <div>${priorityDots}</div>
                            </td>` : ''}
                            ${state.visibleColumns.confidence ? `<td style="padding: var(--spacing-md) var(--spacing-lg); color: var(--text-secondary);">
                                <div style="font-weight: 500;">${t.confidence_pct}%</div>
                                ${t.confidence_explanation ? `<div style="font-size: 11px; color: #6B7280; font-weight: 400; margin-top: 2px; line-height: 1.2;">${escapeHtml(t.confidence_explanation)}</div>` : ''}
                            </td>` : ''}
                            ${state.visibleColumns.segments ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${segmentsBadges}</td>` : ''}
                            ${state.visibleColumns.sentiment ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${sentimentBadge}</td>` : ''}
                            ${state.visibleColumns.goalTag ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${goalTagBadge}</td>` : ''}
                            ${state.visibleColumns.betSize ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${betBadge}</td>` : ''}
                            ${state.visibleColumns.sourceDiversity ? `<td style="padding: var(--spacing-md) var(--spacing-lg); color: var(--text-secondary); font-weight: 500;">${sourceDiversity}</td>` : ''}
                            ${state.visibleColumns.trend ? `<td style="padding: var(--spacing-md) var(--spacing-lg);">${isAccelerating ? renderTrendBadge() : ''}</td>` : ''}
                        </tr>
                        <tr id="details-row-${idx}" class="details-row hidden-row">
                            <td colspan="${colSpan}" style="padding: 0;">
                                <div class="details-content">
                                    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: var(--spacing-xl); padding-top: var(--spacing-sm); padding-bottom: var(--spacing-sm);">
                                        <!-- Left side: Core Info -->
                                        <div>
                                            <div style="margin-bottom: var(--spacing-md);">
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; letter-spacing: 0.05em;">Problem Statement</div>
                                                <div style="font-size: 13.5px; color: var(--text-primary); line-height: 1.5;">${escapeHtml(t.problem_statement || 'N/A')}</div>
                                            </div>
                                            <div style="margin-bottom: var(--spacing-md);">
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; letter-spacing: 0.05em;">Hypothesis</div>
                                                <div style="font-size: 13px; color: var(--text-secondary); line-height: 1.5;">${escapeHtml(t.hypothesis || 'N/A')}</div>
                                            </div>
                                            <div style="margin-bottom: var(--spacing-md);">
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; letter-spacing: 0.05em;">Bet Size</div>
                                                <div style="font-size: 12.5px; font-weight: 700; color: var(--primary-blue); display: inline-flex; align-items: center; gap: 4px; background: var(--primary-light); padding: 2px 8px; border-radius: 6px;">
                                                    ${betSize}
                                                </div>
                                            </div>
                                            ${t.sample_quotes && t.sample_quotes.length > 0 ? `
                                            <div>
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; letter-spacing: 0.05em;">Sample Quotes</div>
                                                <ul style="padding-left: 20px; margin: 0; color: var(--text-secondary); font-size: 12.5px; line-height: 1.6;">
                                                    ${t.sample_quotes.map(q => `<li style="margin-bottom: 4px;">"${escapeHtml(q)}"</li>`).join('')}
                                                </ul>
                                            </div>
                                            ` : ''}
                                        </div>
                                        
                                        <!-- Right side: Score Breakdown & Sources -->
                                        <div style="border-left: 1px solid var(--border-color); padding-left: var(--spacing-lg);">
                                            <div style="margin-bottom: var(--spacing-md);">
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; letter-spacing: 0.05em;">Full Score Breakdown</div>
                                                <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                                                    <tbody>
                                                        <tr style="border-bottom: 1px solid #F3F4F6;">
                                                            <td style="padding: 4px 0; color: var(--text-secondary);">Customer Impact</td>
                                                            <td style="padding: 4px 0; text-align: right; color: var(--text-primary); font-weight: 500;">${ciVal.toFixed(0)} <span style="font-size:9.5px; color:var(--text-tertiary);">(x30%)</span></td>
                                                        </tr>
                                                        <tr style="border-bottom: 1px solid #F3F4F6;">
                                                            <td style="padding: 4px 0; color: var(--text-secondary);">Severity</td>
                                                            <td style="padding: 4px 0; text-align: right; color: var(--text-primary); font-weight: 500;">${sevVal.toFixed(0)} <span style="font-size:9.5px; color:var(--text-tertiary);">(x25%)</span></td>
                                                        </tr>
                                                        <tr style="border-bottom: 1px solid #F3F4F6;">
                                                            <td style="padding: 4px 0; color: var(--text-secondary);">Business Impact</td>
                                                            <td style="padding: 4px 0; text-align: right; color: var(--text-primary); font-weight: 500;">${biVal.toFixed(0)} <span style="font-size:9.5px; color:var(--text-tertiary);">(x20%)</span></td>
                                                        </tr>
                                                        <tr style="border-bottom: 1px solid #F3F4F6;">
                                                            <td style="padding: 4px 0; color: var(--text-secondary);">Strategic Alignment</td>
                                                            <td style="padding: 4px 0; text-align: right; color: var(--text-primary); font-weight: 500;">${saVal.toFixed(0)} <span style="font-size:9.5px; color:var(--text-tertiary);">(x15%)</span></td>
                                                        </tr>
                                                        <tr style="border-bottom: 1px solid #F3F4F6;">
                                                            <td style="padding: 4px 0; color: var(--text-secondary);">Segment Value</td>
                                                            <td style="padding: 4px 0; text-align: right; color: var(--text-primary); font-weight: 500;">${svVal.toFixed(0)} <span style="font-size:9.5px; color:var(--text-tertiary);">(x10%)</span></td>
                                                        </tr>
                                                        <tr style="font-weight: 700; color: var(--primary-blue);">
                                                            <td style="padding: 8px 0 4px;">Total Score</td>
                                                            <td style="padding: 8px 0 4px; text-align: right;">${t.priority_score.toFixed(2)}</td>
                                                        </tr>
                                                    </tbody>
                                                </table>
                                            </div>
                                            
                                            <!-- Sources & Segment Breakdown -->
                                            <div>
                                                <div style="font-weight: 700; font-size: 11px; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 6px; letter-spacing: 0.05em;">Sources &amp; Segments</div>
                                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: var(--spacing-md); font-size: 11.5px;">
                                                    <div>
                                                        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Sources</div>
                                                        ${Object.entries(mockBD.sources).map(([src, count]) => `
                                                            <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed #F3F4F6;">
                                                                 <span style="color: var(--text-secondary);">${escapeHtml(src)}</span>
                                                                 <span style="font-weight: 600; color: var(--text-primary);">${count}</span>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                    <div>
                                                        <div style="font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Segments</div>
                                                        ${Object.entries(mockBD.segments).map(([seg, count]) => `
                                                            <div style="display: flex; justify-content: space-between; padding: 2px 0; border-bottom: 1px dashed #F3F4F6;">
                                                                 <span style="color: var(--text-secondary);">${escapeHtml(seg)}</span>
                                                                 <span style="font-weight: 600; color: var(--text-primary);">${count}</span>
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = html;
}

// Table helper functions
function renderSeverityDot(severityStars) {
    let color, label;
    if (severityStars >= 4) {
        color = '#DC2626';
        label = 'High';
    } else if (severityStars === 3) {
        color = '#F59E0B';
        label = 'Medium';
    } else if (severityStars === 1 || severityStars === 2) {
        color = '#EAB308';
        label = 'Low';
    } else {
        color = '#9CA3AF';
        label = 'Negligible';
    }
    return `<span style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: ${color};"><span style="width: 8px; height: 8px; border-radius: 50%; background: ${color}; display: inline-block;"></span>${label}</span>`;
}

function renderSegmentsBadges(segments) {
    const firstTwo = segments.slice(0, 2);
    const countRemaining = segments.length - 2;
    let html = firstTwo.map(seg => `
        <span style="font-size: 11px; background: #F3F4F6; color: #4B5563; padding: 2px 6px; border-radius: 6px; font-weight: 500; margin-right: 4px; border: 1px solid #E5E7EB;">
            ${escapeHtml(seg)}
        </span>
    `).join('');
    if (countRemaining > 0) {
        html += `<span style="font-size: 11px; background: #E0F2FE; color: #0369A1; padding: 2px 6px; border-radius: 6px; font-weight: 600; border: 1px solid #BAE6FD;">+${countRemaining} more</span>`;
    }
    return html;
}

function getMockBreakdown(theme) {
    const text = theme.theme.toLowerCase();
    let sources = { "support_tickets": 2, "churn_surveys": 1, "in_app_feedback": 1 };
    let segments = { "Enterprise": 2, "SMB": 1, "Free": 1 };
    
    if (text.includes('search')) {
        sources = { "support_tickets": 4, "churn_surveys": 2, "sales_escalations": 1 };
        segments = { "Enterprise": 4, "SMB": 2, "Free": 1 };
    } else if (text.includes('dark') || text.includes('mode')) {
        sources = { "feature_requests": 6, "support_tickets": 1 };
        segments = { "Enterprise": 1, "SMB": 3, "Free": 3 };
    } else if (text.includes('performance') || text.includes('timeout')) {
        sources = { "support_tickets": 3, "internal_feedback": 1 };
        segments = { "Enterprise": 3, "SMB": 1, "Free": 0 };
    } else if (text.includes('api') || text.includes('doc')) {
        sources = { "developer_portal": 2, "onboarding_tickets": 1 };
        segments = { "Enterprise": 2, "SMB": 1, "Free": 0 };
    }
    
    return { sources, segments };
}

function toggleRow(idx) {
    const activeRow = document.querySelector('.details-row.expanded-row');
    const targetRow = document.getElementById(`details-row-${idx}`);
    
    if (activeRow && activeRow !== targetRow) {
        activeRow.classList.remove('expanded-row');
        const activeContent = activeRow.querySelector('.details-content');
        if (activeContent) activeContent.style.maxHeight = '0px';
        setTimeout(() => {
            activeRow.classList.add('hidden-row');
        }, 250);
    }
    
    if (targetRow) {
        if (targetRow.classList.contains('expanded-row')) {
            targetRow.classList.remove('expanded-row');
            const targetContent = targetRow.querySelector('.details-content');
            if (targetContent) targetContent.style.maxHeight = '0px';
            setTimeout(() => {
                targetRow.classList.add('hidden-row');
            }, 250);
        } else {
            targetRow.classList.remove('hidden-row');
            targetRow.offsetHeight; // force reflow
            targetRow.classList.add('expanded-row');
            const targetContent = targetRow.querySelector('.details-content');
            if (targetContent) {
                targetContent.style.maxHeight = `${targetContent.scrollHeight + 40}px`;
            }
        }
    }
}


function renderStars(val) {
    const f = Math.round(val);
    let s = '';
    for(let i=0; i<5; i++) {
        s += i < f ? '<span class="stars-filled">★</span>' : '☆';
    }
    return s;
}

// ===== EXECUTIVE SUMMARY =====
function renderSummary() {
    if (!state.currentReport) return;
    
    const summaryStr = state.currentReport.summary || '';
    const boundary = state.currentReport.decision_boundary || '';
    const themes = state.currentReport.themes || [];
    
    const container = document.getElementById('summaryContent');
    
    // KPI Data
    const totalFreq = themes.reduce((acc, t) => acc + (t.frequency || 0), 0);
    const avgConf = themes.length > 0 ? Math.round(themes.reduce((acc, t) => acc + (t.confidence_pct || 0), 0) / themes.length) : 0;
    
    let html = `
        <div style="padding: var(--spacing-xl);">
            ${state.currentReport.comparison_narrative ? `
            <div class="summary-section" style="background: #F3F4F6; border-left: 4px solid #4B5563; padding: var(--spacing-md); border-radius: var(--border-radius-sm); margin-bottom: var(--spacing-lg);">
                <div class="theme-section-title" style="color: #374151; display: flex; align-items: center; gap: 6px; font-size: 13.5px;">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" style="color: #4B5563;"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                    Changes Since Last Run
                </div>
                <p style="font-size: 13.5px; color: var(--text-primary); line-height: 1.6; margin-top: 6px; font-weight: normal;">
                    ${escapeHtml(state.currentReport.comparison_narrative)}
                </p>
            </div>
            ` : ''}
            
            <div class="summary-section">
                <div class="theme-section-title" style="color: var(--primary-blue);">Overview</div>
                <p style="font-size: 15px; color: var(--text-primary); line-height: 1.7; max-width: 800px;">
                    ${escapeHtml(summaryStr)}
                </p>
            </div>
            
            <div class="summary-section" style="background: var(--primary-light); padding: var(--spacing-md); border-radius: var(--border-radius-sm); border-left: 4px solid var(--primary-blue);">
                <div class="theme-section-title">Decision Boundary</div>
                <p style="color: var(--primary-hover); font-weight: 500;">${escapeHtml(boundary)}</p>
            </div>
            
            <!-- KPI Strip -->
            <div class="kpi-grid" style="margin-top: var(--spacing-xl); margin-bottom: var(--spacing-xl);">
                <div class="card" style="margin-bottom:0; padding: var(--spacing-md);">
                    <div class="kpi-label">Themes Identified</div>
                    <div class="kpi-value" style="font-size: 20px;">${themes.length}</div>
                </div>
                <div class="card" style="margin-bottom:0; padding: var(--spacing-md);">
                    <div class="kpi-label">Feedback Items</div>
                    <div class="kpi-value" style="font-size: 20px;">${totalFreq}</div>
                </div>
                <div class="card" style="margin-bottom:0; padding: var(--spacing-md);">
                    <div class="kpi-label">Avg Confidence</div>
                    <div class="kpi-value" style="font-size: 20px;">${avgConf}%</div>
                </div>
                <div class="card" style="margin-bottom:0; padding: var(--spacing-md);">
                    <div class="kpi-label">Current Strategy</div>
                    <div class="kpi-value" style="font-size: 13.5px; margin-top: 4px; font-weight: 700; color: var(--primary-blue); text-transform: none; letter-spacing: normal;">${escapeHtml(state.selectedStrategy)}</div>
                </div>
            </div>
            
            <div class="summary-section mt-4">
                <div class="theme-section-title" style="margin-bottom: var(--spacing-lg);">Top 3 Opportunities based on "${state.selectedStrategy}"</div>
                <div style="display: flex; flex-direction: column; gap: var(--spacing-md);">
                    ${themes.slice(0, 3).map((t, i) => {
                        const segments = getSegments(t);
                        return `
                        <div class="card" style="border: 1px solid #E5E7EB; border-radius: 12px; box-shadow: var(--shadow-sm); padding: var(--spacing-lg); display: flex; gap: var(--spacing-md); align-items: flex-start; margin-bottom: 0;">
                            <!-- Icon container -->
                            <div style="background: var(--primary-light); color: var(--primary-blue); width: 40px; height: 40px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;">
                                ${getOpportunityIcon(t.theme)}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: var(--spacing-md); margin-bottom: 4px;">
                                    <div style="font-weight: 700; font-size: 16px; color: var(--text-primary); line-height: 1.3;">${escapeHtml(t.theme)}</div>
                                    <span style="font-size: 11px; font-weight: 700; background: var(--bg-primary); padding: 2px 8px; border-radius: 12px; color: var(--text-secondary); border: 1px solid var(--border-color); white-space: nowrap; flex-shrink: 0;">Opportunity #${i+1}</span>
                                </div>
                                
                                <p style="font-size: 13.5px; color: var(--text-secondary); line-height: 1.6; margin-bottom: 12px; margin-top: 6px;">
                                    ${escapeHtml(t.problem_statement)}
                                </p>
                                
                                <!-- Evidence chips -->
                                <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px;">
                                    <span class="roadmap-metric-pill" style="font-size: 11px; padding: 3px 8px; margin: 0; background: var(--bg-primary); height: auto; line-height: normal;">
                                        <svg viewBox="0 0 24 24" style="width:11px; height:11px; margin-right: 2px;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle></svg>
                                        ${t.frequency} Mentions
                                    </span>
                                    
                                    ${renderConfidencePill(t.confidence_pct)}
                                    
                                    ${segments.map(seg => `
                                        <span style="font-size: 11px; background: #F3F4F6; color: #4B5563; padding: 3px 8px; border-radius: 8px; font-weight: 600; border: 1px solid #E5E7EB;">
                                            ${escapeHtml(seg)}
                                        </span>
                                    `).join('')}
                                </div>
                                
                                <!-- Recommended Action line -->
                                <div style="font-size: 13px; color: var(--text-primary); background: #F9FAFB; padding: var(--spacing-sm) var(--spacing-md); border-radius: 8px; border-left: 3px solid var(--primary-blue); margin-bottom: 8px; line-height: 1.5;">
                                    <strong>Recommended Action:</strong> ${escapeHtml(t.hypothesis || 'N/A')}
                                </div>
                                
                                <!-- Navigation link -->
                                <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                                    <a href="#" onclick="event.preventDefault(); app.showEvidence(${i})" style="font-size: 12.5px; color: var(--primary-blue); font-weight: 600; text-decoration: none; display: flex; align-items: center; gap: 4px;">
                                        View full evidence &rarr;
                                    </a>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// Summary Helpers
function getOpportunityIcon(themeName) {
    const text = themeName.toLowerCase();
    if (text.includes('search') || text.includes('find') || text.includes('query') || text.includes('filter')) {
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
    }
    if (text.includes('dark') || text.includes('mode') || text.includes('theme') || text.includes('ui') || text.includes('ux') || text.includes('accessibility') || text.includes('screen') || text.includes('look') || text.includes('visual')) {
        return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`;
}

function renderConfidencePill(pct) {
    let colorBg, colorText, label;
    if (pct >= 80) {
        colorBg = '#DEF7EC';
        colorText = '#03543F';
        label = 'High Conf';
    } else if (pct >= 50) {
        colorBg = '#FEF08A';
        colorText = '#713F12';
        label = 'Med Conf';
    } else {
        colorBg = '#F2F2F2';
        colorText = '#4B5563';
        label = 'Low Conf';
    }
    return `<span style="font-size: 11px; background: ${colorBg}; color: ${colorText}; padding: 3px 8px; border-radius: 8px; font-weight: 600; border: 1px solid ${pct >= 80 ? '#BCF0DA' : pct >= 50 ? '#FDE047' : '#E5E7EB'};">${label} (${pct}%)</span>`;
}

function getSegments(theme) {
    const text = (theme.theme + ' ' + (theme.problem_statement || '') + ' ' + (theme.hypothesis || '')).toLowerCase();
    const segments = [];
    if (text.includes('enterprise')) segments.push('Enterprise');
    if (text.includes('developer') || text.includes('api')) segments.push('Developers');
    if (text.includes('accessibility') || text.includes('night') || text.includes('dark')) segments.push('Accessibility');
    if (text.includes('smb')) segments.push('SMB');
    if (text.includes('billing') || text.includes('admin') || text.includes('onboarding')) segments.push('Admins');
    if (segments.length === 0) segments.push('General Users');
    return segments;
}

function showEvidence(idx) {
    navigateToPage('insights');
    setTimeout(() => {
        const detailsRow = document.getElementById(`details-row-${idx}`);
        const mainRow = document.getElementById(`main-row-${idx}`);
        if (detailsRow && mainRow) {
            mainRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
            toggleRow(idx);
        }
    }, 150);
}

// ===== EXPORT =====
async function handleExport() {
    if (!state.currentRunId) return;
    try {
        const btn = document.getElementById('exportBtn');
        const oldText = btn.innerHTML;
        btn.innerHTML = '<div class="step-spinner" style="width:14px; height:14px; border-width: 2px;"></div> Exporting...';
        btn.disabled = true;
        
        const res = await fetchWithAuth(`${API_BASE_URL}/export?run_id=${state.currentRunId}`);
        if (!res.ok) throw new Error('Export failed');
        
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `discoveryos_report_${state.currentRunId}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        
        showToast('Report exported successfully', 'success');
        
        btn.innerHTML = oldText;
        btn.disabled = false;
    } catch (e) {
        console.error(e);
        showToast('Export failed', 'error');
        document.getElementById('exportBtn').disabled = false;
    }
}

// ===== UTILS =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

let toastTimeout;
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = '<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    if(type === 'success') icon = '<svg class="icon text-success" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
    if(type === 'error') icon = '<svg class="icon text-danger" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    
    toast.innerHTML = `${icon} <span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}


// ===== AI COPILOT ENGINE =====

const copilot = {
    isOpen: false,
    history: [], // { role: 'user'|'ai', text: string, html: string }
    isThinking: false,

    // Suggestion chips shown at various stages
    defaultSuggestions: [
        'Which feature should we build first?',
        'What is the biggest churn risk?',
        'Which customer segment is most affected?',
        'What should our roadmap look like?',
        'Why is the top theme important?'
    ],
    reportSuggestions: [
        'Which feature should we build first?',
        'What is the biggest churn risk?',
        'Which segment is most affected?',
        'What should our roadmap be?',
        'What are the quick wins?',
        'Which theme has highest confidence?'
    ],

    init() {
        document.getElementById('copilotFab').addEventListener('click', () => this.toggle());
        document.getElementById('copilotClose').addEventListener('click', () => this.close());
        document.getElementById('copilotSend').addEventListener('click', () => this.sendMessage());

        const input = document.getElementById('copilotInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 100) + 'px';
        });

        this.renderWelcome();
        this.renderSuggestions();
    },

    toggle() {
        this.isOpen ? this.close() : this.open();
    },

    open() {
        this.isOpen = true;
        document.getElementById('copilotPanel').classList.add('open');
        document.getElementById('copilotInput').focus();
        this.scrollToBottom();
    },

    close() {
        this.isOpen = false;
        document.getElementById('copilotPanel').classList.remove('open');
    },

    scrollToBottom() {
        const el = document.getElementById('copilotMessages');
        setTimeout(() => { el.scrollTop = el.scrollHeight; }, 50);
    },

    renderWelcome() {
        const msgs = document.getElementById('copilotMessages');
        msgs.innerHTML = `
            <div class="copilot-msg ai">
                <div class="msg-avatar ai">✦</div>
                <div class="msg-bubble">
                    <strong>Hi, I'm your AI Product Manager Copilot.</strong><br><br>
                    I can analyze your current report data and answer questions like:<br>
                    <ul>
                        <li>Which feature to build first?</li>
                        <li>What is the biggest churn risk?</li>
                        <li>What does your roadmap look like?</li>
                    </ul>
                    Run an analysis first, then ask me anything.
                </div>
            </div>
        `;
    },

    renderSuggestions() {
        const chips = document.getElementById('copilotSuggestions');
        const suggestions = state.currentReport ? this.reportSuggestions : this.defaultSuggestions;
        chips.innerHTML = suggestions.map(s =>
            `<div class="suggestion-chip" onclick="copilot.askSuggestion(this)">${escapeHtml(s)}</div>`
        ).join('');
    },

    askSuggestion(el) {
        const text = el.textContent;
        document.getElementById('copilotInput').value = text;
        this.sendMessage();
    },

    appendMessage(role, html, rawText) {
        const msgs = document.getElementById('copilotMessages');
        const div = document.createElement('div');
        div.className = `copilot-msg ${role}`;
        div.innerHTML = `
            <div class="msg-avatar ${role === 'ai' ? 'ai' : 'user-av'}">${role === 'ai' ? '✦' : 'A'}</div>
            <div class="msg-bubble">${html}</div>
        `;
        msgs.appendChild(div);
        this.scrollToBottom();
        this.history.push({ role, html, rawText });
    },

    showThinking() {
        const msgs = document.getElementById('copilotMessages');
        const div = document.createElement('div');
        div.className = 'copilot-msg ai';
        div.id = 'copilotThinking';
        div.innerHTML = `
            <div class="msg-avatar ai">✦</div>
            <div class="copilot-thinking">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
        `;
        msgs.appendChild(div);
        this.scrollToBottom();
    },

    hideThinking() {
        const el = document.getElementById('copilotThinking');
        if (el) el.remove();
    },

    async sendMessage() {
        if (this.isThinking) return;
        const input = document.getElementById('copilotInput');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        input.style.height = 'auto';
        document.getElementById('copilotSend').disabled = true;

        this.appendMessage('user', escapeHtml(text), text);

        // Hide chips after first real message
        document.getElementById('copilotSuggestions').innerHTML = '';

        this.isThinking = true;
        this.showThinking();

        // Simulate thinking delay for UX (300–700ms)
        await new Promise(r => setTimeout(r, 350 + Math.random() * 350));

        this.hideThinking();
        const response = this.generateResponse(text);
        this.appendMessage('ai', response.html, response.text);

        // Restore context-aware suggestions after every reply
        this.renderSuggestions();

        this.isThinking = false;
        document.getElementById('copilotSend').disabled = false;
        input.focus();
    },

    // ===== INTENT DETECTION =====
    detectIntent(q) {
        const lower = q.toLowerCase();
        if (/build first|priorit|roadmap|next|should we|what to build|where to start|most important feature/.test(lower)) return 'priority';
        if (/churn|cancel|retain|lose|retention|at risk|leaving/.test(lower)) return 'churn';
        if (/segment|enterprise|smb|free|customer type|who is|which customer/.test(lower)) return 'segment';
        if (/roadmap|plan|quarter|q1|q2|q3|short.term|long.term|strategy|next steps/.test(lower)) return 'roadmap';
        if (/quick win|low.hanging|easy|fast|small bet|small change/.test(lower)) return 'quickwins';
        if (/confidence|certain|reliable|how sure|accuracy/.test(lower)) return 'confidence';
        if (/why|important|matter|impact|significant|reason/.test(lower)) return 'importance';
        if (/revenue|monetize|upsell|expand|earn/.test(lower)) return 'revenue';
        if (/summary|overview|tldr|recap|brief/.test(lower)) return 'summary';
        if (/sentiment|positive|negative|frustrated|happy/.test(lower)) return 'sentiment';
        return 'general';
    },

    // ===== THEME SCORING AGAINST QUERY =====
    rankThemes(query, themes, n = 3) {
        const words = query.toLowerCase().split(/\s+/);
        return [...themes]
            .map(t => {
                let score = t.priority_score || 0;
                const blob = [t.theme, t.problem_statement, t.hypothesis, ...(t.reasons || [])].join(' ').toLowerCase();
                words.forEach(w => { if (w.length > 3 && blob.includes(w)) score += 20; });
                return { ...t, _score: score };
            })
            .sort((a, b) => b._score - a._score)
            .slice(0, n);
    },

    cite(name) {
        return `<span class="citation">📌 ${escapeHtml(name)}</span>`;
    },

    // ===== NO REPORT STATE =====
    noReportHtml() {
        return `<div class="no-report-notice">
            <div class="notice-icon">📊</div>
            No analysis loaded yet. Please upload feedback and run an analysis first, then I can answer questions about your data.
        </div>`;
    },

    // ===== RESPONSE GENERATOR =====
    generateResponse(query) {
        const themes = state.currentReport?.themes;

        if (!themes || themes.length === 0) {
            return {
                html: this.noReportHtml(),
                text: 'No report data available.'
            };
        }

        const intent = this.detectIntent(query);
        let html = '';
        let text = '';

        const sorted = [...themes].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
        const top = sorted[0];
        const relevant = this.rankThemes(query, themes, 3);

        switch (intent) {

            case 'priority': {
                const top3 = sorted.slice(0, 3);
                html = `Based on your current analysis, here are the top priorities ranked by composite score:<br><br>
                    <ul>
                        ${top3.map((t, i) => `<li><strong>#${i+1} ${escapeHtml(t.theme)}</strong> — Priority Score: ${(t.priority_score || 0).toFixed(1)}, Confidence: ${(t.confidence_pct || 0).toFixed(0)}%<br>
                        <span style="color:var(--text-secondary);font-size:12px;">${escapeHtml(t.problem_statement || '')}</span></li>`).join('')}
                    </ul><br>
                    I recommend starting with ${this.cite(top.theme)} — it scores highest on both customer impact and strategic alignment under the current strategy (<strong>${escapeHtml(state.selectedStrategy)}</strong>).`;
                text = `Top priority: ${top.theme}`;
                break;
            }

            case 'churn': {
                const churnThemes = sorted.filter(t =>
                    (t.goal_tag || '').toLowerCase().includes('retention') ||
                    (t.problem_statement || '').toLowerCase().match(/churn|cancel|switch|retain|lose/)
                );
                const candidates = churnThemes.length > 0 ? churnThemes.slice(0, 2) : sorted.slice(0, 2);
                html = `The biggest churn risks identified from your data are:<br><br>
                    <ul>
                        ${candidates.map(t => `<li>${this.cite(t.theme)}<br>
                        <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(t.problem_statement || 'No problem statement')}</span></li>`).join('')}
                    </ul><br>
                    These themes show the highest severity and frequency, indicating customers are actively frustrated — not just mildly inconvenienced.`;
                text = `Churn risks: ${candidates.map(t => t.theme).join(', ')}`;
                break;
            }

            case 'segment': {
                // Collect segment mentions across themes
                const segCounts = {};
                themes.forEach(t => {
                    const bd = t.segment_breakdown || {};
                    Object.entries(bd).forEach(([seg, cnt]) => {
                        segCounts[seg] = (segCounts[seg] || 0) + (cnt || 0);
                    });
                });
                const topSeg = Object.entries(segCounts).sort((a, b) => b[1] - a[1]);
                const topSegName = topSeg[0]?.[0] || 'N/A';
                const segThemes = sorted.filter(t => {
                    const bd = t.segment_breakdown || {};
                    return Object.keys(bd).includes(topSegName);
                }).slice(0, 2);

                html = `Your most affected customer segment is <strong>${escapeHtml(topSegName)}</strong>, appearing across ${topSeg[0]?.[1] || 0} feedback mentions.<br><br>
                    The themes most relevant to this segment:<br>
                    <ul>${segThemes.map(t => `<li>${this.cite(t.theme)} — ${escapeHtml(t.problem_statement || '')}</li>`).join('')}</ul>
                    ${topSeg.length > 1 ? `<br>Other segments also impacted: <strong>${topSeg.slice(1, 3).map(s => s[0]).join(', ')}</strong>.` : ''}`;
                text = `Most affected segment: ${topSegName}`;
                break;
            }

            case 'roadmap': {
                const bets = { S: [], M: [], L: [] };
                themes.forEach(t => {
                    const size = (t.bet_size || 'M').toUpperCase();
                    if (bets[size]) bets[size].push(t);
                });
                html = `Here's a suggested roadmap based on your current analysis and <strong>${escapeHtml(state.selectedStrategy)}</strong>:<br><br>
                    <strong>🚀 Now (Quick wins — Small bets):</strong>
                    <ul>${(bets.S.slice(0, 2).length ? bets.S.slice(0, 2) : sorted.slice(0, 1)).map(t => `<li>${this.cite(t.theme)}</li>`).join('')}</ul>
                    <strong>📅 Next (Medium bets):</strong>
                    <ul>${(bets.M.slice(0, 2).length ? bets.M.slice(0, 2) : sorted.slice(1, 3)).map(t => `<li>${this.cite(t.theme)}</li>`).join('')}</ul>
                    <strong>🔭 Later (Large bets):</strong>
                    <ul>${(bets.L.slice(0, 1).length ? bets.L.slice(0, 1) : sorted.slice(3, 4)).map(t => `<li>${this.cite(t.theme)}</li>`).join('')}</ul>
                    Reprioritize as new feedback comes in.`;
                text = 'Roadmap suggested based on bet sizes';
                break;
            }

            case 'quickwins': {
                const qw = sorted.filter(t => (t.bet_size || 'M').toUpperCase() === 'S').slice(0, 3);
                const display = qw.length > 0 ? qw : sorted.slice(-2);
                html = `Quick wins are themes with high impact but small bet size. Based on your data:<br><br>
                    <ul>${display.map(t => `<li>${this.cite(t.theme)}<br>
                    <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(t.problem_statement || '')}</span></li>`).join('')}</ul>
                    These are relatively low-effort changes with disproportionate customer value.`;
                text = `Quick wins: ${display.map(t => t.theme).join(', ')}`;
                break;
            }

            case 'confidence': {
                const sorted_conf = [...themes].sort((a, b) => (b.confidence_pct || 0) - (a.confidence_pct || 0));
                const top3 = sorted_conf.slice(0, 3);
                const avg = Math.round(themes.reduce((s, t) => s + (t.confidence_pct || 0), 0) / themes.length);
                html = `Average confidence across all themes is <strong>${avg}%</strong>.<br><br>
                    The highest-confidence themes are:<br>
                    <ul>${top3.map(t => `<li>${this.cite(t.theme)} — <strong>${(t.confidence_pct || 0).toFixed(0)}%</strong></li>`).join('')}</ul>
                    Confidence is driven by multi-source corroboration, customer diversity, and frequency of mentions.`;
                text = `Average confidence: ${avg}%`;
                break;
            }

            case 'importance': {
                html = `${this.cite(top.theme)} is the most important issue right now because:<br><br>
                    <ul>
                        ${(top.reasons || [`Priority Score: ${(top.priority_score || 0).toFixed(1)}`]).map(r => `<li>${escapeHtml(r)}</li>`).join('')}
                    </ul>
                    <br>The problem statement: <em>"${escapeHtml(top.problem_statement || 'N/A')}"</em><br><br>
                    ${top.hypothesis ? `Hypothesis: ${escapeHtml(top.hypothesis)}` : ''}`;
                text = `Most important: ${top.theme}`;
                break;
            }

            case 'revenue': {
                const revThemes = sorted.filter(t => (t.goal_tag || '').toLowerCase().includes('revenue') || (t.goal_tag || '').toLowerCase().includes('adoption')).slice(0, 3);
                const display = revThemes.length ? revThemes : sorted.slice(0, 3);
                html = `To maximize revenue impact, focus on themes tied to adoption and retention risk:<br><br>
                    <ul>${display.map(t => `<li>${this.cite(t.theme)} — ${escapeHtml(t.problem_statement || '')}</li>`).join('')}</ul>
                    Fixing these removes blockers that prevent users from realizing the full value of the product — reducing churn and increasing expansion revenue.`;
                text = `Revenue themes: ${display.map(t => t.theme).join(', ')}`;
                break;
            }

            case 'summary': {
                const avgPriority = (themes.reduce((s, t) => s + (t.priority_score || 0), 0) / themes.length).toFixed(1);
                const avgConf = Math.round(themes.reduce((s, t) => s + (t.confidence_pct || 0), 0) / themes.length);
                html = `<strong>Analysis Summary</strong><br><br>
                    • <strong>${themes.length}</strong> themes identified<br>
                    • Average priority score: <strong>${avgPriority}</strong><br>
                    • Average confidence: <strong>${avgConf}%</strong><br>
                    • Strategy: <strong>${escapeHtml(state.selectedStrategy)}</strong><br><br>
                    <strong>Top 3 themes:</strong>
                    <ul>${sorted.slice(0, 3).map(t => `<li>${this.cite(t.theme)} (${(t.priority_score||0).toFixed(1)})</li>`).join('')}</ul>
                    ${state.currentReport.decision_boundary ? `<em>${escapeHtml(state.currentReport.decision_boundary)}</em>` : ''}`;
                text = 'Summary provided';
                break;
            }

            case 'sentiment': {
                const neg = themes.filter(t => (t.sentiment || '').toLowerCase() === 'negative').length;
                const pos = themes.filter(t => (t.sentiment || '').toLowerCase() === 'positive').length;
                const neu = themes.length - neg - pos;
                html = `Across your feedback dataset:<br><br>
                    • 🔴 <strong>Negative sentiment:</strong> ${neg} themes<br>
                    • 🟡 <strong>Neutral sentiment:</strong> ${neu} themes<br>
                    • 🟢 <strong>Positive sentiment:</strong> ${pos} themes<br><br>
                    ${neg > pos ? `The majority of feedback is <strong>negative</strong> — your customers are frustrated. Prioritize quick resolution of ${this.cite(top.theme)}.` :
                    `The feedback is relatively <strong>positive</strong> — customers appreciate the product but have specific improvement requests.`}`;
                text = `Sentiment: ${neg} negative, ${pos} positive, ${neu} neutral`;
                break;
            }

            default: {
                // General: find most relevant themes to the query, answer naturally
                const rel = this.rankThemes(query, themes, 2);
                if (rel.length > 0) {
                    html = `Based on your current analysis, the most relevant themes to your question are:<br><br>
                        <ul>${rel.map(t => `<li>${this.cite(t.theme)}<br>
                        <span style="font-size:12px;color:var(--text-secondary);">${escapeHtml(t.problem_statement || '')}</span></li>`).join('')}</ul>
                        These themes scored highest in relevance to what you asked. You can ask more specific questions like "What is the churn risk?" or "Which segment is most affected?" for deeper answers.`;
                } else {
                    html = `I couldn't find a specific match in your report for that question. Try asking:<br><br>
                        <ul>
                            <li>Which feature should we build first?</li>
                            <li>What is the biggest churn risk?</li>
                            <li>What should our roadmap be?</li>
                        </ul>`;
                }
                text = 'General response';
            }
        }

        return { html, text };
    }
};

// Initialize copilot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    copilot.init();
    
    const saveBtn = document.getElementById('saveConfigBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveConfig);
    }
});

// ===== AI ROADMAP GENERATOR =====

function setupRoadmapPage() {
    const btn = document.getElementById('generateRoadmapBtn');
    if (btn && !btn._bound) {
        btn.addEventListener('click', generateRoadmap);
        btn._bound = true;
    }
}

function generateRoadmap() {
    if (!state.currentReport || !state.currentReport.themes || state.currentReport.themes.length === 0) {
        showToast('No report data available. Run an analysis first.', 'warning');
        return;
    }

    const container = document.getElementById('roadmapContent');
    container.innerHTML = `
        <div class="roadmap-loading">
            <div class="roadmap-loading-spinner"></div>
            <p>Generating AI Roadmap...</p>
            <p class="loading-sub">Analyzing themes, scoring priorities, and mapping recommendations</p>
        </div>
    `;

    // Simulate AI thinking delay for UX
    setTimeout(() => {
        const roadmapData = buildRoadmapData(state.currentReport.themes, state.selectedStrategy);
        renderRoadmap(roadmapData);
        showToast('Roadmap generated successfully!', 'success');
    }, 800 + Math.random() * 600);
}

function buildRoadmapData(themes, strategy) {
    const sorted = [...themes].sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
    
    const now = [];
    const next = [];
    const later = [];

    sorted.forEach((theme, idx) => {
        const score = theme.priority_score || 0;
        const betSize = (theme.bet_size || 'M').toUpperCase();
        const severity = theme.severity || 0;
        const confidence = theme.confidence_pct || 0;
        const custImpact = theme.customer_impact || 0;
        const bizImpact = theme.business_impact || 0;

        // Determine priority label
        let priority;
        if (score >= 65 || (severity >= 4 && custImpact >= 4)) {
            priority = 'Critical';
        } else if (score >= 45) {
            priority = 'High';
        } else if (score >= 25) {
            priority = 'Medium';
        } else {
            priority = 'Low';
        }

        // Generate reason based on report data
        const reason = generateReason(theme, strategy, idx);

        // Customer impact text
        const customerImpactText = generateCustomerImpact(theme);

        // Business impact text
        const businessImpactText = generateBusinessImpact(theme, strategy);

        // Effort from bet_size
        const effortMap = { 'S': 'Small', 'M': 'Medium', 'L': 'Large' };
        const effort = effortMap[betSize] || 'Medium';

        // Risk assessment
        const risk = generateRisk(theme, betSize, confidence);

        const recommendation = {
            theme: theme.theme,
            priority,
            reason,
            customerImpact: customerImpactText,
            customerImpactStars: custImpact,
            businessImpact: businessImpactText,
            businessImpactStars: bizImpact,
            effort,
            effortCode: betSize,
            risk,
            score,
            confidence,
            problemStatement: theme.problem_statement || '',
            hypothesis: theme.hypothesis || ''
        };

        // Bucket into lanes
        if (betSize === 'S' || (score >= 55 && betSize !== 'L')) {
            now.push(recommendation);
        } else if (betSize === 'L' || score < 30) {
            later.push(recommendation);
        } else {
            next.push(recommendation);
        }
    });

    // If a lane is empty, redistribute
    if (now.length === 0 && next.length > 0) {
        now.push(next.shift());
    }
    if (later.length === 0 && next.length > 1) {
        later.push(next.pop());
    }
    if (next.length === 0 && now.length > 2) {
        next.push(now.pop());
    }

    return { now, next, later, strategy, totalThemes: themes.length };
}

function generateReason(theme, strategy, rank) {
    const reasons = theme.reasons || [];
    if (reasons.length > 0) {
        return reasons[0];
    }
    
    const ps = theme.problem_statement || theme.theme;
    if (rank === 0) {
        return `Highest-priority issue under "${strategy}" — directly impacts the most customers and aligns strongly with strategic goals.`;
    } else if ((theme.severity || 0) >= 4) {
        return `High severity score indicates urgent customer pain. ${ps}`;
    } else {
        return `${ps} — addresses a recurring pattern in customer feedback.`;
    }
}

function generateCustomerImpact(theme) {
    const stars = theme.customer_impact || 0;
    const freq = theme.frequency || 0;
    if (stars >= 4) {
        return `Very high — affects a large portion of users with ${freq} mentions across feedback sources.`;
    } else if (stars >= 3) {
        return `Moderate to high — ${freq} customer mentions indicating a broadly felt issue.`;
    } else if (stars >= 2) {
        return `Moderate — mentioned ${freq} times, impacting a meaningful user subset.`;
    }
    return `Limited — ${freq} mentions, affecting a smaller segment of users.`;
}

function generateBusinessImpact(theme, strategy) {
    const stars = theme.business_impact || 0;
    const goalTag = theme.goal_tag || 'Adoption blocker';
    if (stars >= 4) {
        return `Strong business alignment — tagged as "${goalTag}" under the "${strategy}" strategy.`;
    } else if (stars >= 3) {
        return `Good business relevance — classified as "${goalTag}" with moderate strategic weight.`;
    } else if (stars >= 2) {
        return `Some business relevance — "${goalTag}" with indirect strategic alignment.`;
    }
    return `Lower business priority under current "${strategy}" strategy.`;
}

function generateRisk(theme, betSize, confidence) {
    const risks = [];
    if (confidence < 60) {
        risks.push('Low confidence score — consider gathering more customer data before committing resources.');
    }
    if (betSize === 'L') {
        risks.push('Large effort estimate — requires significant engineering investment and cross-team coordination.');
    }
    if ((theme.severity || 0) >= 4 && betSize === 'L') {
        risks.push('Delayed action on a high-severity issue may accelerate customer churn.');
    }
    if (risks.length === 0) {
        if (betSize === 'S') {
            risks.push('Minimal risk — small scope with clear customer signal.');
        } else {
            risks.push('Moderate risk — monitor customer feedback post-launch to validate impact.');
        }
    }
    return risks[0];
}

function renderRoadmap(data) {
    const container = document.getElementById('roadmapContent');
    const totalItems = data.now.length + data.next.length + data.later.length;
    const avgConfidence = totalItems > 0
        ? Math.round([...data.now, ...data.next, ...data.later].reduce((s, r) => s + r.confidence, 0) / totalItems)
        : 0;

    let html = '';

    // Strategy tag
    html += `
        <div class="roadmap-strategy-tag">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            Strategy: ${escapeHtml(data.strategy)}
        </div>
    `;

    // Summary bar
    html += `
        <div class="roadmap-summary-bar">
            <div class="roadmap-summary-stat">
                <div class="stat-value">${totalItems}</div>
                <div class="stat-label">Recommendations</div>
            </div>
            <div class="roadmap-summary-stat">
                <div class="stat-value">${data.now.length}</div>
                <div class="stat-label">Act Now</div>
            </div>
            <div class="roadmap-summary-stat">
                <div class="stat-value">${data.next.length}</div>
                <div class="stat-label">Up Next</div>
            </div>
            <div class="roadmap-summary-stat">
                <div class="stat-value">${avgConfidence}%</div>
                <div class="stat-label">Avg Confidence</div>
            </div>
        </div>
    `;

    // Lanes
    html += `<div class="roadmap-lanes">`;
    html += renderLane('Now', data.now, 'now', '🚀', 'Immediate action — high impact, quick wins');
    html += renderLane('Next', data.next, 'next', '📅', 'Plan for next cycle — medium-term priorities');
    html += renderLane('Later', data.later, 'later', '🔭', 'Long-term bets — larger investments');
    html += `</div>`;

    container.innerHTML = html;
}

function renderLane(title, items, laneClass, emoji, description) {
    let html = `
        <div class="roadmap-lane lane-${laneClass}">
            <div class="roadmap-lane-header">
                <span class="lane-emoji">${emoji}</span>
                ${title}
                <span class="lane-count">${items.length}</span>
            </div>
    `;

    if (items.length === 0) {
        html += `<div style="text-align:center; padding: 24px; color: var(--text-tertiary); font-size: 13px;">No items in this lane</div>`;
    } else {
        items.forEach((item, idx) => {
            const priorityClass = `priority-${item.priority.toLowerCase()}`;
            const effortClass = `effort-${item.effortCode.toLowerCase()}`;
            
            const custImpactLevel = item.customerImpactStars >= 4 ? 'high' : item.customerImpactStars >= 2 ? 'medium' : 'low';
            const bizImpactLevel = item.businessImpactStars >= 4 ? 'high' : item.businessImpactStars >= 2 ? 'medium' : 'low';

            html += `
                <div class="roadmap-card" style="animation-delay: ${idx * 0.08}s">
                    <div class="roadmap-card-top">
                        <div class="roadmap-card-title">${escapeHtml(item.theme)}</div>
                        <span class="roadmap-card-priority ${priorityClass}">${item.priority}</span>
                    </div>
                    <div class="roadmap-card-body">
                        <div class="roadmap-card-reason">${escapeHtml(item.reason)}</div>
                        <div class="roadmap-metrics">
                            <span class="roadmap-metric-pill impact-${custImpactLevel}">
                                <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                Customer: ${renderMiniStars(item.customerImpactStars)}
                            </span>
                            <span class="roadmap-metric-pill impact-${bizImpactLevel}">
                                <svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
                                Business: ${renderMiniStars(item.businessImpactStars)}
                            </span>
                            <span class="roadmap-effort ${effortClass}">
                                ⚡ Effort: ${item.effort}
                            </span>
                        </div>
                    </div>
                    <div class="roadmap-card-footer">
                        <div class="roadmap-risk-label">Risk</div>
                        <div class="roadmap-risk-text">
                            <span class="risk-icon">⚠️</span>
                            <span>${escapeHtml(item.risk)}</span>
                        </div>
                    </div>
                </div>
            `;
        });
    }

    html += `</div>`;
    return html;
}

function renderMiniStars(val) {
    const f = Math.round(val);
    let s = '';
    for (let i = 0; i < 5; i++) {
        s += i < f ? '★' : '☆';
    }
    return s;
}

// ===== NEW ADDITIVE RENDER HELPERS (ICON/EMOJI-FREE) =====
function renderPriorityDots(priorityScore, severity) {
    const filledCount = Math.round((priorityScore || 0) / 20);
    let color;
    if (severity >= 4) {
        color = '#DC2626'; // High
    } else if (severity === 3) {
        color = '#F59E0B'; // Medium
    } else if (severity === 1 || severity === 2) {
        color = '#EAB308'; // Low
    } else {
        color = '#9CA3AF'; // Negligible
    }
    
    let html = '';
    for (let i = 0; i < 5; i++) {
        if (i < filledCount) {
            html += `<span style="color: ${color}; font-size: 14px; margin-right: 2px;">●</span>`;
        } else {
            html += `<span style="color: #D1D5DB; font-size: 14px; margin-right: 2px;">○</span>`;
        }
    }
    return html;
}

function renderSentimentBadge(sentiment) {
    if (!sentiment) return '';
    const s = sentiment.toLowerCase();
    let bg = '#F3F4F6', color = '#4B5563', border = '#E5E7EB';
    if (s === 'positive') {
        bg = '#DEF7EC';
        color = '#03543F';
        border = '#BCF0DA';
    } else if (s === 'negative') {
        bg = '#FDE8E8';
        color = '#9B1C1C';
        border = '#FBD5D5';
    }
    return `<span style="font-size: 11px; background: ${bg}; color: ${color}; padding: 2px 6px; border-radius: 6px; font-weight: 600; border: 1px solid ${border}; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(sentiment)}</span>`;
}

function renderGoalTagBadge(goalTag) {
    if (!goalTag) return '';
    return `<span style="font-size: 11px; background: #E0F2FE; color: #0369A1; padding: 2px 6px; border-radius: 6px; font-weight: 600; border: 1px solid #BAE6FD; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(goalTag)}</span>`;
}

function renderBetBadge(betSize) {
    if (!betSize) return '';
    return `<span style="font-size: 11px; background: #E0E7FF; color: #4338CA; padding: 2px 6px; border-radius: 6px; font-weight: 600; border: 1px solid #C7D2FE; text-transform: uppercase; letter-spacing: 0.02em;">${escapeHtml(betSize)}</span>`;
}

function renderTrendBadge() {
    return `<span style="font-size: 11px; background: #FEF3C7; color: #D97706; padding: 2px 6px; border-radius: 6px; font-weight: 600; border: 1px solid #FDE68A; text-transform: uppercase; letter-spacing: 0.02em;">ACCELERATING</span>`;
}

function toggleColumn(key) {
    state.visibleColumns[key] = !state.visibleColumns[key];
    renderInsights();
}

// ===== TEAM VIEWS PERSPECTIVES =====
function renderEngineeringView() {
    if (!state.currentReport) return;
    const themes = state.currentReport.themes || [];
    const container = document.getElementById('engineeringViewPage');
    if (!container) return;
    
    if (themes.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No themes found. Please upload feedback and run analysis first.</p></div>`;
        return;
    }
    
    const betOrder = { 'L': 3, 'M': 2, 'S': 1 };
    const sorted = [...themes].sort((a, b) => {
        const betA = a.bet_size || (a.priority_score >= 65 ? 'L' : a.priority_score >= 40 ? 'M' : 'S');
        const betB = b.bet_size || (b.priority_score >= 65 ? 'L' : b.priority_score >= 40 ? 'M' : 'S');
        const valA = betOrder[betA] || 0;
        const valB = betOrder[betB] || 0;
        if (valB !== valA) return valB - valA;
        return (b.priority_score || 0) - (a.priority_score || 0);
    });
    
    let html = `
        <div style="margin-bottom: var(--spacing-xl);">
            <h1>Engineering Perspective</h1>
            <p class="subtitle">Ranked by Bet Size (Large first) and priority score to guide sprint planning.</p>
        </div>
        
        <div class="card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--border-radius-lg);">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
                <thead>
                    <tr style="background: #F9FAFB; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-weight: 600;">
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Theme Name</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Bet Size</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Strategic Alignment</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Business Impact</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Priority Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map(t => {
                        const betSize = t.bet_size || (t.priority_score >= 65 ? 'L' : t.priority_score >= 40 ? 'M' : 'S');
                        const saVal = ((t.strategic_alignment || 0) * 20).toFixed(0);
                        const biVal = ((t.business_impact || 0) * 20).toFixed(0);
                        return `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 600; color: var(--text-primary);">${escapeHtml(t.theme)}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg);">${renderBetBadge(betSize)}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 500; color: var(--text-primary);">${saVal}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 500; color: var(--text-primary);">${biVal}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 700; color: var(--primary-blue);">${t.priority_score.toFixed(1)}</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = html;
}

function renderSalesView() {
    if (!state.currentReport) return;
    const themes = state.currentReport.themes || [];
    const container = document.getElementById('salesViewPage');
    if (!container) return;
    
    if (themes.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No themes found. Please upload feedback and run analysis first.</p></div>`;
        return;
    }
    
    const hasEnterprise = (t) => {
        const segs = getSegments(t);
        return segs.some(s => s.toLowerCase().includes('enterprise'));
    };
    
    const sorted = [...themes].sort((a, b) => {
        const entA = hasEnterprise(a) ? 1 : 0;
        const entB = hasEnterprise(b) ? 1 : 0;
        if (entB !== entA) return entB - entA;
        return (b.priority_score || 0) - (a.priority_score || 0);
    });
    
    let html = `
        <div style="margin-bottom: var(--spacing-xl);">
            <h1>Sales Perspective</h1>
            <p class="subtitle">Ranked to highlight Enterprise customer needs first, supporting sales conversations.</p>
        </div>
        
        <div class="card" style="padding: 0; overflow: hidden; border: 1px solid var(--border-color); border-radius: var(--border-radius-lg);">
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13.5px;">
                <thead>
                    <tr style="background: #F9FAFB; border-bottom: 1px solid var(--border-color); color: var(--text-secondary); font-weight: 600;">
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Theme Name</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Segments Affected</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Source Counts</th>
                        <th style="padding: var(--spacing-md) var(--spacing-lg);">Confidence</th>
                    </tr>
                </thead>
                <tbody>
                    ${sorted.map(t => {
                        const segments = getSegments(t);
                        const segmentsBadges = renderSegmentsBadges(segments);
                        const sourceEntries = Object.entries(t.source_counts || {});
                        const sourcesStr = sourceEntries.length > 0 
                            ? sourceEntries.map(([src, val]) => `${escapeHtml(src)} (${val})`).join(', ') 
                            : 'None';
                        return `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 600; color: var(--text-primary);">${escapeHtml(t.theme)}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg);">${segmentsBadges}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg); color: var(--text-secondary); font-weight: 500;">${sourcesStr}</td>
                                <td style="padding: var(--spacing-md) var(--spacing-lg); font-weight: 700; color: var(--text-primary);">${t.confidence_pct}%</td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = html;
}


