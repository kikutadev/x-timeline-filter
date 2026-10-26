import { visibleListMembers, listIdFromMembersPath, listIdFromDetailPath, listNameFromDetail } from './dom';
import { normalizeHandle, type Settings } from './settings';

export const LIST_CAPTURE_KEY = 'timelineFilterLastListCapture';

export interface ListCaptureSnapshot {
  listId: string;
  listName?: string;
  accounts: string[];
  updatedAt: number;
}

export function parseListCapture(value: unknown): ListCaptureSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<ListCaptureSnapshot>;
  if (typeof record.listId !== 'string' || !/^\d{1,24}$/.test(record.listId) ||
      !Array.isArray(record.accounts) || !Number.isFinite(record.updatedAt) ||
      (record.updatedAt ?? 0) <= 0) return null;
  return {
    listId: record.listId,
    ...(typeof record.listName === 'string' && record.listName.trim() ? { listName: record.listName.trim().slice(0, 40) } : {}),
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
  private lastList: { id: string; name: string } | null = null;

  update(doc: Document, pathname: string): { listId: string; listName?: string; accounts: string[] } | null {
    const detailId = listIdFromDetailPath(pathname);
    if (detailId) {
      const name = listNameFromDetail(doc);
      if (name) this.lastList = { id: detailId, name };
    }
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
    return { listId, ...(this.lastList?.id === listId ? { listName: this.lastList.name } : {}), accounts: [...this.handles] };
  }
}

// Stable X list identity prevents duplicate groups on repeated imports.
export function listGroupId(listId: string): string {
  return `x-list-${listId}`;
}

export function importListAsGroup(settings: Settings, capture: ListCaptureSnapshot): { name: string; added: number; created: boolean } | null {
  const id = listGroupId(capture.listId);
  let group = settings.groups.find((candidate) => candidate.id === id);
  const created = !group;
  if (!group) {
    if (settings.groups.length >= 100) return null;
    group = { id, name: capture.listName ?? `Xリスト ${capture.listId}`, accounts: [] };
    settings.groups.push(group);
  } else if (capture.listName) {
    group.name = capture.listName;
  }
  const before = group.accounts.length;
  group.accounts = [...new Set([...group.accounts, ...capture.accounts])].slice(0, 10000);
  settings.activeGroupId = id;
  return { name: group.name, added: group.accounts.length - before, created };
}
