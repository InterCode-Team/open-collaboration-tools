# Auto-Accept Join Requests Implementation Plan

## Overview

This plan outlines the implementation of auto-accept functionality for the Open Collaboration Tools server. The feature will allow the server to automatically accept incoming collaboration session join requests without requiring manual approval from the host, while maintaining security and providing flexible configuration options.

## Current Architecture Analysis

### Current Join Request Flow
```
1. Guest requests to join room via REST API (/api/session/join/:room)
2. Server creates join request with polling token
3. Server sends RequestMessage to host via Socket.IO
4. Host receives onJoinRequest callback in VS Code extension
5. VS Code shows popup dialog asking host to Allow/Deny
6. Host manually clicks Allow/Deny
7. Response sent back to server
8. Server processes response and either:
   - Creates JWT token for guest if approved
   - Rejects request if denied
9. Guest polls for result and either joins or receives rejection
```

### Key Components Involved
- **`collaboration-server.ts`**: Main server class with REST API endpoints
- **`room-manager.ts`**: Manages rooms and join request logic
- **`message-relay.ts`**: Handles message passing between peers
- **VS Code Extension**: Handles join request popups and user interaction
- **Configuration System**: Manages server settings

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Configuration System Enhancement

**File: `packages/open-collaboration-server/src/utils/configuration.ts`**

Add new configuration options:
```typescript
interface AutoAcceptConfig {
  enabled: boolean;
  mode: 'all' | 'whitelist' | 'domain';
  whitelist?: string[]; // user IDs or emails
  allowedDomains?: string[]; // email domains
  maxUsers?: number; // max users per room
  requireAuth?: boolean; // require authentication
}
```

**Environment Variables:**
```bash
OCT_AUTO_ACCEPT_ENABLED=true|false
OCT_AUTO_ACCEPT_MODE=all|whitelist|domain
OCT_AUTO_ACCEPT_WHITELIST=user1@example.com,user2@example.com
OCT_AUTO_ACCEPT_DOMAINS=company.com,partner.org
OCT_AUTO_ACCEPT_MAX_USERS=10
OCT_AUTO_ACCEPT_REQUIRE_AUTH=true
```

#### 1.2 Auto-Accept Service

**New File: `packages/open-collaboration-server/src/auto-accept-manager.ts`**

```typescript
@injectable()
export class AutoAcceptManager {
  constructor(
    @inject(Configuration) private config: Configuration,
    @inject(Logger) private logger: Logger
  ) {}

  isAutoAcceptEnabled(roomId?: string): boolean
  shouldAcceptUser(user: User, room: Room): Promise<boolean>
  getAutoAcceptConfig(): AutoAcceptConfig
  updateAutoAcceptConfig(config: Partial<AutoAcceptConfig>): void
  validateUserAgainstPolicy(user: User): boolean
}
```

**Features:**
- Check if auto-accept is enabled globally or per room
- Validate users against whitelist/domain policies
- Enforce user limits per room
- Logging for all auto-accept decisions
- Runtime configuration updates

### Phase 2: Server-Side Implementation

#### 2.1 Room Manager Modifications

**File: `packages/open-collaboration-server/src/room-manager.ts`**

**Modify `requestJoin()` method:**
```typescript
async requestJoin(room: Room, user: User): Promise<string> {
  this.logger.info(`Request to join room [id: '${room.id}'] by user [id: '${user.id}']`);
  
  // Check if auto-accept is enabled
  if (this.autoAcceptManager.isAutoAcceptEnabled(room.id)) {
    const shouldAccept = await this.autoAcceptManager.shouldAcceptUser(user, room);
    
    if (shouldAccept) {
      // Auto-accept the request
      return this.processAutoAcceptedJoin(room, user);
    } else {
      // Reject based on policy
      return this.processAutoRejectedJoin(room, user);
    }
  }
  
  // Fall back to manual approval flow
  return this.processManualJoinRequest(room, user);
}
```

**New methods to add:**
```typescript
private async processAutoAcceptedJoin(room: Room, user: User): Promise<string>
private async processAutoRejectedJoin(room: Room, user: User): Promise<string>
private async processManualJoinRequest(room: Room, user: User): Promise<string>
```

#### 2.2 Collaboration Server API Extensions

**File: `packages/open-collaboration-server/src/collaboration-server.ts`**

**New REST API Endpoints:**

