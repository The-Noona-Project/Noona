// Vuetify custom theme configuration
export default {
    defaultTheme: 'light',
    themes: {
        light: {
            dark: false,
            colors: {
                background: '#FFFFFF',
                surface: '#FFFFFF',
                primary: '#1976D2',
                secondary: '#424242',
                error: '#FF5252',
                info: '#2196F3',
                success: '#4CAF50',
                warning: '#FB8C00',
            },
        },
        dark: {
            dark: true,
            colors: {
                background: '#121212',
                surface: '#1E1E1E',
                primary: '#90CAF9',
                secondary: '#B0BEC5',
                error: '#EF9A9A',
                info: '#64B5F6',
                success: '#A5D6A7',
                warning: '#FFCC80',
            },
        },
    },
};
