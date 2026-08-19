import { describe, it, expect } from 'vitest';
import { SESSION_ROLE, isViewerRoute, roleFromLocation } from './sessionRole.js';

describe('isViewerRoute', () => {
  it('recognises the view route in a hash', () => {
    expect(isViewerRoute('#/view/p1/w1')).toBe(true);
    expect(isViewerRoute('#/view/p1')).toBe(true);
    expect(isViewerRoute('#/view')).toBe(true);
    expect(isViewerRoute('#/view/')).toBe(true);
  });

  it('recognises the view route without the hash', () => {
    expect(isViewerRoute('/view/p1/w1')).toBe(true);
    expect(isViewerRoute('view/p1/w1')).toBe(true);
  });

  it('does not mistake the editor route for a viewer route', () => {
    expect(isViewerRoute('#/editor/p1/w1')).toBe(false);
    expect(isViewerRoute('/editor/p1/w1')).toBe(false);
    expect(isViewerRoute('#/')).toBe(false);
    expect(isViewerRoute('')).toBe(false);
  });

  it('does not match a word that merely starts with "view"', () => {
    expect(isViewerRoute('#/viewer/p1')).toBe(false);
    expect(isViewerRoute('#/viewport')).toBe(false);
    expect(isViewerRoute('#/editor/view/p1')).toBe(false); // view is not the first segment
  });

  it('survives rubbish input', () => {
    expect(isViewerRoute(null)).toBe(false);
    expect(isViewerRoute(undefined)).toBe(false);
    expect(isViewerRoute(42)).toBe(false);
    expect(isViewerRoute({})).toBe(false);
  });
});

describe('roleFromLocation', () => {
  it('says viewer for a view hash', () => {
    expect(roleFromLocation({ hash: '#/view/p1/w1' })).toBe(SESSION_ROLE.VIEWER);
  });

  it('says viewer when the route is in the pathname instead', () => {
    expect(roleFromLocation({ pathname: '/view/p1/w1' })).toBe(SESSION_ROLE.VIEWER);
  });

  it('says editor for the editor route', () => {
    expect(roleFromLocation({ hash: '#/editor/p1/w1' })).toBe(SESSION_ROLE.EDITOR);
  });

  it('DEFAULTS TO EDITOR when it cannot tell', () => {
    // Deliberate: this predicate only adds a restriction. Defaulting to viewer
    // would let a parsing quirk stop the real editor from saving, which is worse
    // than the leak being prevented.
    expect(roleFromLocation({})).toBe(SESSION_ROLE.EDITOR);
    expect(roleFromLocation(null)).toBe(SESSION_ROLE.EDITOR);
    expect(roleFromLocation(undefined)).toBe(SESSION_ROLE.EDITOR);
    expect(roleFromLocation({ hash: 'nonsense' })).toBe(SESSION_ROLE.EDITOR);
  });

  it('does not throw when reading the location blows up', () => {
    const hostile = { get hash() { throw new Error('no'); } };
    expect(roleFromLocation(hostile)).toBe(SESSION_ROLE.EDITOR);
  });
});
