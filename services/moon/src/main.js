// 🌕 Noona Moon — Main Entry
// Mounts Vuetify, Router, and Root App

import {createApp} from 'vue'
import App from './App.vue'
import './style.css'

// Vuetify plugin
import vuetify from './plugins/vuetify'

// Router setup
import router from './router/index.js'

// Create and mount app
createApp(App)
    .use(vuetify)
    .use(router)
    .mount('#app')
