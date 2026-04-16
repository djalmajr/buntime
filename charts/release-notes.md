## What's New

### Runtime
- TTL is now sliding: resets on each request, worker stays alive while receiving traffic
- `idleTimeout` is now notification-only: sends `onIdle` event but no longer terminates the worker
- `maxRequests` remains as the safety net for forced worker recycling

### Docker
- Bun upgraded from v1.3.8 to v1.3.12
