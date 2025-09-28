// src/health-checker.ts

// This code runs in a separate worker thread.

interface ProbeRequest {
  target: string;
  retryableStatusCodes: number[];
  requestData: {
    url: string;
    method: string;
    headers: [string, string][];
    body: string | null;
  }
}

// Listen for messages from the main thread
self.onmessage = async (event: MessageEvent<ProbeRequest>) => {
  const { target, retryableStatusCodes, requestData } = event.data;

  try {
    // Reconstruct headers
    const headers = new Headers();
    for (const [key, value] of requestData.headers) {
      // Avoid headers that cause issues in fetch
      if (!['content-length', 'host'].includes(key.toLowerCase())) {
        headers.append(key, value);
      }
    }

    // Perform the probe request
    const response = await fetch(requestData.url, {
      method: requestData.method,
      headers: headers,
      body: requestData.body,
      redirect: 'manual',
    });

    // A recovery is successful if the status code is NOT one of the retryable codes.
    if (!retryableStatusCodes.includes(response.status)) {
      // If successful, send a recovery message back to the main thread
      self.postMessage({ status: 'recovered', target });
    }
  } catch (error) {
    // If the probe fails, do nothing. The upstream remains UNHEALTHY.
  }
};
