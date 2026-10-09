import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD, buildUrl, indexFromHash, parseWorld, resolveStart } from '../src/core/router';

const IDS = ['ivory', 'moss', 'poppy'];

describe('resolveStart', () => {
  it('?world= wins over the remembered world, which wins over the default', () => {
    expect(resolveStart('?world=water', '', IDS, 'light').world).toBe('water');
    expect(resolveStart('', '', IDS, 'water').world).toBe('water');
    expect(resolveStart('', '', IDS, null).world).toBe(DEFAULT_WORLD);
    expect(resolveStart('?world=nope', '', IDS, 'bogus').world).toBe(DEFAULT_WORLD);
  });
  it('a product hash opens that detail, an unknown or empty hash does not', () => {
    expect(resolveStart('', '#poppy', IDS, null).detail).toBe(2);
    expect(resolveStart('', '#nope', IDS, null).detail).toBe(-1);
    expect(resolveStart('', '', IDS, null).detail).toBe(-1);
    expect(resolveStart('', '#', IDS, null).detail).toBe(-1);
  });
  it('world and detail are independent: a deep link keeps the chosen world for the way back', () => {
    expect(resolveStart('?set=mixed&world=water', '#moss', IDS, null)).toEqual({ world: 'water', detail: 1 });
  });
});

describe('buildUrl', () => {
  const loc = { pathname: '/bonnet/', search: '?set=mixed&debug', hash: '' };
  it('sets the world without losing other params', () => {
    expect(buildUrl(loc, { world: 'water' })).toBe('/bonnet/?set=mixed&debug=&world=water');
  });
  it('sets and clears the product hash', () => {
    expect(buildUrl(loc, { id: 'moss' })).toBe('/bonnet/?set=mixed&debug=#moss');
    expect(buildUrl({ ...loc, hash: '#moss' }, { id: null })).toBe('/bonnet/?set=mixed&debug=');
  });
  it('leaves the hash alone when id is not given', () => {
    expect(buildUrl({ ...loc, hash: '#moss' }, { world: 'light' })).toBe('/bonnet/?set=mixed&debug=&world=light#moss');
  });
  it('replaces an existing world', () => {
    expect(buildUrl({ pathname: '/bonnet/', search: '?world=light', hash: '' }, { world: 'water' })).toBe('/bonnet/?world=water');
  });
});

describe('small helpers', () => {
  it('parseWorld', () => {
    expect(parseWorld('light')).toBe('light');
    expect(parseWorld('water')).toBe('water');
    expect(parseWorld('x')).toBeNull();
    expect(parseWorld(null)).toBeNull();
  });
  it('indexFromHash', () => {
    expect(indexFromHash('#moss', IDS)).toBe(1);
    expect(indexFromHash('moss', IDS)).toBe(1);
  });
});
