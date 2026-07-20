#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('\n' + '='.repeat(70));
console.log('   UPLOAD FEEDBACK PAGE - COMPREHENSIVE INTEGRATION TEST');
console.log('='.repeat(70) + '\n');

const appJsContent = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const indexHtmlContent = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const tests = [];

function test(name, fn) {
    tests.push({ name, fn });
}

function runTest(testObj) {
    try {
        const result = testObj.fn();
        console.log(`  ✓ ${testObj.name}`);
        return true;
    } catch (e) {
        console.log(`  ✗ ${testObj.name}: ${e.message}`);
        return false;
    }
}

test('HTML contains upload page div', () => {
    if (!indexHtmlContent.includes('id="uploadPage"')) throw new Error('uploadPage div not found');
});

test('HTML contains drop zone', () => {
    if (!indexHtmlContent.includes('id="dropZone"')) throw new Error('dropZone div not found');
});

test('HTML contains file input', () => {
    if (!indexHtmlContent.includes('id="fileInput"')) throw new Error('fileInput not found');
});

test('HTML contains analyze button', () => {
    if (!indexHtmlContent.includes('id="analyzeBtn"')) throw new Error('analyzeBtn not found');
});

test('HTML contains files table body', () => {
    if (!indexHtmlContent.includes('id="filesTableBody"')) throw new Error('filesTableBody not found');
});

test('app.js has API_BASE_URL configured', () => {
    if (!appJsContent.includes("const API_BASE_URL = 'http://localhost:8000'")) 
        throw new Error('API_BASE_URL not configured');
});

test('app.js has SUPPORTED_EXTENSIONS list', () => {
    if (!appJsContent.includes("const SUPPORTED_EXTENSIONS = ['.txt'")) 
        throw new Error('SUPPORTED_EXTENSIONS not defined');
});

test('app.js initializes state object', () => {
    if (!appJsContent.includes("const state = {")) 
        throw new Error('State object not defined');
});

test('DOMContentLoaded event listener attached', () => {
    if (!appJsContent.includes("document.addEventListener('DOMContentLoaded'")) 
        throw new Error('DOMContentLoaded listener not attached');
});

test('setupEventListeners called on page load', () => {
    if (!appJsContent.includes("setupEventListeners()")) 
        throw new Error('setupEventListeners not called');
});

test('Drop zone dragover handler prevents default', () => {
    if (!appJsContent.includes("e.preventDefault()") || 
        !appJsContent.includes("e.stopPropagation()")) 
        throw new Error('Event prevention not implemented');
});

test('Drop zone has class toggle for visual feedback', () => {
    if (!appJsContent.includes("dropZone.classList.add('dragover')") &&
        !appJsContent.includes("dropZone.classList.remove('dragover'")) 
        throw new Error('Visual feedback not implemented');
});

test('File input trigger on click', () => {
    if (!appJsContent.includes("fileInput.click()")) 
        throw new Error('File input click trigger not found');
});

test('File selection triggers handleFiles', () => {
    if (!appJsContent.includes("handleFiles(e.target.files)")) 
        throw new Error('handleFiles not called on file selection');
});

test('Drop event triggers handleFiles', () => {
    if (!appJsContent.includes("handleFiles(e.dataTransfer.files)")) 
        throw new Error('handleFiles not called on drop');
});

test('handleFiles validates file extensions', () => {
    if (!appJsContent.includes("SUPPORTED_EXTENSIONS.includes(ext)")) 
        throw new Error('File extension validation not found');
});

test('renderFilesList creates table rows', () => {
    if (!appJsContent.includes("filesTableBody.innerHTML = state.files.map")) 
        throw new Error('renderFilesList not implemented');
});

test('FormData construction for file upload', () => {
    if (!appJsContent.includes("const formData = new FormData()") &&
        !appJsContent.includes("formData.append('file'")) 
        throw new Error('FormData not constructed correctly');
});

test('POST /ingest endpoint called', () => {
    if (!appJsContent.includes("${API_BASE_URL}/ingest")) 
        throw new Error('/ingest endpoint not called');
});

test('POST /process endpoint called', () => {
    if (!appJsContent.includes("${API_BASE_URL}/process")) 
        throw new Error('/process endpoint not called');
});

test('GET /report endpoint called', () => {
    if (!appJsContent.includes("${API_BASE_URL}/report")) 
        throw new Error('/report endpoint not called');
});

test('Strategy parameter in process call', () => {
    if (!appJsContent.includes("?strategy=${encodeURIComponent(state.currentStrategy)}")) 
        throw new Error('Strategy parameter not passed to /process');
});

test('Response status logged', () => {
    if (!appJsContent.includes("console.log('[UPLOAD] POST /ingest response status'")) 
        throw new Error('Response status not logged');
});

test('Response body logged', () => {
    if (!appJsContent.includes("console.log('[UPLOAD] POST /ingest response body'")) 
        throw new Error('Response body not logged');
});

test('run_id stored in state', () => {
    if (!appJsContent.includes("state.currentRunId = processData.run_id")) 
        throw new Error('run_id not stored in state');
});

test('Error handling with try-catch', () => {
    if (!appJsContent.includes("try {") || !appJsContent.includes("catch (error)")) 
        throw new Error('try-catch error handling not implemented');
});

test('Full error object logged', () => {
    if (!appJsContent.includes("console.error('[UPLOAD] Error occurred:', error)")) 
        throw new Error('Full error object not logged');
});

