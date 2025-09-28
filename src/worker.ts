import { logger } from './logger';
import type { AppConfig, Upstream, RouteConfig, ModificationRules } from './config';
import type { Server } from 'bun';
import { loadConfig } from './config';

// --- Runtime State Management ---
interface RuntimeUpstream extends Upstream {
  status: 'HEALTHY' | 'UNHEALTHY';
  lastFailure: number;
}

export const runtimeState = new Map<string, { upstreams: RuntimeUpstream[] }>();

export function initializeRuntimeState(config: AppConfig) {
  runtimeState.clear();
  for (const route of config.routes) {
    if (route.failover?.enabled && route.upstreams && route.upstreams.length > 0) {
      runtimeState.set(route.path, {
        upstreams: route.upstreams.map(up => ({
          ...up,
          status: 'HEALTHY',
          lastFailure: 0,
        })),
      });
    }
  }
  logger.info('Runtime state initialized.');
}

// --- Health Checker Worker ---
const healthChecker = new Worker(new URL('./health-checker.ts', import.meta.url).href);

healthChecker.onmessage = (event: MessageEvent<{ status: string; target: string }>) => {
  const { status, target } = event.data;
  if (status === 'recovered') {
    for (const routeState of runtimeState.values()) {
      const upstream = routeState.upstreams.find(up => up.target === target);
      if (upstream && upstream.status === 'UNHEALTHY') {
        upstream.status = 'HEALTHY';
        logger.warn({ target }, 'Upstream has recovered and is back in service.');
        break;
      }
    }
  }
};

const PORT = process.env.PORT || 3000;

function selectUpstream(upstreams: RuntimeUpstream[]): RuntimeUpstream | undefined {
  if (upstreams.length === 0) return undefined;

  // 按优先级分组 (priority 值越小优先级越高)
  const priorityGroups = new Map<number, RuntimeUpstream[]>();

  upstreams.forEach(upstream => {
    const priority = upstream.priority || 1;
    if (!priorityGroups.has(priority)) {
      priorityGroups.set(priority, []);
    }
    priorityGroups.get(priority)!.push(upstream);
  });

  // 获取排序后的优先级列表（从高到低）
  const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);

  // 依次尝试每个优先级组，选择第一个有可用 upstream 的组
  for (const priority of sortedPriorities) {
    const priorityUpstreams = priorityGroups.get(priority)!;

    // 在同一优先级组内使用加权随机选择
    const totalWeight = priorityUpstreams.reduce((sum, up) => sum + (up.weight ?? 100), 0);
    if (totalWeight === 0) continue;

    let random = Math.random() * totalWeight;
    for (const upstream of priorityUpstreams) {
      random -= upstream.weight ?? 100;
      if (random <= 0) {
        return upstream;
      }
    }

    // 如果由于浮点精度问题没有选中，返回组内最后一个
    if (priorityUpstreams.length > 0) {
      return priorityUpstreams[priorityUpstreams.length - 1];
    }
  }

  return undefined;
}

function mergeRules(routeRules: ModificationRules, upstreamRules: ModificationRules): ModificationRules {
  const merged: ModificationRules = {
    headers: {
      add: { ...routeRules.headers?.add, ...upstreamRules.headers?.add },
      replace: { ...routeRules.headers?.replace, ...upstreamRules.headers?.replace },
      remove: [...(routeRules.headers?.remove || []), ...(upstreamRules.headers?.remove || [])],
    },
    body: {
      add: { ...routeRules.body?.add, ...upstreamRules.body?.add },
      replace: { ...routeRules.body?.replace, ...upstreamRules.body?.replace },
      remove: [...(routeRules.body?.remove || []), ...(upstreamRules.body?.remove || [])],
      default: { ...routeRules.body?.default, ...upstreamRules.body?.default },
    },
  };
  if (merged.headers?.remove) merged.headers.remove = [...new Set(merged.headers.remove)];
  if (merged.body?.remove) merged.body.remove = [...new Set(merged.body.remove)];
  return merged;
}

