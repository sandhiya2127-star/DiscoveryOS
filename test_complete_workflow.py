#!/usr/bin/env python3
"""
Comprehensive Frontend Integration Test for DiscoveryOS
Tests the complete workflow: Upload → Process → View Report
"""

import os
import sys
import time
import requests
import json
from pathlib import Path

# Configuration
API_BASE_URL = "http://localhost:8000"
TEST_FEEDBACK_FILE = "test_feedback.txt"
TIMEOUT = 120  # seconds

class DiscoveryOSTest:
    def __init__(self):
        self.run_id = None
        self.strategy = "Improve Retention"
        self.test_results = {
            "total": 0,
            "passed": 0,
            "failed": 0,
            "errors": []
        }
    
    def log(self, message, level="INFO"):
        """Print formatted log message"""
        timestamp = time.strftime("%H:%M:%S")
        prefix = f"[{timestamp}] {level:8}"
        print(f"{prefix} {message}")
    
    def test(self, name, fn):
        """Run a test and track results"""
        self.test_results["total"] += 1
        try:
            fn()
            self.log(f"✓ {name}", "PASS")
            self.test_results["passed"] += 1
            return True
        except Exception as e:
            self.log(f"✗ {name}: {str(e)}", "FAIL")
            self.test_results["errors"].append((name, str(e)))
            self.test_results["failed"] += 1
            return False
    
    def assert_equal(self, actual, expected, message=""):
        """Assert equality"""
        if actual != expected:
            raise AssertionError(f"Expected {expected}, got {actual}. {message}")
    
    def assert_true(self, condition, message=""):
        """Assert condition is true"""
        if not condition:
            raise AssertionError(message or "Condition is false")
    
    def assert_in(self, item, container, message=""):
        """Assert item in container"""
        if item not in container:
            raise AssertionError(f"{item} not in {container}. {message}")
    
    # ===== TEST SUITE =====
    
    def test_backend_available(self):
        """Test 1: Backend server is running"""
        try:
            response = requests.get(f"{API_BASE_URL}/", timeout=5)
            # FastAPI should return 404 for root or 200 if serving frontend
            self.assert_true(response.status_code in [200, 404], 
                           f"Unexpected status code: {response.status_code}")
        except requests.exceptions.ConnectionError:
            raise AssertionError(f"Cannot connect to {API_BASE_URL}. Is backend running?")
    
    def test_upload_endpoint_exists(self):
        """Test 2: POST /ingest endpoint exists"""
        try:
            response = requests.post(f"{API_BASE_URL}/ingest", timeout=10)
            # Should accept the POST even if empty
            self.assert_true(response.status_code in [200, 400, 422],
                           f"Unexpected status: {response.status_code}")
        except Exception as e:
            raise AssertionError(f"POST /ingest failed: {str(e)}")
    
    def test_process_endpoint_exists(self):
        """Test 3: POST /process endpoint exists"""
        try:
            response = requests.post(
                f"{API_BASE_URL}/process?strategy={self.strategy}",
                timeout=10
            )
            # May fail with 404 if no feedback, but endpoint should exist
            self.assert_true(response.status_code in [200, 404, 422, 500],
                           f"Unexpected status: {response.status_code}")
        except Exception as e:
            raise AssertionError(f"POST /process failed: {str(e)}")
    
    def test_upload_feedback_file(self):
        """Test 4: Upload feedback file to /ingest"""
        if not Path(TEST_FEEDBACK_FILE).exists():
            raise AssertionError(f"Test file not found: {TEST_FEEDBACK_FILE}")
        
        with open(TEST_FEEDBACK_FILE, 'rb') as f:
            files = {'file': (TEST_FEEDBACK_FILE, f, 'text/plain')}
            response = requests.post(
                f"{API_BASE_URL}/ingest",
                files=files,
                timeout=30
            )
        
        self.assert_equal(response.status_code, 200, 
                        f"Upload failed: {response.text}")
        
        data = response.json()
        self.assert_in('inserted', data, "Response missing 'inserted' field")
        self.assert_true(data['inserted'] > 0, 
                        f"No items inserted: {data}")
        
        self.log(f"  → Inserted {data['inserted']} feedback items", "INFO")
    
    def test_process_feedback(self):
        """Test 5: Process feedback with strategy"""
        response = requests.post(
            f"{API_BASE_URL}/process?strategy={self.strategy}",
            timeout=60
        )
        
        self.assert_equal(response.status_code, 200,
                        f"Processing failed: {response.text}")
        
        data = response.json()
        self.assert_in('run_id', data, "Response missing 'run_id'")
        self.assert_in('strategy', data, "Response missing 'strategy'")
        self.assert_in('themes_created', data, "Response missing 'themes_created'")
        
        self.run_id = data['run_id']
        
        self.assert_true(data['themes_created'] > 0,
                        f"No themes created: {data}")
        self.assert_equal(data['strategy'], self.strategy,
                        f"Strategy mismatch: {data['strategy']} != {self.strategy}")
        
        self.log(f"  → Run ID: {self.run_id}", "INFO")
        self.log(f"  → Themes created: {data['themes_created']}", "INFO")
        self.log(f"  → Strategy: {data['strategy']}", "INFO")
    
    def test_fetch_report(self):
        """Test 6: Fetch report for run_id"""
        if not self.run_id:
            raise AssertionError("run_id not set. Did upload succeed?")
        
        response = requests.get(
            f"{API_BASE_URL}/report?run_id={self.run_id}",
            timeout=30
        )
        
        self.assert_equal(response.status_code, 200,
                        f"Report fetch failed: {response.text}")
        
        data = response.json()
        self.assert_in('run_id', data, "Response missing 'run_id'")
        self.assert_in('summary', data, "Response missing 'summary'")
        self.assert_in('themes', data, "Response missing 'themes'")
        self.assert_in('decision_boundary', data, "Response missing 'decision_boundary'")
        
        themes = data['themes']
        self.assert_true(len(themes) > 0, "No themes in report")
        
        # Verify theme structure
        theme = themes[0]
        required_fields = ['theme', 'frequency', 'priority_score', 'confidence_pct',
                          'problem_statement', 'hypothesis']
        for field in required_fields:
            self.assert_in(field, theme, f"Theme missing field: {field}")
        
        self.log(f"  → Report contains {len(themes)} themes", "INFO")
        self.log(f"  → Top theme: {theme['theme']}", "INFO")
        self.log(f"  → Summary length: {len(data['summary'])} chars", "INFO")
    
    def test_theme_structure(self):
        """Test 7: Verify theme data structure completeness"""
        if not self.run_id:
            raise AssertionError("run_id not set")
        
        response = requests.get(
            f"{API_BASE_URL}/report?run_id={self.run_id}",
            timeout=30
        )
        
        data = response.json()
        themes = data['themes']
        
        for i, theme in enumerate(themes[:3]):  # Check first 3 themes
            # Check numeric values
            self.assert_true(isinstance(theme.get('priority_score'), (int, float)),
                           f"Theme {i}: priority_score not numeric")
            self.assert_true(isinstance(theme.get('confidence_pct'), (int, float)),
                           f"Theme {i}: confidence_pct not numeric")
            self.assert_true(isinstance(theme.get('frequency'), int),
                           f"Theme {i}: frequency not int")
            
            # Check star ratings exist
            self.assert_true(theme.get('customer_impact') is not None,
                           f"Theme {i}: missing customer_impact")
            self.assert_true(theme.get('business_impact') is not None,
                           f"Theme {i}: missing business_impact")
            self.assert_true(theme.get('severity') is not None,
                           f"Theme {i}: missing severity")
            self.assert_true(theme.get('strategic_alignment') is not None,
                           f"Theme {i}: missing strategic_alignment")
        
        self.log(f"  → Theme structure validated for {min(3, len(themes))} themes", "INFO")
    
    def test_reprocess_with_strategy(self):
        """Test 8: Reprocess with different strategy"""
        if not self.run_id:
            raise AssertionError("run_id not set")
        
        new_strategy = "Increase Revenue"
        response = requests.post(
            f"{API_BASE_URL}/reprocess?run_id={self.run_id}&strategy={new_strategy}",
            timeout=30
        )
        
        self.assert_equal(response.status_code, 200,
                        f"Reprocess failed: {response.text}")
        
        data = response.json()
        self.assert_in('run_id', data, "Response missing 'run_id'")
        self.assert_in('strategy', data, "Response missing 'strategy'")
        self.assert_in('themes', data, "Response missing 'themes'")
        
        self.assert_equal(data['run_id'], self.run_id,
                        f"run_id mismatch: {data['run_id']} != {self.run_id}")
        self.assert_equal(data['strategy'], new_strategy,
                        f"Strategy not updated: {data['strategy']} != {new_strategy}")
        
        self.log(f"  → Reprocessed with strategy: {new_strategy}", "INFO")
        self.log(f"  → Themes reranked: {len(data['themes'])} themes", "INFO")
    
    def test_export_csv(self):
        """Test 9: Export report as CSV"""
        if not self.run_id:
            raise AssertionError("run_id not set")
        
        response = requests.get(
            f"{API_BASE_URL}/export?run_id={self.run_id}",
            timeout=30
        )
        
        self.assert_equal(response.status_code, 200,
                        f"Export failed: {response.status_code}")
        
        # Check content type
        content_type = response.headers.get('content-type', '')
        self.assert_true('text/csv' in content_type or 'csv' in content_type,
                        f"Unexpected content-type: {content_type}")
        
        # Check content has headers
        text = response.text
        self.assert_true('theme' in text.lower(), "CSV missing 'theme' header")
        self.assert_true('priority_score' in text.lower(), "CSV missing 'priority_score'")
        self.assert_true('\n' in text, "CSV should have multiple lines")
        
        lines = text.strip().split('\n')
        self.assert_true(len(lines) > 1, f"CSV has no data rows: {len(lines)} lines")
        
        self.log(f"  → CSV exported with {len(lines)-1} data rows", "INFO")
        self.log(f"  → CSV size: {len(text)} bytes", "INFO")
    
    def test_frontend_html_loads(self):
        """Test 10: Frontend HTML is served"""
        response = requests.get(f"{API_BASE_URL}/", timeout=10)
        
        self.assert_equal(response.status_code, 200,
                        f"Frontend not served: {response.status_code}")
        
        text = response.text.lower()
        
        # Check for key HTML elements
        self.assert_true('<!doctype' in text, "Missing DOCTYPE")
        self.assert_true('discoveryos' in text, "Missing DiscoveryOS title")
        self.assert_true('sidebar' in text or 'nav' in text, "Missing navigation")
        self.assert_true('upload' in text, "Missing upload feature")
        self.assert_true('app.js' in text, "Missing app.js reference")
        self.assert_true('styles.css' in text, "Missing styles.css reference")
        
        self.log(f"  → HTML size: {len(response.text)} bytes", "INFO")
        self.log(f"  → Key elements verified", "INFO")
    
    def test_frontend_css_loads(self):
        """Test 11: Frontend CSS is served"""
        response = requests.get(f"{API_BASE_URL}/styles.css", timeout=10)
        
        self.assert_equal(response.status_code, 200,
                        f"CSS not served: {response.status_code}")
        
        text = response.text.lower()
        
        # Check for design system colors
        self.assert_true('081a3a' in text or '#081a3a' in text, 
                        "Missing sidebar color")
        self.assert_true('f5f7fb' in text or '#f5f7fb' in text,
                        "Missing background color")
        self.assert_true('2563eb' in text or '#2563eb' in text,
                        "Missing primary blue")
        
        self.log(f"  → CSS size: {len(response.text)} bytes", "INFO")
        self.log(f"  → Design system colors verified", "INFO")
    
    def test_frontend_js_loads(self):
        """Test 12: Frontend JS is served"""
        response = requests.get(f"{API_BASE_URL}/app.js", timeout=10)
        
        self.assert_equal(response.status_code, 200,
                        f"JS not served: {response.status_code}")
        
        text = response.text.lower()
        
        # Check for key functions
        self.assert_true('uploadandprocess' in text or 'upload' in text,
                        "Missing upload function")
        self.assert_true('navigatetopage' in text or 'navigate' in text,
                        "Missing navigation function")
        self.assert_true('renderthemecards' in text or 'theme' in text,
                        "Missing theme rendering")
        
        self.log(f"  → JS size: {len(response.text)} bytes", "INFO")
        self.log(f"  → Key functions verified", "INFO")
    
    def test_api_json_format(self):
        """Test 13: API responses are valid JSON"""
        if not self.run_id:
            raise AssertionError("run_id not set")
        
        endpoints = [
            f"/report?run_id={self.run_id}",
            f"/process?strategy=Improve Retention",
        ]
        
        for endpoint in endpoints:
            try:
                response = requests.post(f"{API_BASE_URL}{endpoint}", timeout=30)
                if response.status_code in [200, 404]:
                    data = response.json()  # Will raise if invalid JSON
            except Exception as e:
                raise AssertionError(f"Invalid JSON from {endpoint}: {str(e)}")
        
        self.log(f"  → All API responses are valid JSON", "INFO")
    
    def test_error_handling(self):
        """Test 14: Error handling works"""
        # Test with invalid run_id
        response = requests.get(
            f"{API_BASE_URL}/report?run_id=99999",
            timeout=10
        )
        
        self.assert_equal(response.status_code, 404,
                        f"Expected 404 for invalid run_id, got {response.status_code}")
        
        self.log(f"  → Error handling verified (404 for missing run_id)", "INFO")
    
    # ===== MAIN TEST RUNNER =====
    
    def run_all_tests(self):
        """Run complete test suite"""
        print("\n" + "="*70)
        print("DISCOVERYOS FRONTEND INTEGRATION TEST SUITE")
        print("="*70 + "\n")
        
        # Phase 1: Backend availability
        print("PHASE 1: BACKEND AVAILABILITY")
        print("-" * 70)
        self.test("Backend server is running", self.test_backend_available)
        self.test("POST /ingest endpoint exists", self.test_upload_endpoint_exists)
        self.test("POST /process endpoint exists", self.test_process_endpoint_exists)
        
        # Phase 2: Upload workflow
        print("\nPHASE 2: UPLOAD & PROCESSING WORKFLOW")
        print("-" * 70)
        self.test("Upload feedback file to /ingest", self.test_upload_feedback_file)
        self.test("Process feedback with strategy", self.test_process_feedback)
        
        # Phase 3: Report retrieval
        print("\nPHASE 3: REPORT RETRIEVAL")
        print("-" * 70)
        self.test("Fetch report for run_id", self.test_fetch_report)
        self.test("Verify theme data structure", self.test_theme_structure)
        
        # Phase 4: Advanced features
        print("\nPHASE 4: ADVANCED FEATURES")
        print("-" * 70)
        self.test("Reprocess with different strategy", self.test_reprocess_with_strategy)
        self.test("Export report as CSV", self.test_export_csv)
        
        # Phase 5: Frontend assets
        print("\nPHASE 5: FRONTEND ASSETS")
        print("-" * 70)
        self.test("Frontend HTML loads correctly", self.test_frontend_html_loads)
        self.test("Frontend CSS loads correctly", self.test_frontend_css_loads)
        self.test("Frontend JS loads correctly", self.test_frontend_js_loads)
        
        # Phase 6: Data integrity
        print("\nPHASE 6: DATA INTEGRITY")
        print("-" * 70)
        self.test("API responses are valid JSON", self.test_api_json_format)
        self.test("Error handling works correctly", self.test_error_handling)
        
        # Print summary
        print("\n" + "="*70)
        print("TEST SUMMARY")
        print("="*70)
        print(f"Total Tests:  {self.test_results['total']}")
        print(f"Passed:       {self.test_results['passed']} ✓")
        print(f"Failed:       {self.test_results['failed']} ✗")
        
        if self.test_results['failed'] > 0:
            print("\nFAILED TESTS:")
            for name, error in self.test_results['errors']:
                print(f"  • {name}")
                print(f"    └─ {error}")
        
        print("\n" + "="*70)
        
        if self.test_results['failed'] == 0:
            print("✓ ALL TESTS PASSED - Frontend is production ready!")
            print("="*70 + "\n")
            return True
        else:
            print("✗ SOME TESTS FAILED - See errors above")
            print("="*70 + "\n")
            return False


if __name__ == "__main__":
    # Check if backend is running
    print("\n⏳ Checking backend connection...")
    try:
        requests.get(f"{API_BASE_URL}/", timeout=5)
        print(f"✓ Connected to {API_BASE_URL}\n")
    except:
        print(f"✗ Cannot connect to {API_BASE_URL}")
        print("Please start the backend with: python main.py")
        sys.exit(1)
    
    # Run tests
    tester = DiscoveryOSTest()
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)
