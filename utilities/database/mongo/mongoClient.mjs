// utilities/database/mongo/mongoClient.mjs

import { MongoClient } from 'mongodb';
import { log, errMSG, warn } from '../../etc/logger.mjs';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://noona-mongo:27017';
const SERVICE_NAME = process.env.SERVICE_NAME || 'noona';

let client;

async function connectMongo() {
    if (!client) {
        client = new MongoClient(MONGO_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        try {
            await client.connect();
            log(`[${SERVICE_NAME}] Connected to MongoDB at ${MONGO_URI}`);
        } catch (err) {
            errMSG(`[${SERVICE_NAME}] MongoDB connection error: ${err.message}`);
            throw err;
        }
    }
    return client.db('noona');
}

export default connectMongo;
