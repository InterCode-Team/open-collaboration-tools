#!/bin/bash

# Test script for Open Collaboration Tools Automation API
# Usage: ./test-automation.sh [create|join|both]

PORT=9555
BASE_URL="http://127.0.0.1:${PORT}"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "================================================"
echo "  OCT Automation API Test Script"
echo "================================================"
echo ""

# Function to test create session
test_create() {
    echo -e "${BLUE}[TEST 1]${NC} Creating new session..."
    echo "Using default credentials: username=Test1, email=Test1@gmail.com"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}" \
        -H "Content-Type: application/json" \
        -d '{"action": "create", "username": "Test1", "email": "Test1@gmail.com"}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        ROOM_ID=$(echo "$BODY" | grep -o '"roomId":"[^"]*"' | cut -d'"' -f4)
        echo -e "${GREEN}✓ SUCCESS${NC} - Session created!"
        echo -e "Room ID: ${GREEN}${ROOM_ID}${NC}"
        echo ""
        
        # Save room ID for join test
        echo "$ROOM_ID" > /tmp/oct_room_id.txt
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} - Could not create session"
        echo ""
        return 1
    fi
}

# Function to test join session
test_join() {
    local ROOM_ID=$1
    
    if [ -z "$ROOM_ID" ]; then
        # Try to get room ID from temp file
        if [ -f /tmp/oct_room_id.txt ]; then
            ROOM_ID=$(cat /tmp/oct_room_id.txt)
        else
            echo -e "${RED}Error: No room ID provided${NC}"
            echo "Usage: $0 join <room-id>"
            return 1
        fi
    fi
    
    echo -e "${BLUE}[TEST 2]${NC} Joining session: $ROOM_ID"
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}" \
        -H "Content-Type: application/json" \
        -d "{\"action\": \"join\", \"roomId\": \"${ROOM_ID}\"}")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"
    
    if [ "$HTTP_CODE" -eq 200 ]; then
        echo -e "${GREEN}✓ SUCCESS${NC} - Joined session!"
        echo ""
        return 0
    else
        echo -e "${RED}✗ FAILED${NC} - Could not join session"
        echo ""
        return 1
    fi
}

# Function to test invalid request
test_invalid() {
    echo -e "${BLUE}[TEST 3]${NC} Testing invalid request (should fail)..."
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}" \
        -H "Content-Type: application/json" \
        -d '{"action": "invalid"}')
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    echo "HTTP Status: $HTTP_CODE"
    echo "Response: $BODY"
    
    if [ "$HTTP_CODE" -eq 400 ]; then
        echo -e "${GREEN}✓ SUCCESS${NC} - Error handling works correctly"
        echo ""
    else
        echo -e "${RED}✗ UNEXPECTED${NC} - Expected 400 status code"
        echo ""
    fi
}

# Function to check if service is running
check_service() {
    echo "Checking if automation service is running..."
    
    if curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}" | grep -q "405\|200\|400"; then
        echo -e "${GREEN}✓ Service is running on port ${PORT}${NC}"
        echo ""
        return 0
    else
        echo -e "${RED}✗ Service is NOT running on port ${PORT}${NC}"
        echo ""
        echo "Please ensure:"
        echo "1. VSCode is running"
        echo "2. Open Collaboration Tools extension is installed"
        echo "3. Extension is activated"
        echo ""
        exit 1
    fi
}

# Main script logic
check_service

case "${1:-both}" in
    create)
        test_create
        ;;
    join)
        test_join "$2"
        ;;
    invalid)
        test_invalid
        ;;
    both)
        test_create
        if [ $? -eq 0 ]; then
            echo "Waiting 2 seconds before join test..."
            sleep 2
            test_join
        fi
        test_invalid
        ;;
    *)
        echo "Usage: $0 [create|join <room-id>|both|invalid]"
        echo ""
        echo "Examples:"
        echo "  $0 create           # Test create session"
        echo "  $0 join abc123      # Test join session with room ID"
        echo "  $0 both             # Test both create and join"
        echo "  $0 invalid          # Test error handling"
        exit 1
        ;;
esac

echo "================================================"
echo "  Test Complete"
echo "================================================"

