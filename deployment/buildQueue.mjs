import { EventEmitter } from 'node:events';

const noop = () => {};

const pickLoggerMethod = (logger, candidates) => {
    for (const method of candidates) {
        if (logger && typeof logger[method] === 'function') {
            return logger[method].bind(logger);
        }
    }
    return noop;
};

export class BuildQueue extends EventEmitter {
    constructor({ workerThreads = 4, subprocessesPerWorker = 2, logger = console } = {}) {
        super();
        if (!Number.isInteger(workerThreads) || workerThreads < 1) {
            throw new TypeError('workerThreads must be a positive integer');
        }
        if (!Number.isInteger(subprocessesPerWorker) || subprocessesPerWorker < 1) {
            throw new TypeError('subprocessesPerWorker must be a positive integer');
        }

        this.workerThreads = workerThreads;
        this.subprocessesPerWorker = subprocessesPerWorker;
        this.logger = {
            info: pickLoggerMethod(logger, ['info', 'log']),
            warn: pickLoggerMethod(logger, ['warn', 'info', 'log']),
            error: pickLoggerMethod(logger, ['error', 'warn', 'log'])
        };

        this.queue = [];
        this.active = 0;
        this.limit = workerThreads;
        this.completed = [];
        this.jobCounter = 0;
    }

    useBaseCapacity() {
        this.limit = this.workerThreads;
        this.emit('capacityChange', { limit: this.limit });
        this.#process();
        return this.limit;
    }

    useMaxCapacity() {
        this.limit = this.workerThreads * this.subprocessesPerWorker;
        this.emit('capacityChange', { limit: this.limit });
        this.#process();
        return this.limit;
    }

    getCurrentCapacity() {
        return this.limit;
    }

    enqueue({ name, run }) {
        if (typeof run !== 'function') {
            throw new TypeError('enqueue requires a run() function');
        }

        const id = name || `job-${++this.jobCounter}`;
        return new Promise((resolve, reject) => {
            this.queue.push({ id, run, resolve, reject });
            this.emit('enqueued', { id, size: this.queue.length });
            setImmediate(() => this.#process());
        });
    }

    async drain() {
        if (this.active === 0 && this.queue.length === 0) {
            return;
        }

        return new Promise(resolve => {
            const handleIdle = () => {
                this.off('idle', handleIdle);
                resolve();
            };
            this.on('idle', handleIdle);
        });
    }

    getResults() {
        return this.completed.map(entry => ({
            ...entry,
            logs: [...entry.logs]
        }));
    }

    #process() {
        while (this.active < this.limit && this.queue.length > 0) {
            this.#runNext();
        }
    }

    #runNext() {
        const job = this.queue.shift();
        if (!job) return;

        const { id, run, resolve, reject } = job;
        const startedAt = Date.now();
        const logs = [];
        this.active += 1;

        const logLine = (level, message) => {
            if (!message) return;
            const text = `[${id}] ${message}`;
            logs.push(text);
            switch (level) {
                case 'error':
                    this.logger.error(text);
                    break;
                case 'warn':
                    this.logger.warn(text);
                    break;
                default:
                    this.logger.info(text);
                    break;
            }
            this.emit('log', { id, level, message, text });
        };

        logLine('info', `started (active ${this.active}/${this.limit})`);

        const report = entry => {
            if (!entry) return;
            const normalized = typeof entry === 'string'
                ? { level: 'info', message: entry }
                : { level: entry.level || 'info', message: entry.message || '' };
            if (!normalized.message) return;
            logLine(normalized.level, normalized.message);
        };

        const finalize = (status, payload) => {
            const finishedAt = Date.now();
            const duration = finishedAt - startedAt;
            if (status === 'fulfilled') {
                logLine('info', `completed in ${duration}ms`);
                this.completed.push({ id, status, value: payload, logs: [...logs], startedAt, finishedAt, duration });
            } else {
                const error = payload instanceof Error ? payload : new Error(String(payload));
                const reason = error.message || 'Unknown error';
                logLine('error', `failed after ${duration}ms: ${reason}`);
                if (Array.isArray(error.records)) {
                    for (const record of error.records) {
                        if (typeof record === 'string' && record.trim()) {
                            logLine('error', record.trim());
                        }
                    }
                }
                this.completed.push({ id, status, error, logs: [...logs], startedAt, finishedAt, duration });
            }
        };

        Promise.resolve()
            .then(() => run(report))
            .then(result => {
                finalize('fulfilled', result);
                job.resolve(result);
            })
            .catch(error => {
                finalize('rejected', error);
                job.reject(error);
            })
            .finally(() => {
                this.active = Math.max(0, this.active - 1);
                if (this.active === 0 && this.queue.length === 0) {
                    this.emit('idle');
                } else {
                    this.#process();
                }
            });
    }
}

export default function createBuildQueue(options = {}) {
    return new BuildQueue(options);
}
