export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message?: string) {
    super(message ?? `Request failed with status ${status}.`);
    this.name = "ApiError";
    this.status = status;
  }
}

type JsonBody = Record<string, unknown> | null | undefined;

export async function apiFetch<T>(
  path: string,
  options: { token: string; method?: string; body?: JsonBody },
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: unknown }).error)
        : undefined;
    throw new ApiError(response.status, message);
  }
  return data as T;
}