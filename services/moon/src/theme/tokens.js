export const font = {
  body:
    'var(--font-family-primary, "Noto Sans", "Inter", "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif)',
  monospace: 'var(--font-family-monospace, "JetBrains Mono", "Fira Code", monospace)',
};

export const colors = {
  background: 'var(--color-background, #ffffff)',
  surface: 'var(--color-background-neutral-subtlest-default, var(--color-background, #ffffff))',
  surfaceMuted: 'var(--color-background-neutral-subtle-default, #f2f4f7)',
  text: 'var(--color-text-bold, #1f2328)',
  textMuted: 'var(--color-text-subtle, #4b5563)',
  textSubtlest: 'var(--color-text-subtlest, #6b7280)',
  border: 'var(--color-border-subtle, #d0d5dd)',
  borderBold: 'var(--color-border-bold, #98a2b3)',
  brand: 'var(--color-brand-50, #0097d1)',
  brandMuted: 'var(--color-brand-20, #99d5ed)',
  success: 'var(--color-success-50, #34c759)',
  warning: 'var(--color-cautious-50, #ffcc01)',
  critical: 'var(--color-critical-50, #ff3b2f)',
};

export const palettes = {
  brand: {
    50: 'var(--color-brand-5, #e6f5fa)',
    100: 'var(--color-brand-10, #cceaf6)',
    200: 'var(--color-brand-20, #99d5ed)',
    300: 'var(--color-brand-30, #66c1e3)',
    400: 'var(--color-brand-40, #33acda)',
    500: 'var(--color-brand-50, #0097d1)',
    600: 'var(--color-brand-60, #0079a7)',
    700: 'var(--color-brand-70, #005b7d)',
    800: 'var(--color-brand-80, #003c54)',
    900: 'var(--color-brand-90, #001e2a)',
  },
  neutral: {
    50: 'var(--color-neutral-0, #ffffff)',
    100: 'var(--color-neutral-10, #e6e6e6)',
    200: 'var(--color-neutral-20, #cccccc)',
    300: 'var(--color-neutral-30, #b3b3b3)',
    400: 'var(--color-neutral-40, #999999)',
    500: 'var(--color-neutral-50, #808080)',
    600: 'var(--color-neutral-60, #666666)',
    700: 'var(--color-neutral-70, #4d4d4d)',
    800: 'var(--color-neutral-80, #333333)',
    900: 'var(--color-neutral-90, #1a1a1a)',
  },
};

export const spacing = {
  xs: 'var(--space-50, 4px)',
  sm: 'var(--space-75, 6px)',
  md: 'var(--space-100, 8px)',
  lg: 'var(--space-150, 12px)',
  xl: 'var(--space-200, 16px)',
  xxl: 'var(--space-300, 24px)',
};

export const radii = {
  sm: 'var(--space-75, 6px)',
  md: 'var(--space-100, 8px)',
  lg: 'var(--space-150, 12px)',
  full: '999px',
};

const tokens = { colors, spacing, radii, font, palettes };

export default tokens;
