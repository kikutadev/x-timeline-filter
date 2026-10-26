import { parseSettings, SETTINGS_KEY, loadSettings, type Settings } from '../src/settings';
import { LIST_CAPTURE_KEY, MemberCapture, type ListCaptureSnapshot } from '../src/list-capture';
import { startFiltering } from '../src/filter';

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_end',
  async main() {
    let settings: Settings = parseSettings(null);
    try {
      settings = await loadSettings();
    } catch {
      // Storage unavailable: leave filtering disabled.
    }
    const filter = startFiltering(document, () => settings);
    const memberCapture = new MemberCapture();
    let lastScheduledId = '';
    let lastScheduledCount = -1;
    let lastScheduledName = '';
    let pending: ListCaptureSnapshot | null = null;
    let writeTimer: number | undefined;
    let writing = Promise.resolve();
    const flushMembers = () => {
      if (!pending) return;
      const snapshot = pending;
      pending = null;
      // Serialize writes so slow storage operations cannot overwrite newer scroll data.
      writing = writing.catch(() => {}).then(
        () => chrome.storage.local.set({ [LIST_CAPTURE_KEY]: snapshot }),
      );
      void writing.catch((err) => console.warn('X Timeline Filter: member capture could not be saved', err));
    };
    const collectMembers = () => {
      const snapshot = memberCapture.update(document, location.pathname);
      if (!snapshot) {
        lastScheduledId = '';
        lastScheduledCount = -1;
        lastScheduledName = '';
        return;
      }
      if (lastScheduledId === snapshot.listId && lastScheduledCount === snapshot.accounts.length && lastScheduledName === (snapshot.listName ?? '')) return;
      lastScheduledId = snapshot.listId;
      lastScheduledCount = snapshot.accounts.length;
      lastScheduledName = snapshot.listName ?? '';
      pending = { ...snapshot, updatedAt: Date.now() };
      if (writeTimer !== undefined) clearTimeout(writeTimer);
      writeTimer = window.setTimeout(flushMembers, 180);
    };
    const memberObserver = new MutationObserver(collectMembers);
    memberObserver.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    const memberTimer = window.setInterval(collectMembers, 750);
    collectMembers();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[SETTINGS_KEY]) return;
      settings = parseSettings(changes[SETTINGS_KEY].newValue);
      filter.refresh();
    };
    chrome.storage.onChanged.addListener(onChange);
    window.addEventListener('pagehide', () => {
      chrome.storage.onChanged.removeListener(onChange);
      memberObserver.disconnect();
      clearInterval(memberTimer);
      if (writeTimer !== undefined) clearTimeout(writeTimer);
      flushMembers();
      filter.stop();
    }, { once: true });
  },
});
