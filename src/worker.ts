import { logger } from './logger';
import type { AppConfig, Upstream, RouteConfig, ModificationRules, TransformerConfig, ResponseRuleSet } from './config';
import type { Server } from 'bun';
import { loadConfig } from './config';
import { processDynamicValue, type ExpressionContext } from './expression-engine';
import { transformers } from './transformers';
import { createSseTransformerStream } from './streaming';
import { mergeWith, isArray } from 'lodash-es';


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
  const retryQueue = healthyUpstreams.filter(up => up.target !== firstTryUpstream.target).sort((a,b) => (a.priority || 1) - (b.priority || 1) || (b.weight || 100) - (a.weight || 100));
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

function deepMergeRules(base: ModificationRules, override: ModificationRules): ModificationRules {
  const customizer = (objValue: any, srcValue: any) => {
    if (isArray(objValue)) {
      return [...new Set([...objValue, ...srcValue])];
    }
  };
  return mergeWith({}, base, override, customizer);
}

function removeEmptyFields(obj: any): any {
    if (obj === null || obj === undefined) {
        return undefined;
    }
    if (Array.isArray(obj)) {
        return obj.map(removeEmptyFields).filter(v => v !== undefined);
    }
    if (typeof obj === 'object') {
        const newObj: { [key: string]: any } = {};
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                const value = removeEmptyFields(obj[key]);
                if (value !== undefined && value !== null && value !== '') {
                    newObj[key] = value;
                }
            }
        }
        // If the object becomes empty after cleaning, return undefined so it can be removed by its parent.
        return Object.keys(newObj).length > 0 ? newObj : undefined;
    }
    return obj;
}

export async function applyBodyRules(
  body: Record<string, any>,
  rules: ModificationRules['body'],
  context: ExpressionContext,
  requestLog: any
): Promise<Record<string, any>> {
  let modifiedBody = { ...body };
  logger.debug({ request: requestLog, phase: 'before', body: modifiedBody }, "Body before applying rules");

  if (rules) {
    const processAndSet = (key: string, value: any, action: 'add' | 'replace' | 'default') => {
        try {
            const processedValue = processDynamicValue(value, context);
            modifiedBody[key] = processedValue; // Assign first, clean up later
            logger.debug({ request: requestLog, body: { key, value: processedValue } }, `Applied body '${action}' rule (pre-cleanup)`);
        } catch (err) {
            logger.error({ request: requestLog, body: { key }, err }, `Failed to process dynamic body '${action}' rule`);
        }
    };

    if (rules.add) {
      for (const [key, value] of Object.entries(rules.add)) {
        processAndSet(key, value, 'add');
      }
    }
    if (rules.replace) {
      for (const [key, value] of Object.entries(rules.replace)) {
        if (key in modifiedBody || (rules.add && key in rules.add)) {
          processAndSet(key, value, 'replace');
        }
      }
    }
    if (rules.default) {
        for (const [key, value] of Object.entries(rules.default)) {
          if (modifiedBody[key] === undefined) {
            processAndSet(key, value, 'default');
          }
        }
      }
    if (rules.remove) {
      for (const key of rules.remove) {
        const wasAdded = rules.add && key in rules.add;
        const wasReplaced = rules.replace && key in rules.replace;
        if (!wasAdded && !wasReplaced) {
            delete modifiedBody[key];
            logger.debug({ request: requestLog, body: { key } }, `Removed body field`);
        }
      }
    }
  }

  // Recursively clean the entire body at the end.
  const finalCleanedBody = removeEmptyFields(modifiedBody);

  // 检查是否有多事件标志
  if (finalCleanedBody && finalCleanedBody.__multi_events && Array.isArray(finalCleanedBody.__multi_events)) {
    logger.debug({ request: requestLog, eventCount: finalCleanedBody.__multi_events.length }, "Returning multiple events");
    return finalCleanedBody.__multi_events;
  }

  logger.debug({ request: requestLog, phase: 'after', body: finalCleanedBody }, "Body after applying rules and cleanup");
  return finalCleanedBody || {};
}

