import { activeGroup, type Settings } from './settings';
import { isHomeTimeline, postAuthor, postCell } from './dom';

const HIDDEN = 'data-x-timeline-filter-hidden';
const STYLE_ID = 'x-timeline-filter-style';

export function installStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `[${HIDDEN}="true"] { display: none !important; }`;
  (doc.head ?? doc.documentElement).appendChild(style);
}

export function filterTimeline(doc: Document, pathname: string, settings: Settings): void {
  const enabled = settings.enabled && isHomeTimeline(pathname);
  const allowed = new Set(activeGroup(settings).accounts);
  const touched = new Set<HTMLElement>();
  if (enabled) {
    for (const article of doc.querySelectorAll('article[data-testid="tweet"]')) {
      // A quote inside a post is not a separate timeline entry.
      if (article.parentElement?.closest('article[data-testid="tweet"]')) continue;
      const cell = postCell(article);
      if (!cell) continue;
      const author = postAuthor(article);
      touched.add(cell);
      // An unidentified post is not on the allowlist.
      if (!author || !allowed.has(author)) cell.setAttribute(HIDDEN, 'true');
      else cell.removeAttribute(HIDDEN);
    }
  }
  // Restore cells recycled by X, on navigation, or after disabling the filter.
  for (const cell of doc.querySelectorAll<HTMLElement>(`[${HIDDEN}="true"]`)) {
    if (!touched.has(cell)) cell.removeAttribute(HIDDEN);
  }
}

export function startFiltering(doc: Document, getSettings: () => Settings): { refresh: () => void; stop: () => void } {
  installStyle(doc);
  let queued = false;
  let previousPath = doc.defaultView?.location.pathname ?? '/';
  const run = () => {
    queued = false;
    filterTimeline(doc, doc.defaultView?.location.pathname ?? '/', getSettings());
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(run);
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.type === 'childList' || m.type === 'characterData' || m.type === 'attributes')) queue();
  });
  observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  const timer = setInterval(() => {
    const current = doc.defaultView?.location.pathname ?? '/';
    if (current !== previousPath) { previousPath = current; queue(); }
  }, 500);
  run();
  return {
    refresh: run,
    stop: () => { observer.disconnect(); clearInterval(timer); filterTimeline(doc, '/', getSettings()); },
  };
}
