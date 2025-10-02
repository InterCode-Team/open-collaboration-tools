import * as vscode from 'vscode';
import * as http from 'http';
import { injectable, inject, postConstruct } from 'inversify';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { ExtensionContext } from './inversify.js';
import { Settings } from './utils/settings.js';

export interface AutomationRequest {
    action: 'create' | 'join';
    roomId?: string; // Required for 'join' action
    serverUrl?: string; // Optional server URL override
}

export interface AutomationResponse {
    success: boolean;
    roomId?: string;
    serverUrl?: string;
    error?: string;
}

@injectable()
export class AutomationService implements vscode.Disposable {

    @inject(CollaborationRoomService)
    private roomService: CollaborationRoomService;

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    private server?: http.Server;
    private port: number = 8443; // Default port

    @postConstruct()
    protected init(): void {
        // Read configuration
        this.port = this.getConfig('port', 8443);

        // Always start the server
        this.startServer();

        // Watch for configuration changes
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('oct.automation')) {
                    this.handleConfigChange();
                }
            })
        );
    }

    private getConfig<T>(key: string, defaultValue: T): T {
        const config = vscode.workspace.getConfiguration('oct.automation');
        return config.get(key, defaultValue);
    }

    private handleConfigChange(): void {
        const newPort = this.getConfig('port', 8443);

        if (newPort !== this.port) {
            this.port = newPort;

            if (this.server) {
                this.stopServer();
            }

            this.startServer();
        }
    }

    private startServer(): void {
        this.server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        });

        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`OCT Automation Service listening on port ${this.port}`);
            vscode.window.showInformationMessage(
                `Open Collaboration Tools automation service started on port ${this.port}`
            );
        });

        this.server.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'EADDRINUSE') {
                vscode.window.showErrorMessage(
                    `Port ${this.port} is already in use. OCT automation service could not start.`
                );
            } else {
                vscode.window.showErrorMessage(
                    `OCT automation service error: ${error.message}`
                );
            }
        });
    }

    private stopServer(): void {
        if (this.server) {
            this.server.close(() => {
                console.log('OCT Automation Service stopped');
            });
            this.server = undefined;
        }
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // Set CORS headers for cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Handle OPTIONS for CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Only accept POST requests
        if (req.method !== 'POST') {
            this.sendResponse(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
            return;
        }

        // Parse request body
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                const request: AutomationRequest = JSON.parse(body);
                const response = await this.processRequest(request);
                this.sendResponse(res, response.success ? 200 : 400, response);
            } catch (error) {
                this.sendResponse(res, 400, {
                    success: false,
                    error: `Invalid request: ${error instanceof Error ? error.message : String(error)}`
                });
            }
        });
    }

    private async processRequest(request: AutomationRequest): Promise<AutomationResponse> {
        try {
            switch (request.action) {
                case 'create':
                    return await this.handleCreateRoom(request.serverUrl);
                case 'join':
                    if (!request.roomId) {
                        return { success: false, error: 'roomId is required for join action' };
                    }
                    return await this.handleJoinRoom(request.roomId, request.serverUrl);
                default:
                    return { success: false, error: `Unknown action: ${request.action}` };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async handleCreateRoom(serverUrl?: string): Promise<AutomationResponse> {
        // Temporarily override server URL if provided
        const originalUrl = serverUrl ? Settings.getServerUrl() : undefined;
        if (serverUrl) {
            await Settings.setServerUrl(serverUrl);
        }

        return new Promise((resolve) => {
            // Listen for room creation
            const disposable = this.roomService.onDidJoinRoom(async instance => {
                disposable.dispose();
                
                // Restore original URL if it was overridden
                if (serverUrl && originalUrl) {
                    await Settings.setServerUrl(originalUrl);
                }

                resolve({
                    success: true,
                    roomId: instance.roomId,
                    serverUrl: instance.serverUrl
                });
            });

            // Trigger room creation
            this.roomService.createRoom().catch(async error => {
                disposable.dispose();
                
                // Restore original URL on error
                if (serverUrl && originalUrl) {
                    await Settings.setServerUrl(originalUrl);
                }

                resolve({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        });
    }

    private async handleJoinRoom(roomId: string, serverUrl?: string): Promise<AutomationResponse> {
        // Temporarily override server URL if provided
        const originalUrl = serverUrl ? Settings.getServerUrl() : undefined;
        if (serverUrl) {
            await Settings.setServerUrl(serverUrl);
        }

        return new Promise((resolve) => {
            // Listen for room join
            const disposable = this.roomService.onDidJoinRoom(async instance => {
                disposable.dispose();
                
                // Restore original URL if it was overridden
                if (serverUrl && originalUrl) {
                    await Settings.setServerUrl(originalUrl);
                }

                resolve({
                    success: true,
                    roomId: instance.roomId,
                    serverUrl: instance.serverUrl
                });
            });

            // Trigger room join
            this.roomService.joinRoom(roomId).catch(async error => {
                disposable.dispose();
                
                // Restore original URL on error
                if (serverUrl && originalUrl) {
                    await Settings.setServerUrl(originalUrl);
                }

                resolve({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        });
    }

    private sendResponse(res: http.ServerResponse, statusCode: number, data: AutomationResponse): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }

    dispose(): void {
        this.stopServer();
    }
}

