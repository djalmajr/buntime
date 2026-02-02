# Buntime Runtime

A modular runtime for Bun with plugin architecture, worker pool management, and micro-frontend support.

## Table of Contents

- [Concepts](#concepts)
  - [Overview](docs/concepts/overview.md)
  - [Startup Flow](docs/concepts/startup-flow.md)
  - [Worker Pool](docs/concepts/worker-pool.md)
  - [Plugin System](docs/concepts/plugin-system.md)
  - [Server Core](docs/concepts/server-core.md)
  - [Request Handling](docs/concepts/request-handling.md)
  - [Routing](docs/concepts/routing.md)
- [Deployment](#deployment)
  - [Local Development](docs/deployment/local.md)
  - [Kubernetes](docs/deployment/kubernetes.md)
  - [k3s with Rancher](docs/deployment/k3s-rancher.md)
  - [Configuration](docs/deployment/configuration.md)
- [Operations](#operations)
  - [Logging](docs/logging.md)
- [Architecture](#architecture)
  - [Micro-Frontend Architecture](docs/micro-frontend-architecture.md)
- [Extras](#extras)
  - [Topological Sort](docs/extras/topological-sort.md)

## Concepts

### Overview

The Buntime runtime provides a modular architecture for running isolated worker applications with plugin extensibility. See [Overview](docs/concepts/overview.md) for details.

### Startup Flow

Understanding the initialization sequence and component lifecycle. See [Startup Flow](docs/concepts/startup-flow.md).

### Worker Pool

The core component managing Bun workers that execute isolated applications. Includes LRU caching, health checks, and lifecycle management. See [Worker Pool](docs/concepts/worker-pool.md).

### Plugin System

Extensible plugin architecture with lifecycle hooks, dependency management, service registry, and micro-frontend support. See [Plugin System](docs/concepts/plugin-system.md).

### Server Core

HTTP server implementation using Bun.serve() with route aggregation and request handling. See [Server Core](docs/concepts/server-core.md).

### Request Handling

Utilities for request manipulation, static file serving, body size limits, and entrypoint detection. See [Request Handling](docs/concepts/request-handling.md).

### Routing

Multi-layer routing system combining plugin routes, internal APIs, and worker applications with semver versioning support. See [Routing](docs/concepts/routing.md).

## Deployment

### Local Development

Three modes for local execution: Development (hot reload), Bundle, and Compiled binary. Also includes Docker and Docker Compose setup. See [Local Development](docs/deployment/local.md).

### Kubernetes

Helm chart deployment for Kubernetes and OpenShift/OKD with Ingress, Routes, and persistent storage. See [Kubernetes](docs/deployment/kubernetes.md).

### k3s with Rancher

Specific instructions for deploying to k3s clusters with Rancher, Traefik, and cert-manager. See [k3s with Rancher](docs/deployment/k3s-rancher.md).

### Configuration

Comprehensive configuration reference covering environment variables, plugin manifests, worker configuration, and build-time plugins. See [Configuration](docs/deployment/configuration.md).

## Operations

### Logging

Centralized logging system with multiple transports, log levels, and structured metadata. See [Logging](docs/logging.md).

## Architecture

### Micro-Frontend Architecture

Plugin UI architecture using `@zomme/frame` for shell-frame communication via iframes with MessageChannel. See [Micro-Frontend Architecture](docs/micro-frontend-architecture.md).

## Extras

Advanced concepts used internally by the runtime:

### Topological Sort

Kahn's algorithm for ordering plugins by dependencies. See [Topological Sort](docs/extras/topological-sort.md).

## Quick Start

```bash
# Development mode
cd apps/runtime
bun dev

# Or with Docker Compose
docker compose up -d
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8000` | Server port |
| `RUNTIME_WORKER_DIRS` | **Required** | Worker application directories (PATH style) |
| `RUNTIME_PLUGIN_DIRS` | `./plugins` | Plugin directories (PATH style) |
| `RUNTIME_POOL_SIZE` | `500` (prod) / `10` (dev) | Maximum worker pool size |
| `RUNTIME_LOG_LEVEL` | `info` (prod) / `debug` (dev) | Log level |

## License

See the root [LICENSE](../../LICENSE) file.
