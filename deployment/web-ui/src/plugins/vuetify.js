import 'vuetify/styles';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme: 'noonaDark',
    themes: {
      noonaDark: {
        dark: true,
        colors: {
          background: '#0f172a',
          surface: '#111827',
          primary: '#4f46e5',
          secondary: '#14b8a6',
          accent: '#f97316'
        }
      }
    }
  }
});

export default vuetify;
