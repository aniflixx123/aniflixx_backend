// src/durableObjects/ViewerTracker.ts
export class ViewerTracker {
  state: DurableObjectState;
  viewers: Map<string, { userId: string; lastHeartbeat: number }>;
  env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.env = env;
    this.viewers = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    switch (path) {
      case '/register':
        return this.handleRegister(request);
      case '/heartbeat':
        return this.handleHeartbeat(request);
      case '/deregister':
        return this.handleDeregister(request);
      case '/count':
        return this.handleCount();
      default:
        return new Response('Not Found', { status: 404 });
    }
  }

  async handleRegister(request: Request): Promise<Response> {
    try {
      const { userId, sessionId } = await request.json() as any;
      
      // Clean up stale viewers (no heartbeat for 30 seconds)
      this.cleanupStaleViewers();
      
      // Add new viewer
      this.viewers.set(sessionId, {
        userId,
        lastHeartbeat: Date.now(),
      });

      // Store in state for persistence
      await this.state.storage.put('viewers', Array.from(this.viewers.entries()));

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to register viewer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleHeartbeat(request: Request): Promise<Response> {
    try {
      const { sessionId } = await request.json() as any;
      
      const viewer = this.viewers.get(sessionId);
      if (viewer) {
        viewer.lastHeartbeat = Date.now();
        await this.state.storage.put('viewers', Array.from(this.viewers.entries()));
      }

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to update heartbeat' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleDeregister(request: Request): Promise<Response> {
    try {
      const { sessionId } = await request.json() as any;
      
      this.viewers.delete(sessionId);
      await this.state.storage.put('viewers', Array.from(this.viewers.entries()));

      return new Response(JSON.stringify({
        success: true,
        viewerCount: this.viewers.size,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Failed to deregister viewer' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  async handleCount(): Promise<Response> {
    this.cleanupStaleViewers();
    
    return new Response(JSON.stringify({
      count: this.viewers.size,
      viewers: Array.from(this.viewers.values()),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  cleanupStaleViewers() {
    const now = Date.now();
    const timeout = 30000; // 30 seconds

    for (const [sessionId, viewer] of this.viewers.entries()) {
      if (now - viewer.lastHeartbeat > timeout) {
        this.viewers.delete(sessionId);
      }
    }
  }

  async initialize() {
    // Load viewers from storage on initialization
    const stored = await this.state.storage.get('viewers');
    if (stored) {
      this.viewers = new Map(stored as any);
      this.cleanupStaleViewers();
    }
  }
}