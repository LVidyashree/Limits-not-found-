// PLACEHOLDER — cloud sync is intentionally not wired up yet.
// The full implementation is pending approval of the Supabase
// backend integration plan. These stubs exist so the project
// continues to compile and run 100% offline.

export interface SyncResult {
  pushed: number;
  pulled: number;
  completedAt: string;
}

const notImplemented = (name: string): never => {
  throw new Error(`${name} is not implemented yet`);
};

export const syncAllData = async (): Promise<SyncResult> => notImplemented('syncAllData');

export const syncCases = async (): Promise<void> => notImplemented('syncCases');
export const syncEvidence = async (): Promise<void> => notImplemented('syncEvidence');
export const syncFindings = async (): Promise<void> => notImplemented('syncFindings');
export const syncTimelineEvents = async (): Promise<void> => notImplemented('syncTimelineEvents');

export const getLastSyncTimestamp = async (): Promise<string | null> => notImplemented('getLastSyncTimestamp');
export const setLastSyncTimestamp = async (): Promise<void> => notImplemented('setLastSyncTimestamp');

export const pushBackup = async (): Promise<void> => notImplemented('pushBackup');
export const pullBackup = async (): Promise<void> => notImplemented('pullBackup');
