// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeGroup, normalizeHandle, parseSettings } from '../src/settings';
import { handleFromProfileHref, listIdFromMembersPath, postAuthor, visibleListMembers } from '../src/dom';
import { filterTimeline } from '../src/filter';
import { MemberCapture, parseListCapture } from '../src/list-capture';

const settings = (enabled = true, handles = ['alice']) => {
  const value = parseSettings(null);
  value.enabled = enabled;
  value.groups[0]!.accounts = handles;
  return value;
};
const cell = (author: string, quote = '') =>
  `<div data-testid="cellInnerDiv"><article data-testid="tweet"><div data-testid="User-Name"><a href="/${author}">@${author}</a></div>${quote}</article></div>`;
const hidden = () => [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(
  (node) => node.getAttribute('data-x-timeline-filter-hidden') === 'true',
);

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('settings and author recognition', () => {
  it('starts disabled with a single empty local group', () => {
    const initial = parseSettings(null);
    expect(initial.enabled).toBe(false);
    expect(activeGroup(initial).accounts).toEqual([]);
  });
  it('normalizes unique handles and rejects arbitrary paths', () => {
    expect(normalizeHandle('@Alice_')).toBe('alice_');
    expect(normalizeHandle('https://x.com/alice')).toBe(null);
    expect(handleFromProfileHref('/alice/status/123')).toBe(null);
    expect(handleFromProfileHref('/alice')).toBe('alice');
    expect(parseSettings({ enabled: true, activeGroupId: 'x', groups: [
      { id: 'x', name: 'sample', accounts: ['@Alice', 'alice', '../escape', 'Bob'] },
    ] }).groups[0]!.accounts).toEqual(['alice', 'bob']);
  });
  it('finds the primary author, not the quote, retweeter or status link', () => {
    document.body.innerHTML = `<article data-testid="tweet">
      <a href="/retweeter">Retweeted</a>
      <div data-testid="User-Name"><a href="/Author">Author</a></div>
      <a href="/other/status/42">Status</a>
      <div data-testid="quoted"><a href="/quoted">Quote</a></div>
    </article>`;
    expect(postAuthor(document.querySelector('article')!)).toBe('author');
  });
});

describe('DOM filtering', () => {
  it('hides only non-allowed authors and restores when disabled', () => {
    document.body.innerHTML = cell('alice') + cell('bob');
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([false, true]);
    filterTimeline(document, '/home', settings(false));
    expect(hidden()).toEqual([false, false]);
  });
  it('does not act outside the home timeline', () => {
    document.body.innerHTML = cell('bob');
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([true]);
    filterTimeline(document, '/bob/status/1', settings());
    expect(hidden()).toEqual([false]);
  });
  it('reassesses recycled cells and newly loaded entries', () => {
    document.body.innerHTML = cell('bob');
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([true]);
    document.querySelector('[data-testid="User-Name"] a')!.setAttribute('href', '/alice');
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([false]);
    document.body.insertAdjacentHTML('beforeend', cell('charlie'));
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([false, true]);
  });
  it('uses the original author even for retweets with a nested quoted tweet', () => {
    const nestedQuote = '<article data-testid="tweet"><div data-testid="User-Name"><a href="/bob">Bob</a></div></article>';
    document.body.innerHTML = cell('alice', nestedQuote) + cell('bob');
    filterTimeline(document, '/home', settings(true, ['alice']));
    expect(hidden()).toEqual([false, true]);
  });
  it('does not leave an unknown post visible when strict filtering is on', () => {
    document.body.innerHTML = '<div data-testid="cellInnerDiv"><article data-testid="tweet"></article></div>';
    filterTimeline(document, '/home', settings());
    expect(hidden()).toEqual([true]);
  });
});

describe('X list member import', () => {
  it('reads only the rendered members in the member view', () => {
    document.body.innerHTML = `<div role="dialog"><h2>Members</h2>
      <div data-testid="UserCell"><a href="/Alice">Alice</a></div>
      <div data-testid="UserCell"><a href="/bob">Bob</a></div>
      <div data-testid="UserCell"><a href="/Alice">Alice</a></div>
    </div><div data-testid="UserCell"><a href="/outsider">Outsider</a></div>`;
    expect(visibleListMembers(document, '/i/lists/123/members')).toEqual(['alice', 'bob']);
    document.body.innerHTML = '<div data-testid="UserCell"><a href="/outsider">Outsider</a></div>';
    expect(visibleListMembers(document, '/home')).toBe(null);
    expect(visibleListMembers(document, '/i/lists/123/members')).toEqual([]);
  });
});


describe('member capture across natural scrolling', () => {
  it('accumulates mounted cells and clears when leaving the member view', () => {
    const capture = new MemberCapture();
    document.body.innerHTML = '<main data-testid="primaryColumn"><h2>List members</h2><div data-testid="UserCell"><a href="/alice">Alice</a></div></main>';
    expect(capture.update(document, '/i/lists/123/members')).toEqual({listId:'123',accounts:['alice']});
    document.body.innerHTML = '<main data-testid="primaryColumn"><h2>List members</h2><div data-testid="UserCell"><a href="/bob">Bob</a></div></main>';
    expect(capture.update(document, '/i/lists/123/members')).toEqual({listId:'123',accounts:['alice','bob']});
    expect(capture.update(document, '/home')).toBe(null);
    expect(capture.update(document, '/i/lists/123/members')).toEqual({listId:'123',accounts:['bob']});
    expect(capture.update(document, '/i/lists/456/members')).toEqual({listId:'456',accounts:['bob']});
  });
});

describe('capture storage input', () => {
  it('rejects unrelated or malformed stored snapshots', () => {
    expect(parseListCapture({listId:'../../evil',accounts:['alice'],updatedAt:1})).toBe(null);
    expect(parseListCapture({listId:'123',accounts:'alice',updatedAt:1})).toBe(null);
    expect(parseListCapture({listId:'123',accounts:['@Alice','ALICE','/bad'],updatedAt:12}))
      .toEqual({listId:'123',accounts:['alice'],updatedAt:12});
  });
});
