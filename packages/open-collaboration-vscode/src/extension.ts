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
                    
                    // Join the student's room
                    await roomService.joinRoom(autoJoinRoomId);
                    
                    console.log(`[OCT-Success] Successfully auto-joined room ${autoJoinRoomId}`);
                } catch (error) {
                    console.error(`[OCT-Error] Failed to auto-join room ${autoJoinRoomId}:`, error);
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
                        
                        // Notify backend about the OCT session
                        const backendUrl = `http://backend:8000/api/cloud-ide/${instanceId}/oct-session`;
                        console.log(`[OCT-Debug] Notifying backend at ${backendUrl}`);
                        
                        const response = await fetch(backendUrl, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                instanceId,
                                roomId: roomInfo.roomId,
                                serverUrl: roomInfo.serverUrl
                            })
                        });
                        
                        if (response.ok) {
                            console.log(`[OCT-Success] Backend notified about session ${roomInfo.roomId}`);
                        } else {
                            const errorText = await response.text().catch(() => 'Unable to read error');
                            console.error(`[OCT-Error] Failed to notify backend: ${response.status} ${response.statusText} - ${errorText}`);
                        }
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
