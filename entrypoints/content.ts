import { parseSettings, SETTINGS_KEY, loadSettings, type Settings } from '../src/settings';
import { MemberCapture } from '../src/list-capture';
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
    const collectMembers = () => memberCapture.update(document, location.pathname);
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
    chrome.runtime.onMessage.addListener((message: unknown, _sender, respond) => {
      if (!message || typeof message !== 'object' || (message as { type?: string }).type !== 'XTF_LIST_MEMBERS') return;
      const members = collectMembers();
      respond(members === null
        ? { ok: false, error: 'Xのリストのメンバー画面を開いてください。' }
        : { ok: true, accounts: members });
    });
    window.addEventListener('pagehide', () => {
      chrome.storage.onChanged.removeListener(onChange);
      memberObserver.disconnect();
      clearInterval(memberTimer);
      filter.stop();
    }, { once: true });
  },
});
