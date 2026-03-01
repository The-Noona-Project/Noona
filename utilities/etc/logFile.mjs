import fs from 'node:fs';
import path from 'node:path';

const normalizePathValue = (value) => (typeof value === 'string' ? value.trim() : '');

export function resolveNoonaLogFile({
                                        env = process.env,
                                        fileName = 'latest.log',
                                    } = {}) {
    const explicitFile = normalizePathValue(env?.NOONA_LOG_FILE);
    if (explicitFile) {
        return path.resolve(explicitFile);
    }

    const explicitDir = normalizePathValue(env?.NOONA_LOG_DIR);
    if (!explicitDir) {
        return null;
    }

    return path.join(path.resolve(explicitDir), fileName);
}

export function createNoonaLogWriter({
                                         env = process.env,
                                         fileName = 'latest.log',
                                         onError = null,
                                     } = {}) {
    const filePath = resolveNoonaLogFile({env, fileName});
    if (!filePath) {
        return {
            filePath: null,
            write() {
            },
            end() {
            },
        };
    }

    try {
        fs.mkdirSync(path.dirname(filePath), {recursive: true});
    } catch (error) {
        onError?.(error, filePath);
        return {
            filePath,
            write() {
            },
            end() {
            },
        };
    }

    const stream = fs.createWriteStream(filePath, {flags: 'a'});
    let writable = true;

    stream.on('error', (error) => {
        writable = false;
        onError?.(error, filePath);
    });

    return {
        filePath,
        write(value) {
            if (!writable || typeof value !== 'string' || value.length === 0) {
                return;
            }

            try {
                stream.write(value);
            } catch (error) {
                writable = false;
                onError?.(error, filePath);
            }
        },
        end() {
            if (!writable) {
                return;
            }

            try {
                stream.end();
            } catch {
                writable = false;
            }
        },
    };
}

export default {
    createNoonaLogWriter,
    resolveNoonaLogFile,
};
