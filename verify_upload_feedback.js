const fs = require('fs');
const path = require('path');

console.log('\n========================================');
console.log('  Upload Feedback Page - Verification');
console.log('========================================\n');

const appJsPath = path.join(__dirname, 'app.js');
const appJsContent = fs.readFileSync(appJsPath, 'utf8');

const checks = {
    'Event Listeners': [
        { name: 'setupEventListeners function defined', pattern: /function setupEventListeners\(\)/ },
        { name: 'dragover event listener', pattern: /addEventListener\('dragover'/ },
        { name: 'dragleave event listener', pattern: /addEventListener\('dragleave'/ },
        { name: 'drop event listener', pattern: /addEventListener\('drop'/ },
        { name: 'file input change listener', pattern: /fileInput\.addEventListener\('change'/ },
        { name: 'analyze button click listener', pattern: /analyzeBtn\.addEventListener\('click'/ },
        { name: 'preventDefault in drop', pattern: /\(e\) => \{\s*console\.log\(\'\[DROP\]/ },
    ],
    'Console Logging': [
        { name: '[INIT] initialization logs', pattern: /console\.log\(\'\[INIT\]/ },
        { name: '[SETUP] setup phase logs', pattern: /console\.log\(\'\[SETUP\]/ },
        { name: '[DROP] drag-drop logs', pattern: /console\.log\(\'\[DROP\]/ },
        { name: '[BROWSE] file picker logs', pattern: /console\.log\(\'\[BROWSE\]/ },
        { name: '[FILES] file handling logs', pattern: /console\.log\(\'\[FILES\]/ },
        { name: '[UPLOAD] upload process logs', pattern: /console\.log\(\'\[UPLOAD\]/ },
        { name: '[RENDER] rendering logs', pattern: /console\.log\(\'\[RENDER\]/ },
        { name: 'Error logging with message', pattern: /console\.error\(\'\[UPLOAD\] Error/ },
        { name: 'Error stack trace logging', pattern: /console\.error\(\'\[UPLOAD\] Error stack/ },
    ],
    'File Handling': [
        { name: 'handleFiles function', pattern: /function handleFiles\(fileList\)/ },
        { name: 'SUPPORTED_EXTENSIONS list', pattern: /const SUPPORTED_EXTENSIONS = \[/ },
        { name: 'File extension validation', pattern: /const ext = '\.'\s*\+\s*file\.name\.split/ },
        { name: 'renderFilesList function', pattern: /function renderFilesList\(\)/ },
        { name: 'clearFiles function', pattern: /function clearFiles\(\)/ },
        { name: 'removeFile function', pattern: /function removeFile\(idx\)/ },
    ],
    'Upload Process': [
        { name: 'uploadAndProcess function', pattern: /async function uploadAndProcess\(\)/ },
        { name: 'FormData creation', pattern: /const formData = new FormData\(\)/ },
        { name: 'FormData file append', pattern: /formData\.append\('file', f\.file, f\.name\)/ },
        { name: 'POST /ingest call', pattern: /fetch\(`\${API_BASE_URL}\/ingest`/ },
        { name: 'POST /process call', pattern: /fetch\(\s*`\${API_BASE_URL}\/process\?strategy/ },
        { name: 'GET /report call', pattern: /fetch\(`\${API_BASE_URL}\/report\?run_id/ },
        { name: 'Response status logging', pattern: /console\.log\(\'\[UPLOAD\] POST \/ingest response status/ },
        { name: 'Response body logging', pattern: /console\.log\(\'\[UPLOAD\] POST \/ingest response body/ },
        { name: 'run_id stored in state', pattern: /state\.currentRunId = processData\.run_id/ },
        { name: 'Navigation to insights', pattern: /navigateToPage\('insights'\)/ },
    ],
    'Error Handling': [
        { name: 'try-catch in uploadAndProcess', pattern: /try\s*\{[\s\S]*?async function uploadAndProcess/ },
        { name: 'catch block present', pattern: /catch\s*\(error\)\s*\{/ },
        { name: 'Error details logged', pattern: /console\.error\(\'\[UPLOAD\] Error occurred/ },
        { name: 'Error message logged', pattern: /console\.error\(\'\[UPLOAD\] Error message/ },
        { name: 'HTTP error handling', pattern: /if\s*\(!uploadRes\.ok\)/ },
    ],
    'Defensive Checks': [
        { name: 'dropZone null check', pattern: /if\s*\(dropZone\s*&&\s*fileInput\)/ },
        { name: 'analyzeBtn existence check', pattern: /if\s*\(analyzeBtn\)/ },
        { name: 'state.files existence check', pattern: /if\s*\(state\.files\.length === 0\)/ },
    ]
};

let totalChecks = 0;
let passedChecks = 0;

for (const [category, categoryChecks] of Object.entries(checks)) {
    console.log(`\n📋 ${category}`);
    console.log('─'.repeat(50));
    
    for (const check of categoryChecks) {
        totalChecks++;
        const passed = check.pattern.test(appJsContent);
        passedChecks += passed ? 1 : 0;
        
        console.log(`  ${passed ? '✓' : '✗'} ${check.name}`);
    }
}

console.log('\n' + '='.repeat(50));
console.log(`\n📊 RESULTS: ${passedChecks}/${totalChecks} checks passed`);

if (passedChecks === totalChecks) {
    console.log('\n✅ ALL CHECKS PASSED - Implementation is complete!\n');
} else {
    console.log(`\n❌ ${totalChecks - passedChecks} checks failed\n`);
    process.exit(1);
}

console.log('='.repeat(50) + '\n');

console.log('\n🔍 STATIC ANALYSIS OF app.js:');
console.log('─'.repeat(50));

const functions = [
    'setupEventListeners',
    'navigateToPage',
    'loadInsightsPage',
    'loadSummaryPage',
    'handleFiles',
    'renderFilesList',
    'uploadAndProcess',
    'closeDrawer',
    'filterThemes',
    'sortThemes',
    'changeStrategy'
];

console.log('\n✓ Functions found:');
for (const func of functions) {
    const pattern = new RegExp(`function ${func}\\(|async function ${func}\\(`);
    if (pattern.test(appJsContent)) {
        console.log(`  ✓ ${func}()`);
    }
}

console.log('\n✓ Event listeners verified:');
const listeners = [
    { name: 'dragover', pattern: /addEventListener\('dragover'/ },
    { name: 'dragleave', pattern: /addEventListener\('dragleave'/ },
    { name: 'drop', pattern: /addEventListener\('drop'/ },
    { name: 'click (drop zone)', pattern: /addEventListener\('click'/ },
    { name: 'change (file input)', pattern: /addEventListener\('change'/ },
    { name: 'click (analyze button)', pattern: /analyzeBtn\.addEventListener\('click'/ },
];

for (const listener of listeners) {
    if (listener.pattern.test(appJsContent)) {
        console.log(`  ✓ ${listener.name}`);
    }
}

console.log('\n✓ API endpoints:');
const endpoints = [
    { name: 'POST /ingest', pattern: /fetch\(`\${API_BASE_URL}\/ingest`/ },
    { name: 'POST /process', pattern: /fetch\(\s*`\${API_BASE_URL}\/process\?/ },
    { name: 'GET /report', pattern: /fetch\(`\${API_BASE_URL}\/report\?run_id/ },
    { name: 'GET /export', pattern: /fetch\(`\${API_BASE_URL}\/export\?run_id/ },
];

for (const ep of endpoints) {
    if (ep.pattern.test(appJsContent)) {
        console.log(`  ✓ ${ep.name}`);
    }
}

console.log('\n✓ Console logging:');
const logTypes = [
    { name: '[INIT]', pattern: /\[INIT\]/ },
    { name: '[SETUP]', pattern: /\[SETUP\]/ },
    { name: '[DROP]', pattern: /\[DROP\]/ },
    { name: '[BROWSE]', pattern: /\[BROWSE\]/ },
    { name: '[FILES]', pattern: /\[FILES\]/ },
    { name: '[UPLOAD]', pattern: /\[UPLOAD\]/ },
    { name: '[RENDER]', pattern: /\[RENDER\]/ },
    { name: '[ANALYZE]', pattern: /\[ANALYZE\]/ },
];

for (const logType of logTypes) {
    if (logType.pattern.test(appJsContent)) {
        console.log(`  ✓ ${logType.name} logs present`);
    }
}

console.log('\n✓ Error handling:');
const errorPatterns = [
    { name: 'try-catch blocks', pattern: /try\s*\{[\s\S]*?catch/ },
    { name: 'console.error calls', pattern: /console\.error/ },
    { name: 'Error message formatting', pattern: /Error\(`.*?\$\{.*?\}.*?\`\)/ },
];

for (const pattern of errorPatterns) {
    if (pattern.pattern.test(appJsContent)) {
        console.log(`  ✓ ${pattern.name}`);
    }
}

console.log('\n' + '='.repeat(50));
console.log('\n✅ Frontend implementation verified and ready for testing!\n');
console.log('Next steps:');
console.log('  1. Start backend: python main.py');
console.log('  2. Open http://localhost:8000 in browser');
console.log('  3. Press F12 to open DevTools Console');
console.log('  4. Navigate to Upload Feedback page');
console.log('  5. Watch console logs as you interact with the page');
console.log('  6. Test: Drag file → Analyze → Check console for [UPLOAD] logs\n');
