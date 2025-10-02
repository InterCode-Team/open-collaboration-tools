#!/usr/bin/env python3

"""
Test script for Open Collaboration Tools Automation API
Usage: python test-automation.py [create|join|both]
"""

import sys
import json
import time
import requests
from typing import Optional, Dict, Any

# Configuration
PORT = 8443
BASE_URL = f"http://127.0.0.1:{PORT}"

# ANSI color codes
class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    BLUE = '\033[94m'
    YELLOW = '\033[93m'
    RESET = '\033[0m'

def make_request(data: Dict[str, Any]) -> tuple[int, Dict[str, Any]]:
    """Make HTTP POST request to automation API"""
    try:
        response = requests.post(
            BASE_URL,
            json=data,
            headers={'Content-Type': 'application/json'}
        )
        return response.status_code, response.json()
    except requests.exceptions.ConnectionError:
        print(f"{Colors.RED}✗ Cannot connect to service{Colors.RESET}")
        print(f"\nPlease ensure:")
        print("1. VSCode is running")
        print("2. Open Collaboration Tools extension is installed")
        print("3. Extension is activated")
        sys.exit(1)
    except Exception as e:
        print(f"{Colors.RED}✗ Error: {str(e)}{Colors.RESET}")
        sys.exit(1)

def test_create() -> Optional[str]:
    """Test create session"""
    print(f"{Colors.BLUE}[TEST 1]{Colors.RESET} Creating new session...")
    
    status_code, data = make_request({'action': 'create'})
    
    print(f"HTTP Status: {status_code}")
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if status_code == 200 and data.get('success'):
        room_id = data.get('roomId')
        print(f"{Colors.GREEN}✓ SUCCESS{Colors.RESET} - Session created!")
        print(f"Room ID: {Colors.GREEN}{room_id}{Colors.RESET}")
        print()
        return room_id
    else:
        print(f"{Colors.RED}✗ FAILED{Colors.RESET} - Could not create session")
        print()
        return None

def test_join(room_id: str) -> bool:
    """Test join session"""
    if not room_id:
        print(f"{Colors.RED}Error: No room ID provided{Colors.RESET}")
        return False
    
    print(f"{Colors.BLUE}[TEST 2]{Colors.RESET} Joining session: {room_id}")
    
    status_code, data = make_request({
        'action': 'join',
        'roomId': room_id
    })
    
    print(f"HTTP Status: {status_code}")
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if status_code == 200 and data.get('success'):
        print(f"{Colors.GREEN}✓ SUCCESS{Colors.RESET} - Joined session!")
        print()
        return True
    else:
        print(f"{Colors.RED}✗ FAILED{Colors.RESET} - Could not join session")
        print()
        return False

def test_invalid():
    """Test invalid request"""
    print(f"{Colors.BLUE}[TEST 3]{Colors.RESET} Testing invalid request (should fail)...")
    
    status_code, data = make_request({'action': 'invalid'})
    
    print(f"HTTP Status: {status_code}")
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if status_code == 400:
        print(f"{Colors.GREEN}✓ SUCCESS{Colors.RESET} - Error handling works correctly")
        print()
    else:
        print(f"{Colors.RED}✗ UNEXPECTED{Colors.RESET} - Expected 400 status code")
        print()

def test_missing_room_id():
    """Test join without roomId"""
    print(f"{Colors.BLUE}[TEST 4]{Colors.RESET} Testing join without roomId (should fail)...")
    
    status_code, data = make_request({'action': 'join'})
    
    print(f"HTTP Status: {status_code}")
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if status_code == 400 and 'error' in data:
        print(f"{Colors.GREEN}✓ SUCCESS{Colors.RESET} - Validation works correctly")
        print()
    else:
        print(f"{Colors.RED}✗ UNEXPECTED{Colors.RESET} - Expected 400 with error")
        print()

def test_custom_server():
    """Test with custom server URL"""
    print(f"{Colors.BLUE}[TEST 5]{Colors.RESET} Testing with custom server URL...")
    
    status_code, data = make_request({
        'action': 'create',
        'serverUrl': 'https://api.open-collab.tools/'
    })
    
    print(f"HTTP Status: {status_code}")
    print(f"Response: {json.dumps(data, indent=2)}")
    
    if status_code == 200 and data.get('success'):
        print(f"{Colors.GREEN}✓ SUCCESS{Colors.RESET} - Custom server URL works!")
        print()
    else:
        print(f"{Colors.RED}✗ FAILED{Colors.RESET} - Custom server URL failed")
        print()

def check_service():
    """Check if service is running"""
    print("Checking if automation service is running...")
    try:
        response = requests.post(
            BASE_URL,
            json={'action': 'create'},
            timeout=2
        )
        print(f"{Colors.GREEN}✓ Service is running on port {PORT}{Colors.RESET}")
        print()
        return True
    except requests.exceptions.ConnectionError:
        print(f"{Colors.RED}✗ Service is NOT running on port {PORT}{Colors.RESET}")
        print()
        return False
    except Exception as e:
        print(f"{Colors.RED}✗ Error: {str(e)}{Colors.RESET}")
        print()
        return False

def main():
    """Main function"""
    print("=" * 50)
    print("  OCT Automation API Test Script (Python)")
    print("=" * 50)
    print()
    
    if not check_service():
        print("\nPlease ensure:")
        print("1. VSCode is running")
        print("2. Open Collaboration Tools extension is installed")
        print("3. Extension is activated")
        sys.exit(1)
    
    command = sys.argv[1] if len(sys.argv) > 1 else 'both'
    room_id_arg = sys.argv[2] if len(sys.argv) > 2 else None
    
    if command == 'create':
        test_create()
    
    elif command == 'join':
        if not room_id_arg:
            print(f"{Colors.RED}Error: Room ID required{Colors.RESET}")
            print("Usage: python test-automation.py join <room-id>")
            sys.exit(1)
        test_join(room_id_arg)
    
    elif command == 'invalid':
        test_invalid()
    
    elif command == 'validation':
        test_missing_room_id()
    
    elif command == 'server':
        test_custom_server()
    
    elif command == 'both':
        room_id = test_create()
        if room_id:
            print("Waiting 2 seconds before join test...")
            time.sleep(2)
            test_join(room_id)
        test_invalid()
        test_missing_room_id()
    
    elif command == 'all':
        room_id = test_create()
        if room_id:
            print("Waiting 2 seconds before join test...")
            time.sleep(2)
            test_join(room_id)
        test_invalid()
        test_missing_room_id()
        test_custom_server()
    
    else:
        print("Usage: python test-automation.py [create|join <room-id>|both|all|invalid|validation|server]")
        print()
        print("Examples:")
        print("  python test-automation.py create              # Test create session")
        print("  python test-automation.py join abc123         # Test join session")
        print("  python test-automation.py both                # Test create and join")
        print("  python test-automation.py all                 # Run all tests")
        print("  python test-automation.py invalid             # Test error handling")
        print("  python test-automation.py validation          # Test validation")
        print("  python test-automation.py server              # Test custom server")
        sys.exit(1)
    
    print("=" * 50)
    print("  Test Complete")
    print("=" * 50)

if __name__ == '__main__':
    main()



