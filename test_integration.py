import requests
import json
import time
import sys
import os
os.environ['PYTHONIOENCODING'] = 'utf-8'
sys.stdout.reconfigure(encoding='utf-8')

BASE_URL = "http://localhost:8000"

print("=" * 60)
print("DISCOVERYOS INTEGRATION TEST")
print("=" * 60)

# Test 1: Check frontend loads
print("\n[TEST 1] Checking if frontend loads...")
try:
    response = requests.get(f"{BASE_URL}/")
    if response.status_code == 200 and "index.html" not in response.text:
        # StaticFiles should serve HTML content
        print("✅ Frontend loads at root URL")
        print(f"   Response size: {len(response.text)} bytes")
        print(f"   Content type: {response.headers.get('content-type')}")
    else:
        print(f"❌ Frontend returned status {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 2: Check Swagger docs
print("\n[TEST 2] Checking Swagger documentation...")
try:
    response = requests.get(f"{BASE_URL}/docs")
    if response.status_code == 200:
        print("✅ Swagger docs accessible")
    else:
        print(f"❌ Swagger returned status {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 3: Check app.js loads
print("\n[TEST 3] Checking if app.js loads...")
try:
    response = requests.get(f"{BASE_URL}/app.js")
    if response.status_code == 200 and "const state" in response.text:
        print("✅ app.js loads successfully")
        print(f"   File size: {len(response.text)} bytes")
        lines = response.text.count('\n')
        print(f"   Lines of code: {lines}")
    else:
        print(f"❌ app.js returned status {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 4: Check styles.css loads
print("\n[TEST 4] Checking if styles.css loads...")
try:
    response = requests.get(f"{BASE_URL}/styles.css")
    if response.status_code == 200 and "--bg-primary" in response.text:
        print("✅ styles.css loads successfully")
        print(f"   File size: {len(response.text)} bytes")
    else:
        print(f"❌ styles.css returned status {response.status_code}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 5: Check CORS headers
print("\n[TEST 5] Checking CORS headers...")
try:
    response = requests.options(f"{BASE_URL}/ingest", headers={"Origin": "http://localhost:3000"})
    cors_headers = {
        "Access-Control-Allow-Origin": response.headers.get("access-control-allow-origin"),
        "Access-Control-Allow-Methods": response.headers.get("access-control-allow-methods"),
        "Access-Control-Allow-Headers": response.headers.get("access-control-allow-headers"),
    }
    if cors_headers["Access-Control-Allow-Origin"] == "*":
        print("✅ CORS properly configured")
        for key, value in cors_headers.items():
            print(f"   {key}: {value}")
    else:
        print("❌ CORS not properly configured")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 6: Test file upload simulation
print("\n[TEST 6] Testing file upload (POST /ingest)...")
try:
    # Create a test file
    test_data = "Customer feedback test\nSearch is broken\nNeed dark mode"
    files = {'file': ('test_feedback.txt', test_data.encode())}
    
    response = requests.post(f"{BASE_URL}/ingest", files=files)
    if response.status_code == 200:
        result = response.json()
        print("✅ File upload successful")
        print(f"   Response: {result}")
    else:
        print(f"❌ Upload returned status {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 7: Test process endpoint
print("\n[TEST 7] Testing process endpoint (POST /process)...")
try:
    response = requests.post(f"{BASE_URL}/process?strategy=Improve%20Retention")
    if response.status_code == 200:
        result = response.json()
        run_id = result.get('run_id')
        print("✅ Process endpoint successful")
        print(f"   Response: {result}")
        print(f"   Run ID: {run_id}")
        
        # Save run_id for next test
        with open('test_run_id.txt', 'w') as f:
            f.write(str(run_id))
    else:
        print(f"❌ Process returned status {response.status_code}")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 8: Test report endpoint
print("\n[TEST 8] Testing report endpoint (GET /report)...")
try:
    # Read run_id from previous test
    with open('test_run_id.txt', 'r') as f:
        run_id = f.read().strip()
    
    response = requests.get(f"{BASE_URL}/report?run_id={run_id}")
    if response.status_code == 200:
        result = response.json()
        print("✅ Report endpoint successful")
        print(f"   Keys: {list(result.keys())}")
        if 'summary' in result:
            print(f"   Summary: {result['summary'][:100]}...")
        if 'themes' in result:
            print(f"   Themes count: {len(result['themes'])}")
        if 'decision_boundary' in result:
            print(f"   Decision boundary: {result['decision_boundary'][:50]}...")
    else:
        print(f"❌ Report returned status {response.status_code}")
        if response.status_code == 404:
            print("   (404 - No themes found - this is expected for empty analysis)")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 9: Test reprocess endpoint
print("\n[TEST 9] Testing reprocess endpoint (POST /reprocess)...")
try:
    with open('test_run_id.txt', 'r') as f:
        run_id = f.read().strip()
    
    response = requests.post(
        f"{BASE_URL}/reprocess?run_id={run_id}&strategy=Increase%20Revenue"
    )
    if response.status_code == 200:
        result = response.json()
        print("✅ Reprocess endpoint successful")
        print(f"   Strategy: {result.get('strategy')}")
        print(f"   Themes count: {len(result.get('themes', []))}")
    else:
        print(f"❌ Reprocess returned status {response.status_code}")
        if response.status_code == 404:
            print("   (404 - Expected if no themes)")
        print(f"   Response: {response.text}")
except Exception as e:
    print(f"❌ Error: {e}")

# Test 10: Test export endpoint
print("\n[TEST 10] Testing export endpoint (GET /export)...")
try:
    with open('test_run_id.txt', 'r') as f:
        run_id = f.read().strip()
    
    response = requests.get(f"{BASE_URL}/export?run_id={run_id}")
    if response.status_code == 200:
        print("✅ Export endpoint successful")
        print(f"   Content-Type: {response.headers.get('content-type')}")
        print(f"   File size: {len(response.content)} bytes")
        print(f"   First 100 chars: {response.text[:100]}...")
    else:
        print(f"❌ Export returned status {response.status_code}")
        if response.status_code == 404:
            print("   (404 - Expected if no themes)")
except Exception as e:
    print(f"❌ Error: {e}")

print("\n" + "=" * 60)
print("TEST COMPLETE")
print("=" * 60)
