import {
  collection, doc, onSnapshot, serverTimestamp, setDoc, type Firestore,
} from 'firebase/firestore';

const ADMIN_TASK_TIMEOUT_MS = 20000;

export interface AdminTaskResult {
  status: 'completed' | 'failed';
  error?: string;
}

// Creates an `adminTasks` doc and waits for the Cloud Function trigger
// (onAdminTaskCreated, functions/src/index.ts) to process it. Admin actions
// that must reverse derived stats (currently just resetting a match result)
// go through this Firestore-triggered task instead of a callable function —
// see that file's comment on performMatchResultReset for why onCall isn't
// usable here. Resolves once the task reaches 'completed' or 'failed', or
// rejects if nothing happens within the timeout (the trigger never ran, or
// is still cold-starting).
export function runAdminTask(
  db: Firestore,
  type: string,
  data: Record<string, unknown>,
  requestedBy: string,
): Promise<AdminTaskResult> {
  const taskRef = doc(collection(db, 'adminTasks'));

  return new Promise((resolve, reject) => {
    let unsubscribe: (() => void) | null = null;

    const timeout = setTimeout(() => {
      unsubscribe?.();
      reject(new Error('Timed out waiting for the admin task to complete. Please try again.'));
    }, ADMIN_TASK_TIMEOUT_MS);

    unsubscribe = onSnapshot(taskRef, (snap) => {
      const status = snap.data()?.status as string | undefined;
      if (status === 'completed' || status === 'failed') {
        clearTimeout(timeout);
        unsubscribe?.();
        resolve({ status, error: snap.data()?.error as string | undefined });
      }
    }, (err) => {
      clearTimeout(timeout);
      unsubscribe?.();
      reject(err);
    });

    setDoc(taskRef, {
      type, ...data, requestedBy, status: 'pending', createdAt: serverTimestamp(),
    }).catch((err) => {
      clearTimeout(timeout);
      unsubscribe?.();
      reject(err);
    });
  });
}