export async function handleRequest(
  req: Request,
  config: AppConfig,
  upstreamSelector: (upstreams: RuntimeUpstream[]) => RuntimeUpstream | undefined = selectUpstream
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const requestLog = {
    method: req.method,
    url: url.pathname,
    search: url.search,
    requestId: crypto.randomUUID(),
  };

  logger.info({ request: requestLog }, `\n=== Incoming Request ===`);

  const route = config.routes.find(r => url.pathname.startsWith(r.path));

  if (!route) {
    logger.error({ request: requestLog }, `No route found for path: ${url.pathname}`);
    return new Response(JSON.stringify({ error: 'Route not found' }), { status: 404 });
  }

  const routeState = runtimeState.get(route.path);
  if (!routeState) {
    const staticUpstreams = route.upstreams.map(up => ({ ...up, status: 'HEALTHY', lastFailure: 0 } as RuntimeUpstream));
    const selectedUpstream = upstreamSelector(staticUpstreams);
    if (!selectedUpstream) {
      logger.error({ request: requestLog }, 'No valid upstream found for route.');
      return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }
    return await proxyRequest(req, route, selectedUpstream, requestLog);
  }

  const unhealthyUpstreams = routeState.upstreams.filter(up => up.status === 'UNHEALTHY');
  if (unhealthyUpstreams.length > 0 && route.healthCheck?.enabled) {
    const now = Date.now();
    for (const upstream of unhealthyUpstreams) {
      if (now - upstream.lastFailure > route.healthCheck.intervalSeconds * 1000) {
        logger.info({ request: requestLog, target: upstream.target }, 'Triggering health check for unhealthy upstream.');

        const bodyText = req.body ? await req.clone().text() : null;
        healthChecker.postMessage({
          target: upstream.target,
          retryableStatusCodes: route.failover?.retryableStatusCodes || [],
          requestData: {
            url: new URL(url.pathname, upstream.target).href,
            method: req.method,
            headers: Array.from(req.headers.entries()),
            body: bodyText,
          },
        });
        upstream.lastFailure = now;
      }
    }
  }

  const healthyUpstreams = routeState.upstreams.filter(up => up.status === 'HEALTHY');
  if (healthyUpstreams.length === 0) {
    logger.error({ request: requestLog }, 'No healthy upstreams available for this route.');
    return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
  }

  const firstTryUpstream = upstreamSelector(healthyUpstreams);
  if (!firstTryUpstream) {
    logger.error({ request: requestLog }, 'Upstream selection failed.');
    return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
  }

  const retryQueue = healthyUpstreams
    .filter(up => up.target !== firstTryUpstream.target)
    .sort((a, b) => {
      // 首先按优先级排序（数字越小优先级越高）
      const priorityA = a.priority || 1;
      const priorityB = b.priority || 1;
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      // 同一优先级内按权重排序（权重越高越优先）
      return (b.weight ?? 100) - (a.weight ?? 100);
    });

  const attemptQueue = [firstTryUpstream, ...retryQueue];

  for (const upstream of attemptQueue) {
    try {
      const response = await proxyRequest(req, route, upstream, requestLog);

      if (!route.failover?.retryableStatusCodes.includes(response.status)) {
        return response;
      }

      logger.warn({ request: requestLog, target: upstream.target, status: response.status }, 'Upstream returned a retryable status code.');
      throw new Error(`Upstream returned retryable status code: ${response.status}`);

    } catch (error) {
      logger.warn({ request: requestLog, target: upstream.target, error: (error as Error).message }, 'Request to upstream failed. Marking as UNHEALTHY and trying next.');
      upstream.status = 'UNHEALTHY';
      upstream.lastFailure = Date.now();
    }
  }

  logger.error({ request: requestLog }, 'All healthy upstreams failed.');
  return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
}

async function proxyRequest(req: Request, route: RouteConfig, upstream: Upstream, requestLog: any): Promise<Response> {
  const targetUrl = new URL(upstream.target);
  targetUrl.pathname = new URL(req.url).pathname;
  targetUrl.search = new URL(req.url).search;

  const finalRules = mergeRules(route, upstream);
  const { headers, body } = await prepareRequest(req, finalRules, requestLog);

  logger.info({ request: requestLog, target: targetUrl.href }, `\n=== Proxying to target ===`);

  try {
    const proxyRes = await fetch(targetUrl.href, {
      method: req.method,
      headers: headers,
      body: body,
      redirect: 'manual',
    });
    logger.info({ request: requestLog, status: proxyRes.status }, `\n=== Streaming Response from target ===`);
    return new Response(proxyRes.body, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: proxyRes.headers,
    });
  } catch (error) {
    throw error;
  }
}

