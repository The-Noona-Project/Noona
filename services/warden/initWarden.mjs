// services/warden/initWarden.mjs
import { createWarden } from './shared/wardenCore.mjs';
import { errMSG } from '../../utilities/etc/logger.mjs';

const warden = createWarden();

process.on('SIGINT', () => {
    void warden.shutdownAll();
});

process.on('SIGTERM', () => {
    void warden.shutdownAll();
});

warden.init()
    .then(() => {
        setInterval(() => process.stdout.write('.'), 60000);
    })
    .catch(err => errMSG(`[Warden Init] ❌ Fatal: ${err.message}`));
