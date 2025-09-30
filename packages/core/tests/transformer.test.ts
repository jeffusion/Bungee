import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { AppConfig } from '../src/config';
import { handleRequest, initializeRuntimeState } from '../src/worker';

// Mock config with updated transformer structure
const mockConfig: AppConfig = {
  routes: [
    {
      path: '/v1/anthropic-proxy',
      pathRewrite: { '^/v1/anthropic-proxy': '/v1' },
      transformer: 'anthropic-to-openai',
      upstreams: [{ target: 'http://mock-openai.com', weight: 100, priority: 1 }],
    },
    {
      path: '/v1/gemini-proxy',
      pathRewrite: { '^/v1/gemini-proxy': '/v1' },
      transformer: 'anthropic-to-gemini',
      upstreams: [{ target: 'http://mock-gemini.com', weight: 100, priority: 1 }],
    },
    {
      path: '/v1/inline-proxy',
      transformer: { // Single inline rule
        path: { action: 'replace', match: '^/v1/inline-proxy$', replace: '/inline-endpoint' },
        request: { body: { add: { inline_request: true } } },
        response: [
          {
            match: { status: "^2..$" },
            rules: {
              default: {
                body: { add: { inline_response: true } }
              }
            }
          }
        ],
      },
      upstreams: [{ target: 'http://mock-inline.com', weight: 100, priority: 1 }],
    },
    {
      path: '/v1/multi-rule-proxy',
      transformer: [ // Array of inline rules
        {
          path: { action: 'replace', match: '/v1/multi-rule-proxy/path-a', replace: '/path-a-rewritten' },
          request: { body: { add: { rule: 'A' } } },
        },
        {
          path: { action: 'replace', match: '/v1/multi-rule-proxy/path-b', replace: '/path-b-rewritten' },
          request: { body: { add: { rule: 'B' } } },
        }
      ],
      upstreams: [{ target: 'http://mock-multi-rule.com', weight: 100, priority: 1 }],
    },
    {
        path: '/api',
        pathRewrite: {
          '^/api/v1': '/v1-internal',
          '^/api': ''
        },
        upstreams: [{
          target: 'http://mock-rewrite-target.com',
          weight: 100,
          priority: 1
        }]
      },
    {
      path: '/v1/base-path-test',
      upstreams: [{
        target: 'http://mock-base-path.com/sub/path',
        weight: 100,
        priority: 1,
        transformer: {
          path: { action: 'replace', match: '.*', replace: '/final-endpoint' },
        }
      }],
    },
    {
      path: '/v1/onion-model-test',
      upstreams: [{
        target: 'http://mock-onion-test.com',
        weight: 100,
        priority: 1,
        transformer: {
          path: {
            action: 'replace',
            match: '.*', // Match everything for this test
            replace: "{{ `/v1/models/${body.model}:generateContent` }}"
          },
          request: {
            body: {
              // The transformer still removes the model field, but after the path has been processed
              remove: ['model']
            }
          }
        },
        body: {
          replace: {
            model: 'gemini-1.5-pro-from-upstream'
          }
        }
      }],
    },
  ],
};

