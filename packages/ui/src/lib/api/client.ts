const API_BASE = '/__ui/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    },
    ...options
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: any) => request<T>(path, {
    method: 'POST',
    body: JSON.stringify(data)
  }),
  put: <T>(path: string, data: any) => request<T>(path, {
    method: 'PUT',
    body: JSON.stringify(data)
  }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};
