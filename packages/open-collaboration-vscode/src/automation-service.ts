import * as vscode from 'vscode';
import * as http from 'http';
import { injectable, inject, postConstruct } from 'inversify';
import { CollaborationRoomService } from './collaboration-room-service.js';
import { ExtensionContext } from './inversify.js';
// import { CollaborationInstance } from './collaboration-instance.js';
import { CollaborationUri } from './utils/uri.js';

export interface AutomationRequest {
    action: 'create' | 'join' | 'getHostContext';
    roomId?: string; // Required for 'join' action
    serverUrl?: string; // Optional server URL override
    username?: string; // Username for authentication (default: "Test1")
    email?: string; // Email for authentication (default: "Test1@gmail.com")
}

export interface AutomationResponse {
    success: boolean;
    roomId?: string;
    serverUrl?: string;
    error?: string;
}

export interface HostContextResponse {
    success: boolean;
    context?: {
        filePath: string;
        cursorLine: number;
        cursorCharacter: number;
        linesContext: string; // Lines from cursorLine-5 to cursorLine+5
        startLine: number; // Actual start line (may be less than cursorLine-5 at file start)
        endLine: number; // Actual end line (may be less than cursorLine+5 at file end)
        totalLines: number;
    };
    error?: string;
}

@injectable()
export class AutomationService implements vscode.Disposable {

    @inject(CollaborationRoomService)
    private roomService: CollaborationRoomService;

    @inject(ExtensionContext)
    private context: vscode.ExtensionContext;

    private server?: http.Server;
    private port: number = 9555; // Default port

    @postConstruct()
    protected init(): void {
        // Read configuration
        this.port = this.getConfig('port', 9555);

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
        const newPort = this.getConfig('port', 9555);

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

        this.server.listen(this.port, '0.0.0.0', () => {
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        // Debug logging
        console.log(`[Automation Service] ${req.method} ${req.url}`);

        // Handle OPTIONS for CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // Handle GET request for host context (flexible URL matching)
        if (req.method === 'GET' && req.url?.startsWith('/host-context')) {
            const contextResponse = await this.handleGetHostContext();
            this.sendContextResponse(res, 200, contextResponse);
            return;
        }

        // Only accept POST requests for other actions
        if (req.method !== 'POST') {
            this.sendResponse(res, 405, { success: false, error: 'Method not allowed. Use POST for actions or GET for /host-context.' });
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
                    return await this.handleCreateRoom(request.serverUrl, request.username, request.email);
                case 'join':
                    if (!request.roomId) {
                        return { success: false, error: 'roomId is required for join action' };
                    }
                    return await this.handleJoinRoom(request.roomId, request.serverUrl, request.username, request.email);
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

    private async handleCreateRoom(serverUrl?: string, username?: string, email?: string): Promise<AutomationResponse> {
        // Use the silent room creation for automation API
        try {
            const roomInfo = await this.roomService.createRoomSilent();
            
            if (roomInfo) {
                return {
                    success: true,
                    roomId: roomInfo.roomId,
                    serverUrl: roomInfo.serverUrl
                };
            } else {
                return {
                    success: false,
                    error: 'Failed to create room'
                };
            }
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async handleJoinRoom(roomId: string, serverUrl?: string, username?: string, email?: string): Promise<AutomationResponse> {
        // For join room, still use the regular method as it requires user interaction anyway
        return new Promise((resolve) => {
            const disposable = this.roomService.onDidJoinRoom(async instance => {
                disposable.dispose();

                resolve({
                    success: true,
                    roomId: instance.roomId,
                    serverUrl: instance.serverUrl
                });
            });

            this.roomService.joinRoom(roomId).catch(async error => {
                disposable.dispose();

                resolve({
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                });
            });
        });
    }

    private async handleGetHostContext(): Promise<HostContextResponse> {
        try {
            // Get the active text editor (no longer requires collaboration session)
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return {
                    success: false,
                    error: 'No active editor'
                };
            }

            // Get the file path - try collaboration path first, then fallback to regular path
            const uri = editor.document.uri;
            let path = CollaborationUri.getProtocolPath(uri);
            
            if (!path) {
                // Fallback to regular file path if not in collaboration workspace
                if (uri.scheme === 'file') {
                    // Use workspace-relative path if possible
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
                    if (workspaceFolder) {
                        path = vscode.workspace.asRelativePath(uri, false);
                    } else {
                        path = uri.fsPath;
                    }
                } else {
                    path = uri.path;
                }
            }

            // Get cursor position (use the primary selection)
            const selection = editor.selection;
            const cursorPosition = selection.active;
            const cursorLine = cursorPosition.line;
            const cursorCharacter = cursorPosition.character;

            // Get document
            const document = editor.document;
            const totalLines = document.lineCount;

            // Calculate line range (±5 lines, but don't go out of bounds)
            const contextRange = 5;
            const startLine = Math.max(0, cursorLine - contextRange);
            const endLine = Math.min(totalLines - 1, cursorLine + contextRange);

            // Extract lines
            const lines: string[] = [];
            for (let i = startLine; i <= endLine; i++) {
                lines.push(document.lineAt(i).text);
            }

            const linesContext = lines.join('\n');

            return {
                success: true,
                context: {
                    filePath: path,
                    cursorLine,
                    cursorCharacter,
                    linesContext,
                    startLine,
                    endLine,
                    totalLines
                }
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private sendResponse(res: http.ServerResponse, statusCode: number, data: AutomationResponse): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }

    private sendContextResponse(res: http.ServerResponse, statusCode: number, data: HostContextResponse): void {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }

    dispose(): void {
        this.stopServer();
    }
}