async function proxyRequest(req: Request, route: RouteConfig, upstream: Upstream, requestLog: any): Promise<Response> {
  // 1. Set target URL and apply route-level pathRewrite
  const targetUrl = new URL(upstream.target);
  const targetBasePath = targetUrl.pathname;
  targetUrl.pathname = new URL(req.url).pathname;
  targetUrl.search = new URL(req.url).search;

  if (route.pathRewrite) {
    const originalPathname = targetUrl.pathname;
    for (const [pattern, replacement] of Object.entries(route.pathRewrite)) {
      try {
        const regex = new RegExp(pattern);
        if (regex.test(targetUrl.pathname)) {
          targetUrl.pathname = targetUrl.pathname.replace(regex, replacement);
          logger.debug({ request: requestLog, path: { from: originalPathname, to: targetUrl.pathname }, rule: { pattern, replacement } }, `Applied route pathRewrite`);
          break;
        }
      } catch (error) {
        logger.error({ request: requestLog, pattern, error }, 'Invalid regex in pathRewrite rule');
      }
    }
  }

  // 2. Build initial context
  const { context, isStreamingRequest, parsedBody } = await buildRequestContext(req, { pathname: targetUrl.pathname, search: targetUrl.search }, requestLog);

  // 3. Find active transformer rule
  const transformerConfig = upstream.transformer || route.transformer;

  let transformerRules: TransformerConfig[] = [];
  if (typeof transformerConfig === 'string') {
    transformerRules = transformers[transformerConfig] || [];
  } else if (Array.isArray(transformerConfig)) {
    transformerRules = transformerConfig;
  } else if (typeof transformerConfig === 'object' && transformerConfig !== null) {
    transformerRules = [transformerConfig as TransformerConfig];
  }

  let activeTransformerRule: TransformerConfig | undefined;
  if (transformerRules.length > 0) {
    const currentPath = targetUrl.pathname;
    activeTransformerRule = transformerRules.find(rule => {
        try {
            const matches = new RegExp(rule.path.match).test(currentPath);
            return matches;
        } catch (e) {
            return false;
        }
    });
  }

  // 4. Build final request context following the Onion Model
  // Layer 1 (Outer): Route and Upstream rules
  const { path: routePath, upstreams, transformer: routeTransformer, ...routeModificationRules } = route;
  const { target, weight, priority, transformer: upstreamTransformer, ...upstreamModificationRules } = upstream;
  const routeAndUpstreamRequestRules = deepMergeRules(routeModificationRules, upstreamModificationRules);

  let intermediateContext: ExpressionContext = { ...context };
  let intermediateBody = parsedBody;
  if(routeAndUpstreamRequestRules.body) {
    intermediateBody = await applyBodyRules(parsedBody, routeAndUpstreamRequestRules.body, intermediateContext, requestLog);
    intermediateContext.body = intermediateBody;
  }

  // 5a. Apply path transformation using the intermediate context (after upstream rules, before transformer body rules)
  if (activeTransformerRule) {
    logger.debug({ request: requestLog, pathMatch: activeTransformerRule.path.match }, `Activating transformer rule`);
    const { match, replace } = activeTransformerRule.path;
    try {
        const originalPath = targetUrl.pathname;
        const processedReplacement = processDynamicValue(replace, intermediateContext);
        const newPath = originalPath.replace(new RegExp(match), processedReplacement);
        const urlParts = newPath.split('?');
        targetUrl.pathname = urlParts[0];
        targetUrl.search = urlParts.length > 1 ? '?' + urlParts.slice(1).join('?') : '';
        logger.debug({ request: requestLog, path: { from: originalPath, to: targetUrl.pathname + targetUrl.search, rule: match } }, `Applied transformer path rule`);
    } catch(error) {
        logger.error({ request: requestLog, rule: activeTransformerRule.path, error }, 'Failed to apply transformer path rule');
    }
  }

  // 5b. Apply transformer body rules (Inner layer)
  const transformerRequestRules = activeTransformerRule?.request || {};
  let finalBody = intermediateBody;
  if(transformerRequestRules.body) {
    finalBody = await applyBodyRules(intermediateBody, transformerRequestRules.body, intermediateContext, requestLog);
  }

  // Rebuild context with the final body
  const finalContext: ExpressionContext = { ...context, body: finalBody };

  targetUrl.pathname = (targetBasePath === '/' ? '' : targetBasePath.replace(/\/$/, '')) + targetUrl.pathname;

  // 6. Prepare final headers
  const finalRequestRules = deepMergeRules(routeAndUpstreamRequestRules, transformerRequestRules);
  const headers = new Headers(req.headers);
  headers.delete('host');

  if (finalRequestRules.headers) {
    if (finalRequestRules.headers.remove) for (const key of finalRequestRules.headers.remove) headers.delete(key);
    if (finalRequestRules.headers.replace) {
        for (const [key, value] of Object.entries(finalRequestRules.headers.replace)) {
            if (headers.has(key)) {
                try { headers.set(key, String(processDynamicValue(value, finalContext))); }
                catch (e) { logger.error({request: requestLog, error: (e as Error).message}, "Header replace expression failed") }
            }
        }
    }
    if (finalRequestRules.headers.add) {
        for (const [key, value] of Object.entries(finalRequestRules.headers.add)) {
            try { headers.set(key, String(processDynamicValue(value, finalContext))); }
            catch (e) { logger.error({request: requestLog, error: (e as Error).message}, "Header add expression failed") }
        }
    }
  }

  // 7. Prepare final body
  let body: BodyInit | null = req.body;
  const contentType = req.headers.get('content-type') || '';
  if (req.body && contentType.includes('application/json')) {
    body = JSON.stringify(finalBody);
    // Avoid setting Content-Length for empty bodies
    if (Object.keys(finalBody).length > 0) {
      headers.set('Content-Length', String(Buffer.byteLength(body as string)));
    } else {
        headers.delete('Content-Length');
    }
  }

  // 8. Execute the request
  logger.info({ request: requestLog, target: targetUrl.href }, `\n=== Proxying to target ===`);
  try {
    const proxyRes = await fetch(targetUrl.href, { method: req.method, headers, body, redirect: 'manual' });
    logger.info({ request: requestLog, status: proxyRes.status }, `\n=== Received Response from target ===`);

    // 9. Prepare the response (Response Onion)
    let finalResponseRules: ModificationRules = {};
    const responseRules = activeTransformerRule?.response;
    let activeResponseRuleSet: ResponseRuleSet | undefined;

    if (responseRules) {
        for (const rule of responseRules) {
            try {
                const statusMatch = new RegExp(rule.match.status).test(String(proxyRes.status));
                // Header matching logic can be added here in the future
                if (statusMatch) {
                    activeResponseRuleSet = rule.rules;
                    logger.debug({ request: requestLog, match: rule.match }, "Found matching response rule");
                    break; // Use the first matching rule
                }
            } catch (e) {
                logger.error({ request: requestLog, rule, error: e }, "Invalid regex in response rule match");
            }
        }
    }

    if (activeResponseRuleSet) {
        if (isStreamingRequest && activeResponseRuleSet.stream) {
            // 对于流式请求，直接使用stream规则（可能是StreamTransformRules或ModificationRules）
            finalResponseRules = activeResponseRuleSet.stream as any;
        } else {
            const responseRuleSet = activeResponseRuleSet.default;
            // Response Onion - Inner layer (Transformer) is applied first, then merged with outer layer (Upstream)
            finalResponseRules = deepMergeRules(responseRuleSet || {}, upstreamModificationRules);
        }
    } else {
        finalResponseRules = upstreamModificationRules;
    }

    const { headers: responseHeaders, body: responseBody } = await prepareResponse(proxyRes, finalResponseRules, context, requestLog, isStreamingRequest);

    return new Response(responseBody, {
      status: proxyRes.status,
      statusText: proxyRes.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    throw error;
  }
}

async function prepareResponse(
  res: Response,
  rules: ModificationRules,
  requestContext: ExpressionContext,
  requestLog: any,
  isStreamingRequest: boolean
): Promise<{ headers: Headers; body: BodyInit | null }> {
  const headers = new Headers(res.headers);
  const contentType = headers.get('content-type') || '';

  // Since we are buffering the body, we MUST remove chunked encoding headers.
  headers.delete('transfer-encoding');
  headers.delete('content-encoding');

  if (isStreamingRequest && contentType.includes('text/event-stream') && res.body) {
    logger.info({ request: requestLog }, '--- Applying SSE Stream Transformation ---');

    // For streams, we don't modify content-length here as the final length is unknown.
    return {
      headers,
      body: res.body.pipeThrough(createSseTransformerStream(rules, requestContext, requestLog)),
    };
  }

  // Safely read the body as text first to avoid consuming the stream more than once.
  const rawBodyText = await res.text();
  logger.debug({ request: requestLog, responseBody: rawBodyText }, "Raw response body from upstream");
  let body: BodyInit | null = rawBodyText;

  if (rules.body && contentType.includes('application/json')) {
    try {
      // Only parse and modify if there is a body.
      if (rawBodyText) {
        const parsedBody = JSON.parse(rawBodyText);
        const { body: _, ...baseRequestContext } = requestContext;
        const responseContext: ExpressionContext = { ...baseRequestContext, body: parsedBody };
        const modifiedBody = await applyBodyRules(parsedBody, rules.body, responseContext, requestLog);
        body = JSON.stringify(modifiedBody);
      } else {
        logger.debug({ request: requestLog }, "Response body is empty, skipping modification.");
      }
    } catch (err) {
      logger.error({ request: requestLog, error: err }, 'Failed to parse or modify JSON response body. Returning original body.');
      // `body` already contains the original rawBodyText, so no action needed.
    }
  }

  // Always calculate and set the final content-length as we have buffered the entire body.
  const finalBody = body as string || '';
  headers.set('Content-Length', String(Buffer.byteLength(finalBody)));

  return { headers, body: finalBody };
}

async function buildRequestContext(req: Request, rewrittenPath: { pathname: string, search: string }, requestLog: any): Promise<{ context: ExpressionContext; isStreamingRequest: boolean; parsedBody: Record<string, any> }> {
  const url = new URL(req.url);
  let parsedBody: Record<string, any> = {};
  const contentType = req.headers.get('content-type') || '';
  if (req.body && contentType.includes('application/json')) {
    try {
      parsedBody = await req.clone().json();
    } catch (err) {
      logger.warn({ request: requestLog, error: err }, 'Failed to parse JSON body for expression context');
    }
  }

  const context: ExpressionContext = {
    headers: Object.fromEntries(req.headers.entries()),
    body: parsedBody,
    url: { pathname: rewrittenPath.pathname, search: rewrittenPath.search, host: url.hostname, protocol: url.protocol },
    method: req.method,
    env: process.env as Record<string, string>,
  };

  return { context, isStreamingRequest: !!context.body.stream, parsedBody };
}

export function startServer(config: AppConfig): Server {
  initializeRuntimeState(config);
  logger.info(`🚀 Reverse proxy server starting on port ${PORT}`);
  logger.info(`📋 Health check: http://localhost:${PORT}/health`);
  logger.info('\n📝 Configured routes:');
  config.routes.forEach(route => {
    const targets = route.upstreams.map(up => `${up.target} (w: ${up.weight}, p: ${up.priority || 1})`).join(', ');
    logger.info(`  ${route.path} -> [${targets}]`);
  });
  logger.info('\n');

  const server = Bun.serve({
    port: PORT,
    reusePort: true,
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
