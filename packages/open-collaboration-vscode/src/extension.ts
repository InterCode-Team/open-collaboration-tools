// ******************************************************************************
// Copyright 2024 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import 'reflect-metadata';
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { initializeProtocol } from 'open-collaboration-protocol';
import { CollaborationInstance } from './collaboration-instance.js';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { closeSharedEditors, removeWorkspaceFolders } from './utils/workspace.js';
import { createContainer } from './inversify.js';
import { Commands } from './commands.js';
import { Fetch } from './collaboration-connection-provider.js';
import { AutomationService } from './automation-service.js';
import fetch from 'node-fetch';

initializeProtocol({
    cryptoModule: crypto.webcrypto
});

/**
 * Notify backend about OCT session with retry logic and exponential backoff.
 * This runs asynchronously in the background and doesn't block extension activation.
 * 
 * @param instanceId - The Cloud IDE instance ID
 * @param roomId - The OCT room ID that was created
 * @param serverUrl - The OCT server URL
 */
async function notifyBackendWithRetry(instanceId: string, roomId: string, serverUrl: string): Promise<void> {
    const maxRetries = 20;
    const initialDelay = 1000; // 1 second
    const maxDelay = 30000; // 30 seconds
    const requestTimeout = 10000; // 10 second timeout per request
    const backendUrl = `http://backend:9000/api/cloud-ide/${instanceId}/oct-session`;

    console.log(`[OCT-Debug] Starting backend notification with retry logic (max ${maxRetries} attempts)`);
    console.log(`[OCT-Debug] Backend URL: ${backendUrl}`);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`[OCT-Debug] Backend notification attempt ${attempt}/${maxRetries}`);

            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), requestTimeout);

            const response = await fetch(backendUrl, {
                method: 'POST',
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roomId,
                    serverUrl
                })
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                console.log(`[OCT-Success] Backend notified successfully on attempt ${attempt}`);
                console.log(`[OCT-Success] Session ${roomId} registered in database`);
                return; // Success - exit retry loop
            } else {
                const errorText = await response.text().catch(() => 'Unable to read error');
                console.warn(`[OCT-Warning] Backend notification failed (attempt ${attempt}/${maxRetries}): HTTP ${response.status} ${response.statusText}`);
                console.warn(`[OCT-Warning] Error details: ${errorText.substring(0, 200)}`);
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                console.warn(`[OCT-Warning] Backend notification timeout on attempt ${attempt}/${maxRetries} (${requestTimeout}ms)`);
            } else {
                console.warn(`[OCT-Warning] Backend notification error on attempt ${attempt}/${maxRetries}: ${error.message}`);
            }
        }

        // Calculate delay with exponential backoff
        if (attempt < maxRetries) {
            const delay = Math.min(initialDelay * Math.pow(2, attempt - 1), maxDelay);
            console.log(`[OCT-Debug] Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // All retries exhausted
    console.error(`[OCT-Error] Failed to notify backend after ${maxRetries} attempts`);
    console.error(`[OCT-Error] Room ${roomId} was created but backend may not be aware`);
    console.error(`[OCT-Error] Teacher may not be able to join this session until backend is manually updated`);
}

export async function activate(context: vscode.ExtensionContext) {
    const container = createContainer(context);
    container.bind(Fetch).toConstantValue(fetch);
    const commands = container.get(Commands);
    commands.initialize();
    const roomService = container.get(CollaborationRoomService);

    // Initialize automation service for 3rd party integration
    const automationService = container.get(AutomationService);
    context.subscriptions.push(automationService);

    const connection = await roomService.tryConnect();
    if (connection) {
        // Wait for the connection to be ready before returning.
        // This allows other extensions that need some workspace information to wait for the data.
        await connection.ready;
    } else {
        await closeSharedEditors();
        removeWorkspaceFolders();

        // Check for auto-join (teacher joining student session)
        const autoJoinRoomId = process.env.OCT_AUTO_JOIN_ROOM;
        const instanceId = process.env.INSTANCE_ID;
        const username = process.env.USERNAME;

        console.log(`[OCT-Debug] Extension activated. INSTANCE_ID=${instanceId}, USERNAME=${username}, AUTO_JOIN_ROOM=${autoJoinRoomId}`);

        if (autoJoinRoomId && autoJoinRoomId.trim() !== '') {
            // Teacher instance - auto-join the student's room
            console.log(`[OCT-Debug] Teacher mode: Auto-joining room ${autoJoinRoomId} in 5 seconds`);

            // Give the IDE a moment to fully initialize
            setTimeout(async () => {
                try {
                    console.log(`[OCT-Debug] Starting auto-join to room ${autoJoinRoomId}...`);

                    // Join the student's room silently (no UI prompts)
                    const success = await roomService.joinRoomSilent(autoJoinRoomId);

                    if (success) {
                        console.log(`[OCT-Success] Successfully auto-joined room ${autoJoinRoomId}`);
                        vscode.window.showInformationMessage(`Successfully joined student collaboration session!`);
                    } else {
                        console.error(`[OCT-Error] Failed to auto-join room ${autoJoinRoomId}`);
                        vscode.window.showErrorMessage(`Failed to join student session automatically. Please try again manually.`);
                    }
                } catch (error) {
                    console.error(`[OCT-Error] Exception during auto-join to room ${autoJoinRoomId}:`, error);
                    vscode.window.showErrorMessage(`Failed to join student session automatically. Please try again manually.`);
                }
            }, 5000); // Wait 5 seconds for IDE to fully initialize
        } else if (instanceId && username) {
            // Student instance - auto-create room
            console.log(`[OCT-Debug] Student mode: Auto-start conditions met, scheduling room creation in 3 seconds`);

            // Give the IDE a moment to fully initialize
            setTimeout(async () => {
                try {
                    console.log(`[OCT-Debug] Starting silent room creation...`);
                    const roomInfo = await roomService.createRoomSilent();

                    if (roomInfo) {
                        console.log(`[OCT-Success] Auto-created room ${roomInfo.roomId}, notifying backend`);

                        // Notify backend about the OCT session with retry logic
                        notifyBackendWithRetry(instanceId, roomInfo.roomId, roomInfo.serverUrl);
                    } else {
                        console.error('[OCT-Error] createRoomSilent returned undefined');
                    }
                } catch (error) {
                    console.error('[OCT-Error] Error in auto-create flow:', error);
                }
            }, 3000); // Wait 3 seconds for IDE to fully initialize
        } else {
            console.log(`[OCT-Debug] Auto-start skipped - no auto-join or auto-create conditions met`);
        }
    }
}

export async function deactivate(): Promise<void> {
    await CollaborationInstance.Current?.leave();
    CollaborationInstance.Current?.dispose();
    await closeSharedEditors();
    removeWorkspaceFolders();
}
