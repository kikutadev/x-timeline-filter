export interface Group { id: string; name: string; accounts: string[] }
export interface Settings { enabled: boolean; activeGroupId: string; groups: Group[] }

export const SETTINGS_KEY = 'timelineFilterSettings';
export const DEFAULT_SETTINGS: Settings = {
  enabled: false,
  activeGroupId: 'default',
  groups: [{ id: 'default', name: 'マイリスト', accounts: [] }],
};

export function normalizeHandle(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, '');
  return /^[a-zA-Z0-9_]{1,15}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function uniqueHandles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.slice(0, 10000).map(
    (item) => typeof item === 'string' ? normalizeHandle(item) : null,
  ).filter((handle): handle is string => handle !== null))];
}

export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return structuredClone(DEFAULT_SETTINGS);
  const value = raw as Partial<Settings>;
  const groups: Group[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.groups)) {
    for (const group of value.groups.slice(0, 100)) {
      if (!group || typeof group !== 'object') continue;
      const id = typeof group.id === 'string' ? group.id : '';
      const name = typeof group.name === 'string' ? group.name.trim().slice(0, 40) : '';
      if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || seen.has(id) || !name) continue;
      seen.add(id);
      groups.push({ id, name, accounts: uniqueHandles(group.accounts) });
    }
  }
  if (!groups.length) return structuredClone(DEFAULT_SETTINGS);
  const activeGroupId = groups.some((group) => group.id === value.activeGroupId)
    ? value.activeGroupId as string : groups[0]!.id;
  return { enabled: value.enabled === true, activeGroupId, groups };
}

export function activeGroup(settings: Settings): Group {
  return settings.groups.find((group) => group.id === settings.activeGroupId) ?? settings.groups[0]!;
}

export async function loadSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return parseSettings(result[SETTINGS_KEY]);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: parseSettings(settings) });
}
