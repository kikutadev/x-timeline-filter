import { visibleListMembers, listIdFromMembersPath } from './dom';
import { normalizeHandle } from './settings';

export const LIST_CAPTURE_KEY = 'timelineFilterLastListCapture';

export interface ListCaptureSnapshot {
  listId: string;
  accounts: string[];
  updatedAt: number;
}

export function parseListCapture(value: unknown): ListCaptureSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ListCaptureSnapshot>;
  if (typeof record.listId !== 'string' || !/^\d+$/.test(record.listId) ||
      !Array.isArray(record.accounts) || !Number.isFinite(record.updatedAt) ||
      (record.updatedAt ?? 0) <= 0) return null;
  return {
    listId: record.listId,
    accounts: [...new Set(record.accounts.slice(0, 10000).map(
      (item) => typeof item === 'string' ? normalizeHandle(item) : null,
    ).filter((name): name is string => name !== null))],
    updatedAt: record.updatedAt!,
  };
}

// X virtualizes list rows: retain accounts already rendered during natural scrolling.
// A different list, or leaving its members view, ends the current capture session.
export class MemberCapture {
  private source = '';
  private handles = new Set<string>();

  update(doc: Document, pathname: string): { listId: string; accounts: string[] } | null {
    const listId = listIdFromMembersPath(pathname);
    if (!listId) {
      this.source = '';
      this.handles.clear();
      return null;
    }
    if (this.source !== listId) {
      this.source = listId;
      this.handles.clear();
    }
    const currentlyRendered = visibleListMembers(doc, pathname) ?? [];
    for (const handle of currentlyRendered) {
      if (this.handles.size >= 10000) break;
      this.handles.add(handle);
    }
    return { listId, accounts: [...this.handles] };
  }
}
