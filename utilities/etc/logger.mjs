// utilities/logger.mjs
import {stdout} from 'process';
import {inspect} from 'node:util';

import {createNoonaLogWriter} from './logFile.mjs';

const identity = value => value;

const fallbackChalk = {
    gray: identity,
    yellow: identity,
    magenta: identity,
    red: identity,
    dim: identity,
};

let chalkLib = fallbackChalk;

const importModule = new Function('specifier', 'return import(specifier);');

await importModule('chalk')
    .then((module) => {
        const resolved = module?.default ?? module;
        if (resolved) {
            chalkLib = resolved;
        }
    })
    .catch(() => {
        chalkLib = fallbackChalk;
    });

function isTTY() {
    return stdout.isTTY;
}

function colorize(color, value) {
    if (!isTTY()) {
        return value;
    }

    const fn = chalkLib?.[color];
    return typeof fn === 'function' ? fn(value) : value;
}

const TRUTHY_DEBUG_VALUES = new Set(['1', 'true', 'yes', 'on', 'super']);

function normalizeDebugSetting(value) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        return value > 0;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        return TRUTHY_DEBUG_VALUES.has(normalized);
    }

    return false;
}

let debugEnabled = normalizeDebugSetting(process.env.DEBUG);
const fileWriter = createNoonaLogWriter({
    onError: (error, filePath) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[logger] Failed to write log file ${filePath}: ${message}`);
    },
});

export function setDebug(enabled) {
    debugEnabled = normalizeDebugSetting(enabled);
}

export function isDebugEnabled() {
    return debugEnabled;
}

function formatPrefix(level = '', {color = true} = {}) {
    const err = new Error();
    const stack = err.stack?.split('\n')[2] || '';
    const match = stack.match(/\/([^\/]+)\/([^\/]+\.mjs)/);
    const service = match?.[1] || 'noona';
    const file = match?.[2] || 'unknown.mjs';
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${service}/${file}]${level ? ` [${level}]` : ''}`;
    return color ? colorize('gray', prefix) : prefix;
}

function formatValue(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (value instanceof Error) {
        return value.stack || value.message;
    }

    return inspect(value, {depth: 5, colors: false, breakLength: Infinity});
}

function writeFileLine(level, args) {
    const prefix = formatPrefix(level, {color: false});
    const message = args.map(formatValue).join(' ').trim();
    fileWriter.write(`${prefix}${message ? ` ${message}` : ''}\n`);
}

export function log(...args) {
    console.log(formatPrefix(), ...args);
    writeFileLine('', args);
}

export function warn(...args) {
    const prefix = formatPrefix('WARN');
    console.warn(colorize('yellow', prefix), ...args);
    writeFileLine('WARN', args);
}

export function alert(...args) {
    const prefix = formatPrefix('ALERT');
    console.log(colorize('magenta', prefix), ...args);
    writeFileLine('ALERT', args);
}

export function errMSG(...args) {
    const prefix = formatPrefix('ERROR');
    console.error(colorize('red', prefix), ...args);
    writeFileLine('ERROR', args);
}

export function debugMSG(...args) {
    if (debugEnabled) {
        const prefix = formatPrefix('DEBUG');
        console.log(colorize('dim', prefix), ...args);
        writeFileLine('DEBUG', args);
    }
}