```typescript
// Get current auto-accept configuration
app.get('/api/auto-accept/config', async (req, res) => {
  const user = await this.getUserFromAuth(req);
  if (!user || !this.isAdminUser(user)) {
    return res.status(403).send('Admin access required');
  }
  
  const config = this.autoAcceptManager.getAutoAcceptConfig();
  res.json(config);
});

// Update auto-accept configuration
app.post('/api/auto-accept/config', async (req, res) => {
  const user = await this.getUserFromAuth(req);
  if (!user || !this.isAdminUser(user)) {
    return res.status(403).send('Admin access required');
  }
  
  const newConfig = req.body as Partial<AutoAcceptConfig>;
  this.autoAcceptManager.updateAutoAcceptConfig(newConfig);
  res.json({ success: true });
});

// Toggle auto-accept for specific room
app.post('/api/session/:roomId/auto-accept', async (req, res) => {
  const user = await this.getUserFromAuth(req);
  const room = this.roomManager.getRoomById(req.params.roomId);
  
  if (!room || room.host.user.id !== user?.id) {
    return res.status(403).send('Only room host can modify auto-accept');
  }
  
  const { enabled } = req.body;
  await this.roomManager.setRoomAutoAccept(req.params.roomId, enabled);
  res.json({ success: true });
});

// Get auto-accept status for room
app.get('/api/session/:roomId/auto-accept', async (req, res) => {
  const user = await this.getUserFromAuth(req);
  const room = this.roomManager.getRoomById(req.params.roomId);
  
  if (!room) {
    return res.status(404).send('Room not found');
  }
  
  const isEnabled = this.autoAcceptManager.isAutoAcceptEnabled(req.params.roomId);
  res.json({ enabled: isEnabled });
});
```

### Phase 3: Enhanced Features

#### 3.1 Room-Level Auto-Accept Control

**Extend Room class:**
```typescript
// In types.ts
export interface Room {
  id: string;
  host: Peer;
  guests: Peer[];
  clock: number;
  autoAcceptEnabled?: boolean;
  autoAcceptConfig?: Partial<AutoAcceptConfig>;
}
```

**Room-specific configuration:**
- Allow hosts to enable/disable auto-accept per room
- Override global settings with room-specific policies
- Persist room settings in memory (or optionally database)

#### 3.2 Security and Validation

**Authentication Requirements:**
```typescript
interface SecurityPolicy {
  requireValidAuth: boolean;
  allowedAuthProviders: string[];
  minAccountAge?: number; // days
  requireEmailVerification: boolean;
  rateLimiting: {
    maxJoinAttemptsPerHour: number;
    maxJoinAttemptsPerDay: number;
  };
}
```

**Rate Limiting:**
- Track join attempts per user/IP
- Implement exponential backoff
- Block suspicious activity

#### 3.3 Audit and Monitoring

**Audit Log:**
```typescript
interface JoinAuditLog {
  timestamp: Date;
  roomId: string;
  userId: string;
  userEmail?: string;
  action: 'auto_accepted' | 'auto_rejected' | 'manual_accepted' | 'manual_rejected';
  reason?: string;
  hostId: string;
  clientInfo: string;
}
```

**Monitoring Endpoints:**
```typescript
// Get join statistics
app.get('/api/admin/join-stats', async (req, res) => {
  // Return join attempt statistics
});

// Get recent join attempts
app.get('/api/admin/join-audit', async (req, res) => {
  // Return paginated audit log
});
```

### Phase 4: Client Integration

#### 4.1 VS Code Extension Updates

**File: `packages/open-collaboration-vscode/src/collaboration-instance.ts`**

**Add auto-accept controls:**
```typescript
// Add command to toggle auto-accept
vscode.commands.registerCommand('oct.toggleAutoAccept', async () => {
  const current = await this.getAutoAcceptStatus();
  const newStatus = !current;
  await this.setAutoAcceptStatus(newStatus);
  
  vscode.window.showInformationMessage(
    `Auto-accept ${newStatus ? 'enabled' : 'disabled'} for this session`
  );
});

// Show auto-accept status in status bar
private updateStatusBar() {
  if (this.autoAcceptEnabled) {
    this.statusBarItem.text = '$(check) Auto-Accept ON';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    this.statusBarItem.text = '$(person-add) Manual Approval';
  }
}
```

**Modify join request handler:**
```typescript
connection.peer.onJoinRequest(async (_, user) => {
  // Check if auto-accept is enabled
  if (this.autoAcceptEnabled) {
    this.logger.info(`Auto-accepting join request from ${user.name}`);
    return this.createJoinResponse();
  }
  
  // Fall back to manual approval
  return this.showManualApprovalDialog(user);
});
```

#### 4.2 Web Interface (Optional)

**Create admin dashboard:**
- `packages/open-collaboration-server/src/static/admin.html`
- Real-time configuration management
- Join request monitoring
- User management interface