async function prepareRequest(req: Request, rules: ModificationRules, requestLog: any): Promise<{ headers: Headers; body: BodyInit | null }> {
  const headers = new Headers(req.headers);
  headers.delete('host');

  if (rules.headers) {
    if (rules.headers.remove) {
      for (const key of rules.headers.remove) {
        headers.delete(key);
        logger.debug({ request: requestLog, header: { key } }, 'Removed header');
      }
    }
    if (rules.headers.replace) {
      for (const [key, value] of Object.entries(rules.headers.replace)) {
        if (headers.has(key)) {
          headers.set(key, value);
          logger.debug({ request: requestLog, header: { key } }, 'Replaced header');
        }
      }
    }
    if (rules.headers.add) {
      for (const [key, value] of Object.entries(rules.headers.add)) {
        headers.set(key, value);
        logger.debug({ request: requestLog, header: { key } }, 'Added/Overwrote header');
      }
    }
  }

  let body: BodyInit | null = req.body;
  const contentType = req.headers.get('content-type') || '';

  if (rules.body && req.body && contentType.includes('application/json')) {
    try {
      let modifiedBody = await req.clone().json() as Record<string, any>;
      if (rules.body.remove) {
        for (const key of rules.body.remove) {
          delete modifiedBody[key];
          logger.debug({ request: requestLog, body: { key } }, `Removed body field`);
        }
      }
      if (rules.body.replace) {
        for (const [key, value] of Object.entries(rules.body.replace)) {
          if (key in modifiedBody) {
            modifiedBody[key] = value;
            logger.debug({ request: requestLog, body: { key } }, `Replaced body field`);
          }
        }
      }
      if (rules.body.add) {
        for (const [key, value] of Object.entries(rules.body.add)) {
          modifiedBody[key] = value;
          logger.debug({ request: requestLog, body: { key } }, `Added/Overwrote body field`);
        }
      }
      if (rules.body.default) {
        for (const [key, value] of Object.entries(rules.body.default)) {
          if (modifiedBody[key] === undefined) {
            modifiedBody[key] = value;
            logger.debug({ request: requestLog, body: { key } }, `Defaulted body field`);
          }
        }
      }
      logger.info({ request: requestLog, keys: Object.keys(modifiedBody) }, '--- Modified Body Keys ---');
      body = JSON.stringify(modifiedBody);
      headers.set('Content-Length', String(Buffer.byteLength(body as string)));
    } catch (err) {
      logger.error({ request: requestLog, error: err }, 'Failed to modify request body.');
      body = req.body;
    }
  }
  return { headers, body };
}

export function startServer(config: AppConfig): Server {
  initializeRuntimeState(config);
  logger.info(`🚀 Reverse proxy server starting on port ${PORT}`);
  logger.info(`📋 Health check: http://localhost:${PORT}/health`);
  logger.info('\n📝 Configured routes:');
  config.routes.forEach(route => {
    const targets = route.upstreams.map(up =>
      `${up.target} (w: ${up.weight}, p: ${up.priority || 1})`
    ).join(', ');
    logger.info(`  ${route.path} -> [${targets}]`);
  });
  logger.info('\n');

  const server = Bun.serve({
    port: PORT,
    reusePort: true, // 允许多个进程共享同一端口
    fetch: (req) => handleRequest(req, config),
    error(error: Error) {
      logger.fatal({ error }, 'A top-level server error occurred');
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    },
  });
  return server;
}

export function shutdownServer(server: Server) {
  logger.info('Shutting down server...');
  server.stop(true);
  logger.info('Server has been shut down.');
  process.exit(0);
}

// --- Worker (Slave) Logic ---
async function startWorker() {
  try {
    const config = await loadConfig();
    const workerId = process.env.WORKER_ID || '0';

    logger.info(`Worker #${workerId} starting with PID ${process.pid}`);

    const server = startServer(config);

    if (process.send) {
      process.send({ status: 'ready', pid: process.pid });
    }

    process.on('message', (message: any) => {
      if (message && typeof message === 'object' && message.command === 'shutdown') {
        logger.info(`Worker #${workerId} received shutdown command. Initiating graceful shutdown...`);
        shutdownServer(server);
      }
    });

    const handleSignal = (signal: NodeJS.Signals) => {
      logger.info(`Worker #${workerId} received ${signal}. Initiating graceful shutdown...`);
      shutdownServer(server);
    };

    process.on('SIGINT', handleSignal);
    process.on('SIGTERM', handleSignal);

  } catch (error) {
    logger.error({ error }, 'Worker failed to start');
    if (process.send) {
      process.send({ status: 'error', error: (error instanceof Error ? error.message : String(error)) });
    }
    process.exit(1);
  }
}

if (import.meta.main) {
  startWorker();
}
