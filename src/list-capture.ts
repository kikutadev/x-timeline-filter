import { visibleListMembers } from './dom';

// Collect only the members X has already rendered while the user scrolls.
// This cache is tab-memory only; it resets on leaving the members view.
export class MemberCapture {
  private source = '';
  private handles = new Set<string>();

  update(doc: Document, pathname: string): string[] | null {
    const currentlyRendered = visibleListMembers(doc, pathname);
    if (currentlyRendered === null) {
      this.source = '';
      this.handles.clear();
      return null;
    }
    if (this.source !== pathname) {
      this.source = pathname;
      this.handles.clear();
    }
    for (const handle of currentlyRendered) {
      if (this.handles.size >= 10000) break;
      this.handles.add(handle);
    }
    return [...this.handles];
  }
}
