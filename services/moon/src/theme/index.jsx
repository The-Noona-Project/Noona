import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { ChakraProvider, ColorModeScript, extendTheme, useColorMode } from '@chakra-ui/react';
import OneUI from '@textkernel/oneui';
import tokens from './tokens.js';

export const themeConfig = {
  initialColorMode: 'system',
  useSystemColorMode: true,
};

const brandPalette = tokens.palettes?.brand ?? {};
const neutralPalette = tokens.palettes?.neutral ?? {};
const bodyFont = tokens.font?.body ?? '"Noto Sans", "Inter", system-ui, sans-serif';

const AppTheme = extendTheme({
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

const BODY_CLASS = 'OneUI-body-text';
const SHELL_CLASS = 'oneui-app-shell';

const OneUIContext = createContext({
  colorMode: 'light',
  toggleColorMode: () => {},
  tokens,
});

const canUseDOM = () => typeof window !== 'undefined' && typeof document !== 'undefined';

function useOneUIBootstrap({
  themeURL,
  ponyfillOptions,
  maxThemeWait,
  disableThemeInjection,
}) {
  useEffect(() => {
    if (!canUseDOM()) {
      return undefined;
    }
    document.body.classList.add(BODY_CLASS);
    return () => {
      document.body.classList.remove(BODY_CLASS);
    };
  }, []);

  const ponyfillSignature = useMemo(
    () => (ponyfillOptions ? JSON.stringify(ponyfillOptions) : null),
    [ponyfillOptions],
  );

  useEffect(() => {
    if (!canUseDOM() || disableThemeInjection) {
      return undefined;
    }

    let isMounted = true;
    OneUI.init({
      themeURL,
      ponyfillOptions,
      maxTime: maxThemeWait,
    }).catch((error) => {
      if (isMounted) {
        console.warn('[OneUI] Failed to initialize theme', error);
      }
    });

    return () => {
      isMounted = false;
      if (typeof OneUI.removeThemeStyle === 'function') {
        OneUI.removeThemeStyle();
      }
    };
  }, [themeURL ?? null, maxThemeWait, disableThemeInjection, ponyfillSignature]);
}

function OneUIChakraBridge({ children }) {
  const { colorMode, toggleColorMode } = useColorMode();

  const contextValue = useMemo(
    () => ({
      colorMode,
      toggleColorMode,
      tokens,
    }),
    [colorMode, toggleColorMode],
  );

  useEffect(() => {
    if (!canUseDOM()) {
      return undefined;
    }
    document.documentElement.dataset.oneuiMode = colorMode;
    return undefined;
  }, [colorMode]);

  return (
    <OneUIContext.Provider value={contextValue}>
      <div className={`${SHELL_CLASS} ${SHELL_CLASS}--${colorMode}`} data-oneui-mode={colorMode}>
        {children}
      </div>
    </OneUIContext.Provider>
  );
}

export function OneUIProvider({
  children,
  themeURL,
  ponyfillOptions,
  maxThemeWait = 2000,
  disableThemeInjection = false,
}) {
  useOneUIBootstrap({ themeURL, ponyfillOptions, maxThemeWait, disableThemeInjection });

  return (
    <React.Fragment>
      <ColorModeScript initialColorMode={themeConfig.initialColorMode} />
      <ChakraProvider theme={AppTheme}>
        <OneUIChakraBridge>{children}</OneUIChakraBridge>
      </ChakraProvider>
    </React.Fragment>
  );
}

export function useOneUITheme() {
  return useContext(OneUIContext);
}

export { tokens as oneuiTokens };
export default AppTheme;
