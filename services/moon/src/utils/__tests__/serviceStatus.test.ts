import { describe, expect, it } from 'vitest';

import {
  getInstalledStatusValues,
  normalizeServiceList,
  normalizeServiceEntry,
  resolveServiceInstalled,
} from '../../utils/serviceStatus.js';

describe('serviceStatus', () => {
  describe('resolveServiceInstalled', () => {
    it('returns true for explicit boolean true', () => {
      expect(resolveServiceInstalled({ installed: true })).toBe(true);
    });

    it('returns true for recognised status strings', () => {
      for (const value of getInstalledStatusValues()) {
        expect(resolveServiceInstalled({ status: value })).toBe(true);
        expect(resolveServiceInstalled({ installed: value.toUpperCase() })).toBe(true);
      }
    });

    it('returns false for unknown values', () => {
      expect(resolveServiceInstalled({ installed: 'pending' })).toBe(false);
      expect(resolveServiceInstalled({ status: 'waiting' })).toBe(false);
      expect(resolveServiceInstalled({})).toBe(false);
    });
  });

  describe('normalizeServiceEntry', () => {
    it('returns null for invalid entries', () => {
      expect(normalizeServiceEntry(null)).toBeNull();
      expect(normalizeServiceEntry({})).toBeNull();
      expect(normalizeServiceEntry({ name: '   ' })).toBeNull();
    });

    it('normalises name and installed flag', () => {
      expect(
        normalizeServiceEntry({ name: '  noona-raven  ', installed: 'ready' }),
      ).toEqual({ name: 'noona-raven', installed: true });
    });
  });

  describe('normalizeServiceList', () => {
    it('normalises services from payload shape', () => {
      const services = normalizeServiceList({
        services: [
          { name: 'noona-portal', installed: 'installed' },
          { name: '  noona-raven  ', status: 'running' },
          { name: 'invalid' },
        ],
      });

      expect(services).toEqual([
        { name: 'noona-portal', installed: true },
        { name: 'noona-raven', status: 'running', installed: true },
        { name: 'invalid', installed: false },
      ]);
    });

    it('accepts raw arrays', () => {
      const services = normalizeServiceList([
        { name: 'noona-redis', installed: false },
        { name: 'noona-mongo', status: 'complete' },
      ]);

      expect(services).toEqual([
        { name: 'noona-redis', installed: false },
        { name: 'noona-mongo', status: 'complete', installed: true },
      ]);
    });
  });
});
