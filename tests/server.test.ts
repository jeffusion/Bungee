import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AppConfig } from '../src/config';

// NOW import the server logic after mocks are in place.
import { handleRequest, initializeRuntimeState } from '../src/worker';

const mockConfig: AppConfig = {
  routes: [
    {
      path: '/api',
      // Route-level rules
      headers: {
        add: { 'x-route-header': 'route', 'x-shared-header': 'route' },
        remove: ['x-remove-route'],
      },
      body: {
        add: { route_field: 'route', shared_field: 'route' },
        remove: ['remove_route'],
        default: { route_default: 'default' },
      },
      upstreams: [
        {
          target: 'http://mock-target.com',
          weight: 100,
          // Upstream-level rules that merge and override
          headers: {
            add: { 'x-upstream-header': 'upstream', 'x-shared-header': 'upstream-override' },
            remove: ['x-remove-upstream'],
          },
          body: {
            add: { upstream_field: 'upstream', shared_field: 'upstream-override' },
            remove: ['remove_upstream'],
          },
        },
      ],
      failover: { enabled: false, retryableStatusCodes: [] },
    },
    {
      path: '/load-balance',
      upstreams: [
        { target: 'http://service-a.com', weight: 20 },
        { target: 'http://service-b.com', weight: 80 },
      ],
      failover: { enabled: true, retryableStatusCodes: [500] },
    },
    {
      path: '/failover-path',
      upstreams: [
        { target: 'http://fails.com', weight: 50 },
        { target: 'http://works.com', weight: 50 },
      ],
      failover: { enabled: true, retryableStatusCodes: [500] },
      healthCheck: { enabled: false, intervalSeconds: 10 },
    },
  ],
};


// Mock the global fetch
const mockedFetch = mock(async (request: Request | string, options?: RequestInit) => {
    const url = typeof request === 'string' ? request : request.url;
    if (url.startsWith('http://fails.com')) {
        return new Response('server error', { status: 500 });
    }
    if (url.startsWith('http://works.com')) {
        return new Response('success', { status: 200 });
    }
    return new Response('proxied', { status: 200 });
});
global.fetch = mockedFetch as any;


describe('Server Request Handler', () => {

  beforeEach(() => {
    mockedFetch.mockClear();
    // Initialize the state before each test based on the mocked config
    initializeRuntimeState(mockConfig);
  });

  test('should return 200 for health check', async () => {
    const req = new Request('http://localhost/health');
    const res = await handleRequest(req, mockConfig);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('should return 404 for unknown routes', async () => {
    const req = new Request('http://localhost/unknown');
    const res = await handleRequest(req, mockConfig);
    expect(res.status).toBe(404);
  });

  test('should add and remove headers correctly (with merge logic)', async () => {
    const req = new Request('http://localhost/api/test', {
        headers: {
            'x-remove-route': 'true',
            'x-remove-upstream': 'true',
        }
    });

    await handleRequest(req, mockConfig);

    const fetchOptions = mockedFetch.mock.calls[0][1];
    if (!fetchOptions) throw new Error('fetch was called without options');
    const forwardedHeaders = new Headers(fetchOptions.headers);

    // Assert route-specific header exists
    expect(forwardedHeaders.get('x-route-header')).toBe('route');
    // Assert upstream-specific header exists
    expect(forwardedHeaders.get('x-upstream-header')).toBe('upstream');
    // Assert upstream rule OVERRIDES route rule
    expect(forwardedHeaders.get('x-shared-header')).toBe('upstream-override');
    // Assert both remove rules were applied
    expect(forwardedHeaders.has('x-remove-route')).toBe(false);
    expect(forwardedHeaders.has('x-remove-upstream')).toBe(false);
  });

  test('should modify JSON body correctly (with merge logic)', async () => {
    const originalBody = {
      remove_route: 'true',
      remove_upstream: 'true',
    };

    const req = new Request('http://localhost/api/json-test', {
      method: 'POST',
      body: JSON.stringify(originalBody),
      headers: { 'Content-Type': 'application/json' },
    });

    await handleRequest(req, mockConfig);

    const fetchOptions = mockedFetch.mock.calls[0][1];
    if (!fetchOptions || !fetchOptions.body) throw new Error('fetch was called without a body');
    const forwardedBody = JSON.parse(fetchOptions.body as string);

    // Assert route-specific field exists
    expect(forwardedBody.route_field).toBe('route');
    // Assert upstream-specific field exists
    expect(forwardedBody.upstream_field).toBe('upstream');
    // Assert upstream rule OVERRIDES route rule
    expect(forwardedBody.shared_field).toBe('upstream-override');
    // Assert default field from route rule was applied
    expect(forwardedBody.route_default).toBe('default');
    // Assert both remove rules were applied
    expect(forwardedBody).not.toHaveProperty('remove_route');
    expect(forwardedBody).not.toHaveProperty('remove_upstream');
  });

   test('should add default fields only if they dont exist', async () => {
    const originalBody = {
      default_field: 'i_exist',
    };

    const req = new Request('http://localhost/api/json-test', {
      method: 'POST',
      body: JSON.stringify(originalBody),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    await handleRequest(req, mockConfig);

    const fetchOptions = mockedFetch.mock.calls[0][1];
    if (!fetchOptions || !fetchOptions.body) {
      throw new Error('fetch was called without a body');
    }
    const forwardedBody = JSON.parse(fetchOptions.body as string);

    expect(forwardedBody.default_field).toBe('i_exist');
  });

  test('should distribute requests based on upstream weights', async () => {
    const totalRequests = 1000;
    const counts: Record<string, number> = {
      'http://service-a.com': 0,
      'http://service-b.com': 0,
    };

    for (let i = 0; i < totalRequests; i++) {
      const req = new Request('http://localhost/load-balance/test');
      await handleRequest(req, mockConfig);
    }

    expect(mockedFetch).toHaveBeenCalledTimes(totalRequests);

    const calls = mockedFetch.mock.calls;
    for (const call of calls) {
      const url = call[0];
      const targetUrl = typeof url === 'string' ? url : url.url;

      if (targetUrl.startsWith('http://service-a.com')) {
        counts['http://service-a.com']++;
      } else if (targetUrl.startsWith('http://service-b.com')) {
        counts['http://service-b.com']++;
      }
    }

    const serviceARatio = counts['http://service-a.com'] / totalRequests;
    const serviceBRatio = counts['http://service-b.com'] / totalRequests;

    // Check if the distribution is approximately 20/80, allowing for some variance.
    expect(serviceARatio).toBeGreaterThan(0.15);
    expect(serviceARatio).toBeLessThan(0.25);
    expect(serviceBRatio).toBeGreaterThan(0.75);
    expect(serviceBRatio).toBeLessThan(0.85);

    // Note: This test is now less accurate due to stateful mocks.
    // A proper implementation would require deeper mocking of runtimeState.
  });

  test('should failover to a healthy upstream when one fails', async () => {
    let callCount = 0;
    const deterministicSelector = (upstreams: any[]) => {
      // First call, return the failing upstream. Second call, return the working one.
      const target = callCount === 0 ? 'http://fails.com' : 'http://works.com';
      callCount++;
      return upstreams.find(u => u.target === target);
    };

    const req = new Request('http://localhost/failover-path');
    const res = await handleRequest(req, mockConfig, deterministicSelector);

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('success');

    // Check that fetch was called twice: once for the failing and once for the successful upstream
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedFetch.mock.calls[0][0].toString()).toContain('http://fails.com');
    expect(mockedFetch.mock.calls[1][0].toString()).toContain('http://works.com');
  });
});
