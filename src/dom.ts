import { normalizeHandle } from './settings';

// Accept bare profile links only, never status links or navigation paths.
export function handleFromProfileHref(href: string | null): string | null {
  if (!href) return null;
  const match = /^\/([a-zA-Z0-9_]{1,15})\/?(?:\?.*)?$/.exec(href);
  return match ? normalizeHandle(match[1]!) : null;
}

export function postAuthor(article: Element): string | null {
  const header = article.querySelector('[data-testid="User-Name"]');
  if (!header) return null;
  for (const link of header.querySelectorAll('a[href]')) {
    const handle = handleFromProfileHref(link.getAttribute('href'));
    if (handle) return handle;
  }
  return null;
}

export function postCell(article: Element): HTMLElement | null {
  const cell = article.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return null;
  // Allow quotes nested inside the outer post, but not unrelated sibling posts.
  if (cell.querySelector('article[data-testid="tweet"]') !== article) return null;
  return cell instanceof HTMLElement ? cell : null;
}

export function isHomeTimeline(pathname: string): boolean {
  return pathname === '/home' || pathname === '/home/';
}

// X uses a modal route for list members. Match the list ID, never unrelated
// "Who to follow" users in the background timeline or sidebar.
export function listIdFromMembersPath(pathname: string): string | null {
  return /^\/(?:i|[a-zA-Z0-9_]{1,15})\/lists\/(\d+)\/members\/?$/.exec(pathname)?.[1] ?? null;
}

export function listIdFromDetailPath(pathname: string): string | null {
  return /^\/(?:i|[a-zA-Z0-9_]{1,15})\/lists\/(\d+)\/?$/.exec(pathname)?.[1] ?? null;
}

export function listNameFromDetail(doc: Document): string | null {
  // Mobile X puts the list title outside primaryColumn; its own heading is just "List".
  // Only called on a list detail route, not on a timeline or members page.
  for (const heading of doc.querySelectorAll('h1, h2, [role="heading"]')) {
    const name = heading.textContent?.trim().replace(/\s+/g, ' ') ?? '';
    if (name && name.length <= 120 &&
        !/^(?:lists?|members?|list members|リスト|メンバー|posts?|ポスト)$/i.test(name) &&
        !/^(?:to view keyboard shortcuts|keyboard shortcuts)/i.test(name)) {
      return name.slice(0, 40);
    }
  }
  return null;
}

export function isMembersPage(pathname: string): boolean {
  return listIdFromMembersPath(pathname) !== null;
}

export function visibleListMembers(doc: Document, pathname: string): string[] | null {
  if (!isMembersPage(pathname)) return null;
  const dialog = [...doc.querySelectorAll('[role="dialog"]')].find(
    (node) => /(?:list members|members|メンバー|リストのメンバー)/i.test(
      node.querySelector('h1, h2, [role="heading"]')?.textContent ?? '',
    ),
  );
  // Mobile X renders a full-page <main role="main"> instead of a dialog or
  // primaryColumn. Check the heading before scanning to avoid sidebar users.
  const isMembersRoot = (root: Element | null): root is Element =>
    !!root && [...root.querySelectorAll('h1, h2, [role="heading"]')].some(
      (heading) => /^(?:list members|members|メンバー|リストのメンバー)$/i.test(heading.textContent?.trim() ?? ''),
    );
  const primaryColumn = doc.querySelector('[data-testid="primaryColumn"]');
  const main = doc.querySelector('main, [role="main"]');
  const root = dialog ?? (isMembersRoot(primaryColumn) ? primaryColumn : null)
    ?? (isMembersRoot(main) ? main : null);
  const handles = new Set<string>();
  for (const cell of root?.querySelectorAll('[data-testid="UserCell"]') ?? []) {
    for (const link of cell.querySelectorAll('a[href]')) {
      const handle = handleFromProfileHref(link.getAttribute('href'));
      if (handle) { handles.add(handle); break; }
    }
  }
  return [...handles];
}
