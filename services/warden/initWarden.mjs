// services/warden/initWarden.mjs
import { createWarden } from './shared/wardenCore.mjs';
import { startWardenServer } from './shared/wardenServer.mjs';
import { errMSG } from '../../utilities/etc/logger.mjs';

const warden = createWarden();
const apiPort = Number.parseInt(process.env.WARDEN_API_PORT ?? '4001', 10);
const { server: apiServer } = startWardenServer({ warden, port: apiPort });

const closeApiServer = () => {
    if (apiServer.listening) {
        apiServer.close();
    }
};

process.on('SIGINT', () => {
    closeApiServer();
    void warden.shutdownAll();
});

process.on('SIGTERM', () => {
    closeApiServer();
    void warden.shutdownAll();
});

warden.init()
    .then(() => {
        setInterval(() => process.stdout.write('.'), 60000);
    })
    .catch(err => errMSG(`[Warden Init] ❌ Fatal: ${err.message}`));
