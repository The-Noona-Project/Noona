import { extendTheme } from '@chakra-ui/react';
import tokens from '@oneui/tokens';

export const themeConfig = {
  initialColorMode: 'system',
  useSystemColorMode: true,
};

const brandPalette = tokens.palettes?.brand ?? {};
const neutralPalette = tokens.palettes?.neutral ?? {};
const bodyFont = tokens.font?.body ?? '"Noto Sans", "Inter", system-ui, sans-serif';

const theme = extendTheme({
  config: themeConfig,
  fonts: {
    heading: bodyFont,
    body: bodyFont,
  },
  colors: {
    brand: {
      50: brandPalette[50] ?? '#e6f5fa',
      100: brandPalette[100] ?? '#cceaf6',
      200: brandPalette[200] ?? '#99d5ed',
      300: brandPalette[300] ?? '#66c1e3',
      400: brandPalette[400] ?? '#33acda',
      500: brandPalette[500] ?? '#0097d1',
      600: brandPalette[600] ?? '#0079a7',
      700: brandPalette[700] ?? '#005b7d',
      800: brandPalette[800] ?? '#003c54',
      900: brandPalette[900] ?? '#001e2a',
    },
    gray: {
      50: neutralPalette[50] ?? '#ffffff',
      100: neutralPalette[100] ?? '#f1f5f9',
      200: neutralPalette[200] ?? '#e2e8f0',
      300: neutralPalette[300] ?? '#cbd5f5',
      400: neutralPalette[400] ?? '#94a3b8',
      500: neutralPalette[500] ?? '#64748b',
      600: neutralPalette[600] ?? '#475569',
      700: neutralPalette[700] ?? '#334155',
      800: neutralPalette[800] ?? '#1e293b',
      900: neutralPalette[900] ?? '#0f172a',
    },
  },
  styles: {
    global: {
      body: {
        bg: 'var(--color-background-neutral-subtlest-default, #f8fafc)',
        color: 'var(--color-text-subtle, #374151)',
      },
    },
  },
});

export default theme;
