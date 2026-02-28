// services/vault/app/defaultHandlePacket.mjs

let cachedHandlePacket = null;

export async function getDefaultHandlePacket() {
    if (!cachedHandlePacket) {
        const module = await import('../../../utilities/database/packetParser.mjs');
        cachedHandlePacket = module.handlePacket;
    }

    return cachedHandlePacket;
}

export default getDefaultHandlePacket;
