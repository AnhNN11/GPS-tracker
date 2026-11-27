/** Polls share one request. Writes invalidate its result and queue one fresh read. */
export function createStateRefresh<T>(options: {
  load: () => Promise<T>;
  apply: (value: T) => void;
  onError: (error: unknown) => void;
}) {
  let epoch = 0;
  let revision = 0;
  let queued = false;
  let running: Promise<void> | null = null;

  async function drain() {
    do {
      queued = false;
      const requestEpoch = epoch,
        requestRevision = revision;
      try {
        const value = await options.load();
        if (requestEpoch === epoch && requestRevision === revision)
          options.apply(value);
      } catch (error) {
        if (requestEpoch === epoch && requestRevision === revision)
          options.onError(error);
      }
    } while (queued);
  }

  function request(force = false): Promise<void> {
    if (running) {
      if (force) {
        revision++;
        queued = true;
      }
      return running;
    }
    running = drain().finally(() => {
      running = null;
      // A write may arrive after drain finishes but before this microtask.
      if (queued) {
        queued = false;
        return request();
      }
    });
    return running;
  }
  return {
    request,
    invalidate() {
      epoch++;
      revision++;
      queued = false;
    },
  };
}
