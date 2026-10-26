// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activeGroup, normalizeHandle, parseSettings } from '../src/settings';
import { handleFromProfileHref, listIdFromDetailPath, listIdFromMembersPath, listNameFromDetail, postAuthor, visibleListMembers } from '../src/dom';
import { filterTimeline } from '../src/filter';
import { MemberCapture, parseListCapture, importListAsGroup, listGroupId } from '../src/list-capture';

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
  it('finds mobile X full-page list members in main, ignoring sidebar users', () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><div data-testid="UserCell"><a href="/suggestion">Not a member</a></div></div>
      <main role="main"><h2>List members</h2><section role="region">
        <div data-testid="cellInnerDiv"><button data-testid="UserCell"><a href="/One">One</a></button></div>
        <div data-testid="cellInnerDiv"><button data-testid="UserCell"><a href="/Two">Two</a></button></div>
      </section></main>`;
    expect(visibleListMembers(document, '/i/lists/205877981/members')).toEqual(['one', 'two']);
    expect(visibleListMembers(document, '/home')).toBe(null);
    document.querySelector('main h2')!.textContent = 'Your Home Timeline';
    expect(visibleListMembers(document, '/i/lists/205877981/members')).toEqual([]);
  });
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
  it('records the X list name on its detail screen before members', () => {
    const capture = new MemberCapture();
    document.body.innerHTML = '<h2>To view keyboard shortcuts, press question mark</h2><h2>Weather</h2><main role="main"><h1>List</h1></main>';
    expect(listIdFromDetailPath('/i/lists/123')).toBe('123');
    expect(listIdFromDetailPath('/i/lists/123/members')).toBe(null);
    expect(listNameFromDetail(document)).toBe('Weather');
    expect(capture.update(document, '/i/lists/123')).toBe(null);
    document.body.innerHTML = '<main role="main"><h2>List members</h2><div data-testid="UserCell"><a href="/bob">Bob</a></div></main>';
    expect(capture.update(document, '/i/lists/123/members')).toEqual({listId:'123',listName:'Weather',accounts:['bob']});
    expect(capture.update(document, '/i/lists/456/members')).toEqual({listId:'456',accounts:['bob']});
  });
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

describe('import X list as a standalone group', () => {
  it('creates a named group without mixing into the manual group, then updates by list ID', () => {
    const settings = parseSettings(null);
    settings.groups[0]!.accounts = ['alice'];
    const first = {listId:'123',listName:'Weather',accounts:['bob','charlie'],updatedAt:1};
    expect(importListAsGroup(settings, first)).toEqual({name:'Weather',added:2,created:true});
    expect(settings.activeGroupId).toBe(listGroupId('123'));
    expect(settings.groups[0]!.accounts).toEqual(['alice']);
    expect(settings.groups).toHaveLength(2);
    expect(importListAsGroup(settings, {...first,accounts:['bob','delta']})).toEqual({name:'Weather',added:1,created:false});
    expect(settings.groups).toHaveLength(2);
    expect(settings.groups[1]!.accounts).toEqual(['bob','charlie','delta']);
  });
  it('creates a fallback group for direct member links and leaves another list alone', () => {
    const settings = parseSettings(null);
    expect(importListAsGroup(settings,{listId:'456',accounts:['alice'],updatedAt:1})).toEqual({name:'Xリスト 456',added:1,created:true});
    expect(importListAsGroup(settings,{listId:'789',accounts:['bob'],updatedAt:2})?.created).toBe(true);
    expect(settings.groups.map(g=>g.accounts)).toEqual([[],['alice'],['bob']]);
  });
  it('rejects adding the 101st group without corrupting other groups', () => {
    const settings = parseSettings(null);
    for (let i=0; i<99; i++) settings.groups.push({id:`g${i}`,name:`Group ${i}`,accounts:[]});
    expect(importListAsGroup(settings,{listId:'77',accounts:['alice'],updatedAt:1})).toBe(null);
    expect(settings.groups).toHaveLength(100);
  });
});