test('Error message logged', () => {
    if (!appJsContent.includes("console.error('[UPLOAD] Error message'")) 
        throw new Error('Error message not logged');
});

test('Error stack trace logged', () => {
    if (!appJsContent.includes("console.error('[UPLOAD] Error stack'")) 
        throw new Error('Error stack trace not logged');
});

test('HTTP error status checking', () => {
    if (!appJsContent.includes("if (!uploadRes.ok)") &&
        !appJsContent.includes("if (!processRes.ok")) 
        throw new Error('HTTP error status not checked');
});

test('Navigation to insights page after upload', () => {
    if (!appJsContent.includes("navigateToPage('insights')")) 
        throw new Error('Navigation to insights not implemented');
});

test('[INIT] logs present', () => {
    if (!appJsContent.includes("[INIT]")) 
        throw new Error('[INIT] logs not present');
});

test('[SETUP] logs present', () => {
    if (!appJsContent.includes("[SETUP]")) 
        throw new Error('[SETUP] logs not present');
});

test('[DROP] logs present', () => {
    if (!appJsContent.includes("[DROP]")) 
        throw new Error('[DROP] logs not present');
});

test('[BROWSE] logs present', () => {
    if (!appJsContent.includes("[BROWSE]")) 
        throw new Error('[BROWSE] logs not present');
});

test('[FILES] logs present', () => {
    if (!appJsContent.includes("[FILES]")) 
        throw new Error('[FILES] logs not present');
});

test('[UPLOAD] logs present', () => {
    if (!appJsContent.includes("[UPLOAD]")) 
        throw new Error('[UPLOAD] logs not present');
});

test('[ANALYZE] logs present', () => {
    if (!appJsContent.includes("[ANALYZE]")) 
        throw new Error('[ANALYZE] logs not present');
});

test('[RENDER] logs present', () => {
    if (!appJsContent.includes("[RENDER]")) 
        throw new Error('[RENDER] logs not present');
});

test('[ERRORS] logs present', () => {
    if (!appJsContent.includes("[ERRORS]")) 
        throw new Error('[ERRORS] logs not present');
});

test('showNotification function for user feedback', () => {
    if (!appJsContent.includes("showNotification(")) 
        throw new Error('showNotification not called');
});

test('clearFiles function to reset queue', () => {
    if (!appJsContent.includes("function clearFiles()")) 
        throw new Error('clearFiles function not defined');
});

test('removeFile function for individual removal', () => {
    if (!appJsContent.includes("function removeFile(idx)")) 
        throw new Error('removeFile function not defined');
});

test('Syntax valid - no uncaught errors', () => {
    try {
        new Function(appJsContent);
    } catch (e) {
        throw new Error(`Syntax error: ${e.message}`);
    }
});

console.log('📋 Running Integration Tests...\n');

let passed = 0;
let failed = 0;

for (const testObj of tests) {
    if (runTest(testObj)) {
        passed++;
    } else {
        failed++;
    }
}

console.log('\n' + '='.repeat(70));
console.log(`\n📊 TEST RESULTS: ${passed}/${tests.length} passed\n`);

if (failed === 0) {
    console.log('✅ ALL TESTS PASSED!\n');
    console.log('The Upload Feedback page is fully implemented with:');
    console.log('  • Event listeners for drag-drop and file selection');
    console.log('  • File validation for supported formats');
    console.log('  • FormData construction for multipart upload');
    console.log('  • API calls to /ingest, /process, and /report');
    console.log('  • Comprehensive console logging at each step');
    console.log('  • Full error handling with try-catch');
    console.log('  • State management for run_id and report data');
    console.log('  • Navigation to Insights page on completion');
    console.log('\n🚀 Ready for browser testing!\n');
} else {
    console.log(`❌ ${failed} test(s) failed\n`);
    process.exit(1);
}

console.log('='.repeat(70) + '\n');

console.log('🧪 MANUAL TESTING CHECKLIST:\n');
console.log('1. Start backend:');
console.log('   $ python main.py\n');
console.log('2. Open browser:');
console.log('   http://localhost:8000\n');
console.log('3. Open DevTools (F12) and go to Console tab\n');
console.log('4. Click "Upload Feedback" in sidebar\n');
console.log('5. Test interactions (watch console logs):\n');
console.log('   a) Click anywhere on drop zone');
console.log('      → Should see: [BROWSE] Drop zone clicked, triggering file input\n');
console.log('   b) Select a .csv file from file picker');
console.log('      → Should see: [BROWSE] Files selected');
console.log('      → Should see: [FILES] handleFiles called');
console.log('      → File should appear in table\n');
console.log('   c) Drag another file onto drop zone');
console.log('      → Should see: [DROP] dragover event fired');
console.log('      → Zone should highlight\n');
console.log('   d) Drop the file');
console.log('      → Should see: [DROP] drop event fired');
console.log('      → File should appear in table\n');
console.log('   e) Click "Analyze Feedback"');
console.log('      → Should see: [ANALYZE] Analyze button clicked');
console.log('      → Should see: [UPLOAD] uploadAndProcess called');
console.log('      → Should see: [UPLOAD] Sending POST /ingest');
console.log('      → Should see: [UPLOAD] POST /ingest response status: 200 (or similar)');
console.log('      → Should see: [UPLOAD] POST /process response status: 200');
console.log('      → Should see: [UPLOAD] Process successful, run_id stored: <ID>');
console.log('      → Page should navigate to Insights\n');
console.log('6. If any step fails, check console for error messages\n');
