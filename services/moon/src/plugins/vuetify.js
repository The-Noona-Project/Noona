// src/plugins/vuetify.js

/**
 * Vuetify plugin setup for Noona Moon UI.
 * Sets up theming, icon sets, and default configuration for the entire Vue app.
 *
 * Vuetify Docs: https://next.vuetifyjs.com/en/getting-started/installation/
 */

import {createVuetify} from 'vuetify'
// Import base Vuetify styles (CSS resets, layout utilities, etc.)
import 'vuetify/styles'

// Import Material Design Icons (used with Vuetify's icon system)
import {aliases, mdi} from 'vuetify/iconsets/mdi'

/**
 * Vuetify instance with:
 * - Material Design Icons as the default icon set- * Support for both light and dark themes
 */
const vuetify = createVuetify({
    icons: {
        defaultSet: 'mdi', // Use MDI (Material Design Icons)
        aliases,
        sets: {mdi},
    },
    theme: {
        defaultTheme: 'light', // Initial theme
        themes: {
            light: {
                dark: false, // Indicates light theme
                colors: {
                    primary: '#1976D2',
                    secondary: '#424242',
                    accent: '#82B1FF',
                    error: '#FF5252',
                    info: '#2196F3',
                    success: '#4CAF50',
                    warning: '#FFC107',
                },
            },
            dark: {
                dark: true, // Enables Vuetify's dark mode
                colors: {
                    primary: '#2196F3',
                    secondary: '#424242',
                    accent: '#FF4081',
                    error: '#FF5252',
                    info: '#2196F3',
                    success: '#4CAF50',
                    warning: '#FFC107',
                },
            },
        },
    },
})

export default vuetify