// Mock the global fetch
const mockedFetch = mock(async (request: Request | string, options?: RequestInit) => {
  const url = typeof request === 'string' ? request : request.url;

  let requestBody: any = {};
  if (options?.body) {
    let bodyString = '';
    if (typeof options.body === 'string') {
      bodyString = options.body;
    } else if (options.body instanceof ReadableStream) {
      const reader = options.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bodyString += decoder.decode(value);
      }
    }
    if (bodyString) {
      try {
        requestBody = JSON.parse(bodyString);
      } catch (e) {
        console.error("Failed to parse body string:", bodyString);
        throw e;
      }
    }
  }


  if (url.startsWith('http://mock-openai.com')) {
    const openAIResponse = {
      choices: [{ message: { content: 'This is a test response from mock OpenAI.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    return new Response(JSON.stringify(openAIResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.startsWith('http://mock-gemini.com')) {
    const geminiResponse = {
      candidates: [{ content: { parts: [{ text: 'This is a test response from mock Gemini.' }], role: 'model' }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
    };
    return new Response(JSON.stringify(geminiResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.startsWith('http://mock-inline.com') || url.startsWith('http://mock-multi-rule.com')) {
    return new Response(JSON.stringify({ received_body: requestBody }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (url.startsWith('http://mock-onion-test.com')) {
    return new Response('onion model ok', { status: 200 });
  }

  if (url.startsWith('http://mock-base-path.com')) {
    return new Response('base path ok', { status: 200 });
  }

  if (url.startsWith('http://mock-rewrite-target.com')) {
    return new Response('path rewrite middleware', { status: 200 });
  }

  return new Response('proxied', { status: 200 });
});
global.fetch = mockedFetch as any;

describe('Transformer Logic (New Architecture)', () => {
  beforeEach(() => {
    mockedFetch.mockClear();
    initializeRuntimeState(mockConfig);
  });

  test('should transform Anthropic request to OpenAI and rewrite path', async () => {
    const anthropicRequestBody = {
      model: 'claude-3-opus-20240229',
      max_tokens_to_sample: 1024,
      messages: [{ role: 'user', content: 'Hello, world' }],
    };
    const req = new Request('http://localhost/v1/anthropic-proxy/messages', {
      method: 'POST',
      body: JSON.stringify(anthropicRequestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    await handleRequest(req, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockedFetch.mock.calls[0];
    const forwardedBody = JSON.parse(fetchOptions!.body as string);

    // Check path transformation from the matched rule
    expect(fetchUrl).toBe('http://mock-openai.com/v1/chat/completions');

    // Check request body transformation
    expect(forwardedBody.max_tokens).toBe(1024);
    expect(forwardedBody).not.toHaveProperty('max_tokens_to_sample');
  });

  test('should select and apply the correct rule from a multi-rule transformer', async () => {
    // Test request to path-a
    const reqA = new Request('http://localhost/v1/multi-rule-proxy/path-a', {
      method: 'POST', body: JSON.stringify({ original: true }), headers: { 'Content-Type': 'application/json' }
    });
    await handleRequest(reqA, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrlA, fetchOptionsA] = mockedFetch.mock.calls[0];
    const forwardedBodyA = JSON.parse(fetchOptionsA!.body as string);

    expect(fetchUrlA).toBe('http://mock-multi-rule.com/path-a-rewritten');
    expect(forwardedBodyA.rule).toBe('A');
    expect(forwardedBodyA.original).toBe(true);

    mockedFetch.mockClear();

    // Test request to path-b
    const reqB = new Request('http://localhost/v1/multi-rule-proxy/path-b', {
      method: 'POST', body: JSON.stringify({ original: true }), headers: { 'Content-Type': 'application/json' }
    });
    await handleRequest(reqB, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrlB, fetchOptionsB] = mockedFetch.mock.calls[0];
    const forwardedBodyB = JSON.parse(fetchOptionsB!.body as string);

    expect(fetchUrlB).toBe('http://mock-multi-rule.com/path-b-rewritten');
    expect(forwardedBodyB.rule).toBe('B');
  });

  test('should handle route.pathRewrite before transformer path matching', async () => {
    const configWithRewriteAndTransformer: AppConfig = {
      routes: [
        {
          path: '/api',
          pathRewrite: { '^/api': '' }, // Strips /api prefix
          transformer: 'anthropic-to-openai', // Expects to match on the rewritten path
          upstreams: [{ target: 'http://mock-openai.com', weight: 100, priority: 1 }],
        },
      ],
    };

    const req = new Request('http://localhost/api/v1/messages', {
      method: 'POST', body: JSON.stringify({ messages: [] }), headers: { 'Content-Type': 'application/json' },
    });

    await handleRequest(req, configWithRewriteAndTransformer);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl] = mockedFetch.mock.calls[0];

    // pathRewrite removed /api, then transformer matched /v1/messages and rewrote it
    expect(fetchUrl).toBe('http://mock-openai.com/v1/chat/completions');
  });

  test('should rewrite path using http-proxy-middleware style rules', async () => {
    const req1 = new Request('http://localhost/api/v1/users', { method: 'GET' });
    await handleRequest(req1, mockConfig);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl1] = mockedFetch.mock.calls[0];
    expect(fetchUrl1).toBe('http://mock-rewrite-target.com/v1-internal/users');

    mockedFetch.mockClear();

    const req2 = new Request('http://localhost/api/health', { method: 'GET' });
    await handleRequest(req2, mockConfig);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl2] = mockedFetch.mock.calls[0];
    expect(fetchUrl2).toBe('http://mock-rewrite-target.com/health');
  });

  test('should handle single inline transformer rule', async () => {
    const req = new Request('http://localhost/v1/inline-proxy', {
      method: 'POST',
      body: JSON.stringify({ original: 'data' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleRequest(req, mockConfig);
    const responseBody = await response.json();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockedFetch.mock.calls[0];
    const forwardedBody = JSON.parse(fetchOptions!.body as string);

    expect(fetchUrl).toBe('http://mock-inline.com/inline-endpoint');
    expect(forwardedBody.inline_request).toBe(true);
    expect(forwardedBody.original).toBe('data');
    expect(responseBody.received_body).toEqual(forwardedBody);
    expect(responseBody.inline_response).toBe(true);
  });

  test('should transform Anthropic request to Gemini and handle streaming', async () => {
    const anthropicRequestBody = {
      model: 'claude-3-opus-20240229',
      max_tokens_to_sample: 1024,
      messages: [{ role: 'user', content: 'Hello, world' }],
      stream: true
    };
    const req = new Request('http://localhost/v1/gemini-proxy/messages', {
      method: 'POST',
      body: JSON.stringify(anthropicRequestBody),
      headers: { 'Content-Type': 'application/json' },
    });

    await handleRequest(req, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockedFetch.mock.calls[0];
    const forwardedBody = JSON.parse(fetchOptions!.body as string);

    const modelInRequest = anthropicRequestBody.model;
    expect(fetchUrl).toBe(`http://mock-gemini.com/v1beta/models/${modelInRequest}:streamGenerateContent?alt=sse`);
    expect(forwardedBody.generationConfig.maxOutputTokens).toBe(1024);
  });

  test('should prepend upstream target path to the rewritten request path', async () => {
    const req = new Request('http://localhost/v1/base-path-test', { method: 'POST' });

    await handleRequest(req, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl] = mockedFetch.mock.calls[0];

    expect(fetchUrl).toBe('http://mock-base-path.com/sub/path/final-endpoint');
  });

  test('should transform Gemini error response to Anthropic error format', async () => {
    // Override the global mock fetch for this single test to simulate an error
    mockedFetch.mockImplementationOnce(async (request: Request | string, options?: RequestInit) => {
        const geminiErrorResponse = {
            error: {
                code: 404,
                message: 'The requested model was not found.',
                status: 'NOT_FOUND',
            },
        };
        return new Response(JSON.stringify(geminiErrorResponse), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    const req = new Request('http://localhost/v1/gemini-proxy/messages', {
        method: 'POST',
        body: JSON.stringify({ model: 'gemini-pro', messages: [] }),
        headers: { 'Content-Type': 'application/json' },
    });

    const finalResponse = await handleRequest(req, mockConfig);
    const finalBody = await finalResponse.json();

    // The mock implementation is only for one call, so let's check it was called
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    expect(finalResponse.status).toBe(404); // Status should be passed through
    expect(finalBody.type).toBe('error');
    expect(finalBody.error.type).toBe('api_error');
    expect(finalBody.error.message).toBe('The requested model was not found.');
  });

  test('should apply upstream body rules before transformer rules (Onion Model)', async () => {
    const req = new Request('http://localhost/v1/onion-model-test', {
      method: 'POST',
      body: JSON.stringify({
        model: 'original-model-from-client',
        messages: [],
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    await handleRequest(req, mockConfig);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [fetchUrl, fetchOptions] = mockedFetch.mock.calls[0];
    const forwardedBody = JSON.parse(fetchOptions!.body as string);

    // 1. Verify URL construction: The URL should be built using the body *after* the upstream rule was applied.
    expect(fetchUrl).toContain('gemini-1.5-pro-from-upstream');
    expect(fetchUrl).not.toContain('original-model-from-client');

    // 2. Verify final body modification: The transformer's `remove` rule should be applied last.
    expect(forwardedBody).not.toHaveProperty('model');
  });

  test('should support multi-event response transformation', async () => {
    const multiEventConfig: AppConfig = {
      routes: [
        {
          path: '/v1/multi-event-test',
          transformer: {
            path: { action: 'replace', match: '.*', replace: '/test' },
            response: [
              {
                match: { status: "^2..$" },
                rules: {
                  default: {
                    body: {
                      add: {
                        __multi_events: [
                          {
                            id: '{{ "event_1_" + crypto.randomUUID() }}',
                            type: 'first_event',
                            data: '{{ body.original_data }}'
                          },
                          {
                            id: '{{ "event_2_" + crypto.randomUUID() }}',
                            type: 'second_event',
                            processed: true
                          }
                        ]
                      },
                      remove: ['original_data', 'unwanted_field']
                    }
                  }
                }
              }
            ]
          },
          upstreams: [{ target: 'http://mock-multi-event-test.com', weight: 100, priority: 1 }],
        }
      ]
    };

    // Mock fetch for multi-event test
    const originalFetch = global.fetch;
    global.fetch = mock(async () => {
      return new Response(JSON.stringify({
        original_data: 'test_data',
        unwanted_field: 'should_be_removed',
        keep_field: 'should_remain'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }) as any;

    const req = new Request('http://localhost/v1/multi-event-test', {
      method: 'POST',
      body: JSON.stringify({ test: 'data' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const response = await handleRequest(req, multiEventConfig);
    const responseBody = await response.json();

    // Restore original fetch
    global.fetch = originalFetch;

    // Should return an array of events
    expect(Array.isArray(responseBody)).toBe(true);
    expect(responseBody.length).toBe(2);

    // Verify first event
    expect(responseBody[0].id).toMatch(/^event_1_/);
    expect(responseBody[0].type).toBe('first_event');
    expect(responseBody[0].data).toBe('test_data');

    // Verify second event
    expect(responseBody[1].id).toMatch(/^event_2_/);
    expect(responseBody[1].type).toBe('second_event');
    expect(responseBody[1].processed).toBe(true);

    // Verify fields were properly removed/kept
    for (const event of responseBody) {
      expect(event).not.toHaveProperty('original_data');
      expect(event).not.toHaveProperty('unwanted_field');
    }
  });
});