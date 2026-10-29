import { activeGroup, type Settings } from './settings';
import { isHomeTimeline, postAuthor, postCell } from './dom';

const HIDDEN = 'data-x-timeline-filter-hidden';
const STYLE_ID = 'x-timeline-filter-style';
const GATE_ID = 'x-timeline-filter-gate';
export const SCAN_BATCH_SIZE = 60;

export function installStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* X measures these absolute-positioned cells for its virtualized feed.
       Zero height makes it render and fetch an unbounded number of rows. */
    [${HIDDEN}="true"] {
      height: 24px !important;
      min-height: 24px !important;
      max-height: 24px !important;
      overflow: hidden !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    #${GATE_ID} {
      position: fixed; z-index: 100; bottom: 22px; left: 50%;
      transform: translateX(-50%);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      width: max-content; max-width: calc(100vw - 24px); padding: 12px 16px;
      border: 1px solid #d4d4d8; border-radius: 12px;
      background: #fff; color: #18181b; font: 13px/1.5 system-ui, sans-serif;
      box-shadow: 0 6px 24px #0002;
    }
    #${GATE_ID}[hidden] { display: none !important; }
    #${GATE_ID} button {
      width: 100%; padding: 8px 16px; border: 0; border-radius: 8px;
      background: #2563eb; color: #fff; font: 600 13px/1.4 system-ui, sans-serif;
      cursor: pointer;
    }
    #${GATE_ID} button:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; }
    @media (prefers-color-scheme: dark) {
      #${GATE_ID} { background: #18181b; color: #fafafa; border-color: #3f3f46; }
      #${GATE_ID} button { background: #3b82f6; }
    }
    @media (max-width: 650px) { #${GATE_ID} { bottom: calc(68px + env(safe-area-inset-bottom)); } }
  `;
  (doc.head ?? doc.documentElement).appendChild(style);
}

function timelinePosts(doc: Document): Element[] {
  // Use the home feed when X exposes it; avoid counting posts in other regions.
  const homeFeed = doc.querySelector('[aria-label="Timeline: Your Home Timeline"]');
  const root = homeFeed ?? doc.querySelector('[data-testid="primaryColumn"]') ?? doc;
  return [...root.querySelectorAll('article[data-testid="tweet"]')].filter(
    (article) => !article.parentElement?.closest('article[data-testid="tweet"]') && postCell(article),
  );
}

function postIdentity(article: Element): string | null {
  // X recycles DOM nodes on scroll: count post IDs, not cells or observer callbacks.
  for (const link of article.querySelectorAll('a[href]')) {
    if (link.closest('article[data-testid="tweet"]') !== article) continue;
    const match = /^\/[a-zA-Z0-9_]{1,15}\/status\/(\d+)(?:\/|\?|$)/.exec(link.getAttribute('href') ?? '');
    if (match) return `post:${match[1]}`;
  }
  // Fallback for rendered posts without a status link (e.g. certain reposts).
  const author = postAuthor(article);
  const body = article.textContent?.trim().slice(0, 200);
  return author && body ? `content:${author}:${body}` : null;
}

export function filterTimeline(doc: Document, pathname: string, settings: Settings): void {
  const enabled = settings.enabled && isHomeTimeline(pathname);
  const allowed = new Set(activeGroup(settings).accounts);
  const touched = new Set<HTMLElement>();
  if (enabled) {
    for (const article of timelinePosts(doc)) {
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
  const win = doc.defaultView;
  let queued = false;
  let previousPath = win?.location.pathname ?? '/';
  let context = '';
  let scanned = 0;
  let matched = 0;
  let paused = false;
  let scrollLimit = 0;
  const seen = new Set<string>();
  let gate: HTMLDivElement | undefined;

  const onScroll = () => {
    // X's timeline is window-scrolled. Prevent its virtualization end from
    // being reached repeatedly after the scan budget is exhausted.
    if (paused && win && win.scrollY > scrollLimit) win.scrollTo({ top: scrollLimit, behavior: 'instant' });
  };
  const onWheel = (event: WheelEvent) => {
    if (paused && win && event.deltaY > 0 && win.scrollY >= scrollLimit - 1) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (paused && win && win.scrollY >= scrollLimit - 1 &&
        ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key) &&
        !event.altKey && !event.ctrlKey && !event.metaKey &&
        !(event.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName))) {
      event.preventDefault();
    }
  };
  const reset = () => {
    seen.clear();
    scanned = 0;
    matched = 0;
    paused = false;
    if (gate) gate.hidden = true;
  };
  const ensureGate = () => {
    if (gate) return gate;
    gate = doc.createElement('div');
    gate.id = GATE_ID;
    gate.hidden = true;
    const info = doc.createElement('span');
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = 'さらに投稿を探す';
    button.addEventListener('click', () => {
      if (!paused) return;
      paused = false;
      gate!.hidden = true;
      // Continue from the native X scroll position, without touching its requests.
      win?.scrollBy({ top: Math.round((win?.innerHeight ?? 800) * 0.7), behavior: 'instant' });
      queue();
    });
    gate.append(info, button);
    (doc.body ?? doc.documentElement).append(gate);
    return gate;
  };
  const run = () => {
    queued = false;
    const pathname = win?.location.pathname ?? '/';
    const settings = getSettings();
    const enabled = settings.enabled && isHomeTimeline(pathname);
    const group = activeGroup(settings);
    const nextContext = enabled ? `${pathname}:${group.id}:${group.accounts.join(',')}` : '';
    if (nextContext !== context) {
      reset();
      context = nextContext;
    }
    filterTimeline(doc, pathname, settings);
    if (!enabled) return;
    if (!paused) {
      const allowed = new Set(group.accounts);
      for (const article of timelinePosts(doc)) {
        const key = postIdentity(article);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        scanned++;
        if (allowed.has(postAuthor(article) ?? '')) matched++;
        if (scanned % SCAN_BATCH_SIZE === 0) {
          paused = true;
          // Posts may already be mounted below the viewport. Keep the whole
          // inspected batch reachable before blocking further native scrolling.
          const currentY = win?.scrollY ?? 0;
          const lastBottom = postCell(article)?.getBoundingClientRect().bottom ?? 0;
          scrollLimit = Math.max(0, currentY, Math.ceil(currentY + lastBottom - (win?.innerHeight ?? 800) + 100));
          break;
        }
      }
    }
    if (paused) {
      const element = ensureGate();
      const info = element.firstElementChild!;
      const label = `${scanned}件確認 · ${matched}件表示`;
      if (info.textContent !== label) info.textContent = label;
      element.hidden = false;
      onScroll();
    }
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(run);
  };
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.type === 'childList' || m.type === 'characterData' || m.type === 'attributes')) queue();
  });
  observer.observe(doc.documentElement, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['href', 'data-testid'],
  });
  win?.addEventListener('scroll', onScroll, { passive: true });
  win?.addEventListener('wheel', onWheel, { passive: false, capture: true });
  win?.addEventListener('keydown', onKeyDown, { capture: true });
  const timer = setInterval(() => {
    const current = win?.location.pathname ?? '/';
    if (current !== previousPath) { previousPath = current; queue(); }
  }, 500);
  run();
  return {
    refresh: run,
    stop: () => {
      observer.disconnect();
      clearInterval(timer);
      win?.removeEventListener('scroll', onScroll);
      win?.removeEventListener('wheel', onWheel, true);
      win?.removeEventListener('keydown', onKeyDown, true);
      gate?.remove();
      gate = undefined;
      paused = false;
      filterTimeline(doc, '/', getSettings());
    },
  };
}
