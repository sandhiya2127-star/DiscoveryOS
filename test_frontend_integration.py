#!/usr/bin/env python3
"""
Integration Test Suite for DiscoveryOS Frontend
Tests all backend API endpoints to verify frontend integration compatibility
"""

import requests
import json
import time
from pathlib import Path

API_BASE = "http://localhost:8000"
HEADERS = {"Content-Type": "application/json"}

# Test data
TEST_FEEDBACK = [
    {"raw_text": "Search functionality is broken", "source": "email", "segment": "enterprise", "customer_id": "cust_001"},
    {"raw_text": "Would love dark mode support", "source": "support_ticket", "segment": "smb", "customer_id": "cust_002"},
    {"raw_text": "Export to CSV is missing", "source": "survey", "segment": "free", "customer_id": "cust_003"},
]

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def log(self, test_name, success, message=""):
        if success:
            self.passed += 1
            print(f"✅ {test_name}")
        else:
            self.failed += 1
            self.errors.append(f"❌ {test_name}: {message}")
            print(f"❌ {test_name}: {message}")
    
    def summary(self):
        print(f"\n{'='*60}")
        print(f"Test Results: {self.passed} passed, {self.failed} failed")
        if self.errors:
            print("\nFailures:")
            for error in self.errors:
                print(f"  {error}")
        print(f"{'='*60}\n")
        return self.failed == 0

results = TestResults()

print("🧪 DiscoveryOS Backend Integration Tests\n")
print(f"API Base: {API_BASE}\n")

# ===== TEST 1: POST /ingest =====
print("TEST 1: POST /ingest (Upload feedback)")
try:
    files = {"file": ("test_feedback.json", json.dumps({"items": TEST_FEEDBACK}))}
    response = requests.post(f"{API_BASE}/ingest", files=files, timeout=10)
    
    if response.status_code == 200:
        data = response.json()
        inserted = data.get("inserted", 0)
        results.log("POST /ingest", inserted > 0, f"Inserted {inserted} items")
    else:
        results.log("POST /ingest", False, f"Status {response.status_code}")
except Exception as e:
    results.log("POST /ingest", False, str(e))

print()

# ===== TEST 2: POST /process =====
print("TEST 2: POST /process (Start analysis)")
run_id = None
try:
    response = requests.post(
        f"{API_BASE}/process?strategy=Improve Retention",
        timeout=120
    )
    
    if response.status_code == 200:
        data = response.json()
        run_id = data.get("run_id")
        strategy = data.get("strategy")
        themes_created = data.get("themes_created", 0)
        
        if run_id:
            results.log("POST /process", True, f"run_id={run_id}, themes={themes_created}")
        else:
            results.log("POST /process", False, "No run_id in response")
    else:
        results.log("POST /process", False, f"Status {response.status_code}")
except Exception as e:
    results.log("POST /process", False, str(e))

print()

# ===== TEST 3: GET /report =====
print("TEST 3: GET /report (Fetch results)")
if run_id:
    try:
        response = requests.get(f"{API_BASE}/report?run_id={run_id}", timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            themes = data.get("themes", [])
            summary = data.get("summary", "")
            decision_boundary = data.get("decision_boundary", "")
            
            has_themes = len(themes) > 0
            has_summary = len(summary) > 0
            has_boundary = len(decision_boundary) > 0
            
            results.log("GET /report", has_themes, f"themes={len(themes)}, summary={len(summary)} chars")
            
            if themes:
                print(f"  First theme structure:")
                first_theme = themes[0]
                print(f"    - theme: {first_theme.get('theme', 'N/A')[:50]}")
                print(f"    - priority_score: {first_theme.get('priority_score', 'N/A')}")
                print(f"    - confidence_pct: {first_theme.get('confidence_pct', 'N/A')}")
                print(f"    - customer_impact: {first_theme.get('customer_impact', 'N/A')}")
                print(f"    - business_impact: {first_theme.get('business_impact', 'N/A')}")
                print(f"    - severity: {first_theme.get('severity', 'N/A')}")
                print(f"    - strategic_alignment: {first_theme.get('strategic_alignment', 'N/A')}")
        else:
            results.log("GET /report", False, f"Status {response.status_code}")
    except Exception as e:
        results.log("GET /report", False, str(e))
else:
    print("⏭️  Skipping (no run_id from /process)")

print()

# ===== TEST 4: POST /reprocess =====
print("TEST 4: POST /reprocess (Change strategy)")
if run_id:
    try:
        response = requests.post(
            f"{API_BASE}/reprocess?run_id={run_id}&strategy=Increase Revenue",
            timeout=10
        )
        
        if response.status_code == 200:
            data = response.json()
            themes = data.get("themes", [])
            strategy = data.get("strategy", "")
            
            results.log("POST /reprocess", len(themes) > 0, f"strategy={strategy}, themes={len(themes)}")
            
            if themes:
                print(f"  Re-ranked themes (sample):")
                for i, t in enumerate(themes[:2], 1):
                    print(f"    {i}. {t.get('theme', 'N/A')[:40]} (priority={t.get('priority_score', 'N/A')})")
        else:
            results.log("POST /reprocess", False, f"Status {response.status_code}")
    except Exception as e:
        results.log("POST /reprocess", False, str(e))
else:
    print("⏭️  Skipping (no run_id from /process)")

print()

# ===== TEST 5: GET /export =====
print("TEST 5: GET /export (Download CSV)")
if run_id:
    try:
        response = requests.get(f"{API_BASE}/export?run_id={run_id}", timeout=10)
        
        if response.status_code == 200:
            csv_content = response.text
            lines = csv_content.strip().split('\n')
            has_header = 'theme' in lines[0].lower()
            has_data = len(lines) > 1
            
            results.log("GET /export", has_header and has_data, f"CSV lines={len(lines)}")
            
            if lines:
                print(f"  CSV Header: {lines[0][:100]}")
                if len(lines) > 1:
                    print(f"  First Row: {lines[1][:100]}")
        else:
            results.log("GET /export", False, f"Status {response.status_code}")
    except Exception as e:
        results.log("GET /export", False, str(e))
else:
    print("⏭️  Skipping (no run_id from /process)")

print()

# ===== SUMMARY =====
success = results.summary()

if success:
    print("🎉 All backend integration tests passed!")
    print("✅ Frontend is fully compatible with backend API")
    exit(0)
else:
    print("⚠️  Some tests failed. Check the errors above.")
    exit(1)
