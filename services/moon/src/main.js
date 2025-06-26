import {createApp} from 'vue';
import App from './App.vue';

// Vuetify
import 'vuetify/styles';
import {createVuetify} from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

// Router
import router from './router';

// Custom Vuetify setup
import vuetifyTheme from './plugins/vuetify';

const vuetify = createVuetify({
    components,
    directives,
    theme: vuetifyTheme,
});

createApp(App)
    .use(router)
    .use(vuetify)
    .mount('#app');
