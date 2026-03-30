import axios, { AxiosInstance, isAxiosError } from 'axios';

const UE5_BASE = process.env.UE5_RC_URL ?? 'http://127.0.0.1:30010';

const client: AxiosInstance = axios.create({
  baseURL: UE5_BASE,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach optional shared secret header on every request
client.interceptors.request.use((config) => {
  const secret = process.env.MCP_SECRET;
  if (secret) {
    config.headers['X-MCP-Secret'] = secret;
  }
  return config;
});

function extractErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data;
    if (data && typeof data === 'object' && 'error' in data) {
      return String((data as Record<string, unknown>)['error']);
    }
    if (data && typeof data === 'string') return data;
    return err.message;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

export async function rcGet<T>(path: string): Promise<T> {
  try {
    const { data } = await client.get<T>(path);
    return data;
  } catch (err) {
    throw new Error(`UE5 GET ${path} failed: ${extractErrorMessage(err)}`);
  }
}

export async function rcPost<T>(path: string, body: unknown): Promise<T> {
  try {
    const { data } = await client.post<T>(path, body);
    return data;
  } catch (err) {
    throw new Error(`UE5 POST ${path} failed: ${extractErrorMessage(err)}`);
  }
}

export async function rcPut<T>(path: string, body: unknown): Promise<T> {
  try {
    const { data } = await client.put<T>(path, body);
    return data;
  } catch (err) {
    throw new Error(`UE5 PUT ${path} failed: ${extractErrorMessage(err)}`);
  }
}

export function getBaseUrl(): string {
  return UE5_BASE;
}
