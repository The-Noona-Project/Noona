import { extendTheme } from '@chakra-ui/react';

export const themeConfig = {
  initialColorMode: 'system',
  useSystemColorMode: true,
};

const theme = extendTheme({ config: themeConfig });

export default theme;
