import { describe, expect, it } from 'vitest';
import { isServiceRequired, mergeRequiredSelections } from './serviceSelection.js';

describe('serviceSelection utilities', () => {
  it('detects required services', () => {
    expect(isServiceRequired({ required: true })).toBe(true);
    expect(isServiceRequired({ required: false })).toBe(false);
    expect(isServiceRequired({})).toBe(false);
    expect(isServiceRequired(null)).toBe(false);
  });

  it('merges required services with previous selections', () => {
    const services = [
      { name: 'noona-redis', required: true },
      { name: 'noona-mongo', required: true },
      { name: 'noona-sage', required: false },
    ];

    expect(mergeRequiredSelections(services, [])).toEqual([
      'noona-redis',
      'noona-mongo',
    ]);

    expect(
      mergeRequiredSelections(services, ['noona-sage', 'noona-redis', 'noona-moon']),
    ).toEqual([
      'noona-redis',
      'noona-mongo',
      'noona-sage',
    ]);
  });

  it('filters installed or invalid services from selections', () => {
    const services = [
      { name: ' noona-redis ', required: true, installed: false },
      { name: 'noona-vault', required: true, installed: true },
      { name: 'noona-moon', required: false, installed: false },
    ];

    expect(mergeRequiredSelections(services, ['noona-vault', 'noona-moon'])).toEqual([
      'noona-redis',
      'noona-moon',
    ]);
  });
});
