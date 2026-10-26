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

export function isMembersPage(pathname: string): boolean {
  return /^\/i\/lists\/\d+\/members\/?$/.test(pathname);
}

export function visibleListMembers(doc: Document, pathname: string): string[] | null {
  const dialog = [...doc.querySelectorAll('[role="dialog"]')].find(
    (node) => /(?:Members|メンバー|リストのメンバー)/i.test(
      node.querySelector('h1, h2, [role="heading"]')?.textContent ?? '',
    ),
  );
  const root = dialog ?? (isMembersPage(pathname) ? doc : null);
  if (!root) return null;
  const handles = new Set<string>();
  for (const cell of root.querySelectorAll('[data-testid="UserCell"]')) {
    for (const link of cell.querySelectorAll('a[href]')) {
      const handle = handleFromProfileHref(link.getAttribute('href'));
      if (handle) { handles.add(handle); break; }
    }
  }
  return [...handles];
}
