import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

let focusImpl: () => void = () => {
  /* noop for jsdom */
};

try {
  Object.defineProperty(HTMLElement.prototype, 'focus', {
    configurable: true,
    get() {
      return focusImpl;
    },
    set(value) {
      if (typeof value === 'function') {
        focusImpl = value as () => void;
      }
    },
  });
} catch (error) {
  // ignore - jsdom may already expose a writable focus implementation
}
