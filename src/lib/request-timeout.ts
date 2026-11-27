// AbortController works on Safari versions that do not expose AbortSignal.timeout.
export async function withRequestTimeout<T>(
  action: (signal: AbortSignal) => Promise<T>,
  milliseconds: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try {
    return await action(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
