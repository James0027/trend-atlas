/** Bound cloud-service requests while preserving caller cancellation. */
export const boundedFetch: typeof fetch = (input, init) => {
  const signals = [AbortSignal.timeout(10_000)];
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return fetch(input, { ...init, signal: AbortSignal.any(signals) });
};
