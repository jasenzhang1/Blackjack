import { handle } from './handler';
import type { WorkerIn, WorkerOut } from './protocol';

// Minimal typing of the dedicated-worker global (avoids pulling the WebWorker lib into a DOM program).
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerIn>) => void) | null;
  postMessage(m: WorkerOut): void;
};

ctx.onmessage = (e: MessageEvent<WorkerIn>) => {
  const { id, req } = e.data;
  const post = (m: WorkerOut) => ctx.postMessage(m);
  try {
    const data = handle(req, (done, total) => post({ id, kind: 'progress', done, total }));
    post({ id, kind: 'result', data });
  } catch (err) {
    post({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