### Phase 5: Configuration and Deployment

#### 5.1 Docker Configuration

**Update `docker-compose.yml`:**
```yaml
services:
  oct-server:
    environment:
      - OCT_AUTO_ACCEPT_ENABLED=true
      - OCT_AUTO_ACCEPT_MODE=domain
      - OCT_AUTO_ACCEPT_DOMAINS=company.com
      - OCT_AUTO_ACCEPT_MAX_USERS=20
```

#### 5.2 Configuration Files

**Create `config/auto-accept.yaml`:**
```yaml
autoAccept:
  enabled: true
  mode: domain
  allowedDomains:
    - company.com
    - partner.org
  maxUsers: 10
  requireAuth: true
  security:
    requireEmailVerification: true
    rateLimiting:
      maxJoinAttemptsPerHour: 10
      maxJoinAttemptsPerDay: 50
```

## Implementation Steps

### Step 1: Basic Auto-Accept (Core Feature)
1. Create `AutoAcceptManager` class
2. Add basic configuration support
3. Modify `room-manager.ts` to check auto-accept status
4. Add simple REST API endpoints
5. Test basic functionality

### Step 2: Configuration and Policies
1. Implement whitelist/domain filtering
2. Add user limit enforcement
3. Create comprehensive configuration system
4. Add validation and error handling

### Step 3: Security and Monitoring
1. Implement rate limiting
2. Add audit logging
3. Create security policies
4. Add monitoring endpoints

### Step 4: Client Integration
1. Update VS Code extension
2. Add auto-accept controls
3. Update UI to show auto-accept status
4. Test end-to-end functionality

### Step 5: Advanced Features
1. Room-level configuration
2. Web admin interface
3. Advanced security features
4. Performance optimization

## Testing Strategy

### Unit Tests
- `AutoAcceptManager` logic
- Configuration validation
- Policy enforcement
- Rate limiting

### Integration Tests
- End-to-end join flow with auto-accept
- API endpoint functionality
- VS Code extension integration
- Security policy validation

### Load Testing
- Multiple concurrent join requests
- Rate limiting effectiveness
- Memory usage with large user counts

## Security Considerations

### Potential Risks
1. **Unauthorized access**: Auto-accept could allow unwanted users
2. **DoS attacks**: Rapid join attempts could overwhelm server
3. **Resource exhaustion**: Too many users in a room
4. **Data exposure**: Automatic sharing without host awareness

### Mitigation Strategies
1. **Strong authentication requirements**
2. **Comprehensive rate limiting**
3. **User and room limits**
4. **Audit logging for accountability**
5. **Easy disable mechanism**
6. **Host override capabilities**

## Migration and Backwards Compatibility

### Backwards Compatibility
- Auto-accept disabled by default
- Existing manual approval flow unchanged
- No breaking changes to existing APIs
- Optional feature activation

### Migration Path
1. Deploy with auto-accept disabled
2. Configure policies and test
3. Gradually enable for specific rooms/users
4. Monitor and adjust as needed

## Documentation Updates

### Files to Update
- `README.md`: Add auto-accept feature description
- `packages/open-collaboration-server/README.md`: Server configuration
- API documentation: New endpoints
- VS Code extension docs: New commands and features

### New Documentation
- Auto-accept configuration guide
- Security best practices
- Troubleshooting guide
- Admin interface documentation

## Success Metrics

### Functional Metrics
- Auto-accept requests processed successfully
- Zero breaking changes to existing functionality
- Configuration changes applied without restart
- Proper security policy enforcement

### Performance Metrics
- Join request processing time < 100ms
- Memory usage remains stable
- Rate limiting prevents DoS
- Audit log performance acceptable

### User Experience Metrics
- Reduced friction for trusted users
- Maintained security for sensitive sessions
- Clear visibility into auto-accept status
- Easy configuration management

## Future Enhancements

### Potential Additions
1. **Machine Learning**: Learn from host approval patterns
2. **Integration**: LDAP/Active Directory integration
3. **Advanced Policies**: Time-based, location-based rules
4. **Notifications**: Slack/Teams integration for join events
5. **Analytics**: Detailed usage and security analytics
6. **Mobile Support**: Mobile app integration

### Scalability Considerations
1. **Database Integration**: Persistent configuration storage
2. **Horizontal Scaling**: Multi-instance coordination
3. **Caching**: Redis for configuration and rate limiting
4. **Message Queues**: Async processing for high load

This comprehensive plan provides a roadmap for implementing robust auto-accept functionality while maintaining security, flexibility, and backwards compatibility.
