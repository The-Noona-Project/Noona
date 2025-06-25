// services/moon/src/plugins/vuetify.js

// ─────────────────────────────────────────────
// Vuetify Plugin Setup for Noona Moon
// This plugin creates and exports the Vuetify instance.
// ─────────────────────────────────────────────

import 'vuetify/styles' // Global Vuetify CSS
import {createVuetify} from 'vuetify'
import {aliases, mdi} from 'vuetify/iconsets/mdi' // Material Design Icons

// Theme definition (can expand to support light/dark themes)
const customTheme = {
    dark: false,
    colors: {
        primary: '#42A5F5',
        secondary: '#7E57C2',
        accent: '#FF4081',
        error: '#FF5252',
        info: '#2196F3',
        success: '#4CAF50',
        warning: '#FFC107',
    },
}

// Vuetify instance setup
const vuetify = createVuetify({
    theme: {
        defaultTheme: 'customTheme',
        themes: {
            customTheme,
        },
    },
    icons: {
        defaultSet: 'mdi',
        aliases,
        sets: {
            mdi,
        },
    },
})

export default vuetify
