#!/usr/bin/env node

/**
 * Test script for Open Collaboration Tools Automation API
 * Usage: node test-automation.js [create|join|both]
 */

const http = require('http');

const PORT = 8443;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// ANSI color codes
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m'
};

// Helper function to make HTTP requests
function makeRequest(data) {
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: '127.0.0.1',
            port: PORT,
            path: '/',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let responseData = '';

            res.on('data', (chunk) => {
                responseData += chunk;
            });

            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    resolve({ statusCode: res.statusCode, data: result });
                } catch (e) {
                    resolve({ statusCode: res.statusCode, data: responseData });
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        req.write(postData);
        req.end();
    });
}

// Test: Create session
async function testCreate() {
    console.log(`${colors.blue}[TEST 1]${colors.reset} Creating new session...`);
    
    try {
        const result = await makeRequest({ action: 'create' });
        
        console.log(`HTTP Status: ${result.statusCode}`);
        console.log(`Response: ${JSON.stringify(result.data, null, 2)}`);
        
        if (result.statusCode === 200 && result.data.success) {
            console.log(`${colors.green}✓ SUCCESS${colors.reset} - Session created!`);
            console.log(`Room ID: ${colors.green}${result.data.roomId}${colors.reset}`);
            console.log('');
            return result.data.roomId;
        } else {
            console.log(`${colors.red}✗ FAILED${colors.reset} - Could not create session`);
            console.log('');
            return null;
        }
    } catch (error) {
        console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`);
        console.log('');
        return null;
    }
}

// Test: Join session
async function testJoin(roomId) {
    if (!roomId) {
        console.log(`${colors.red}Error: No room ID provided${colors.reset}`);
        return;
    }
    
    console.log(`${colors.blue}[TEST 2]${colors.reset} Joining session: ${roomId}`);
    
    try {
        const result = await makeRequest({ 
            action: 'join', 
            roomId: roomId 
        });
        
        console.log(`HTTP Status: ${result.statusCode}`);
        console.log(`Response: ${JSON.stringify(result.data, null, 2)}`);
        
        if (result.statusCode === 200 && result.data.success) {
            console.log(`${colors.green}✓ SUCCESS${colors.reset} - Joined session!`);
            console.log('');
        } else {
            console.log(`${colors.red}✗ FAILED${colors.reset} - Could not join session`);
            console.log('');
        }
    } catch (error) {
        console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`);
        console.log('');
    }
}

// Test: Invalid request
async function testInvalid() {
    console.log(`${colors.blue}[TEST 3]${colors.reset} Testing invalid request (should fail)...`);
    
    try {
        const result = await makeRequest({ action: 'invalid' });
        
        console.log(`HTTP Status: ${result.statusCode}`);
        console.log(`Response: ${JSON.stringify(result.data, null, 2)}`);
        
        if (result.statusCode === 400) {
            console.log(`${colors.green}✓ SUCCESS${colors.reset} - Error handling works correctly`);
            console.log('');
        } else {
            console.log(`${colors.red}✗ UNEXPECTED${colors.reset} - Expected 400 status code`);
            console.log('');
        }
    } catch (error) {
        console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`);
        console.log('');
    }
}

// Test: Missing roomId for join
async function testMissingRoomId() {
    console.log(`${colors.blue}[TEST 4]${colors.reset} Testing join without roomId (should fail)...`);
    
    try {
        const result = await makeRequest({ action: 'join' });
        
        console.log(`HTTP Status: ${result.statusCode}`);
        console.log(`Response: ${JSON.stringify(result.data, null, 2)}`);
        
        if (result.statusCode === 400 && result.data.error) {
            console.log(`${colors.green}✓ SUCCESS${colors.reset} - Validation works correctly`);
            console.log('');
        } else {
            console.log(`${colors.red}✗ UNEXPECTED${colors.reset} - Expected 400 with error`);
            console.log('');
        }
    } catch (error) {
        console.log(`${colors.red}✗ ERROR${colors.reset} - ${error.message}`);
        console.log('');
    }
}

// Check if service is running
async function checkService() {
    console.log('Checking if automation service is running...');
    
    try {
        const result = await makeRequest({ action: 'create' });
        console.log(`${colors.green}✓ Service is running on port ${PORT}${colors.reset}`);
        console.log('');
        return true;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            console.log(`${colors.red}✗ Service is NOT running on port ${PORT}${colors.reset}`);
            console.log('');
            console.log('Please ensure:');
            console.log('1. VSCode is running');
            console.log('2. Open Collaboration Tools extension is installed');
            console.log('3. Extension is activated');
            console.log('');
            return false;
        }
        throw error;
    }
}

// Main function
async function main() {
    console.log('================================================');
    console.log('  OCT Automation API Test Script');
    console.log('================================================');
    console.log('');
    
    const serviceRunning = await checkService();
    if (!serviceRunning) {
        process.exit(1);
    }
    
    const command = process.argv[2] || 'both';
    const roomIdArg = process.argv[3];
    
    switch (command) {
        case 'create':
            await testCreate();
            break;
            
        case 'join':
            if (!roomIdArg) {
                console.log(`${colors.red}Error: Room ID required${colors.reset}`);
                console.log('Usage: node test-automation.js join <room-id>');
                process.exit(1);
            }
            await testJoin(roomIdArg);
            break;
            
        case 'invalid':
            await testInvalid();
            break;
            
        case 'validation':
            await testMissingRoomId();
            break;
            
        case 'both':
            const roomId = await testCreate();
            if (roomId) {
                console.log('Waiting 2 seconds before join test...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await testJoin(roomId);
            }
            await testInvalid();
            await testMissingRoomId();
            break;
            
        case 'all':
            const rid = await testCreate();
            if (rid) {
                console.log('Waiting 2 seconds before join test...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await testJoin(rid);
            }
            await testInvalid();
            await testMissingRoomId();
            break;
            
        default:
            console.log('Usage: node test-automation.js [create|join <room-id>|both|all|invalid|validation]');
            console.log('');
            console.log('Examples:');
            console.log('  node test-automation.js create              # Test create session');
            console.log('  node test-automation.js join abc123         # Test join session');
            console.log('  node test-automation.js both                # Test create and join');
            console.log('  node test-automation.js all                 # Run all tests');
            console.log('  node test-automation.js invalid             # Test error handling');
            console.log('  node test-automation.js validation          # Test validation');
            process.exit(1);
    }
    
    console.log('================================================');
    console.log('  Test Complete');
    console.log('================================================');
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error(`${colors.red}Fatal error:${colors.reset}`, error);
        process.exit(1);
    });
}

module.exports = { makeRequest, testCreate, testJoin };



