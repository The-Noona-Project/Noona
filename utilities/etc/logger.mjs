// utilities/logger.mjs
import chalk from 'chalk';
import {stdout} from 'process';

function isTTY() {
    return stdout.isTTY;
}

function formatPrefix(level = '') {
    const err = new Error();
    const stack = err.stack?.split('\n')[2] || '';
    const match = stack.match(/\/([^\/]+)\/([^\/]+\.mjs)/);
    const service = match?.[1] || 'noona';
    const file = match?.[2] || 'unknown.mjs';
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${service}/${file}]${level ? ` [${level}]` : ''}`;
    return isTTY() ? chalk.gray(prefix) : prefix;
}

export function log(...args) {
    console.log(formatPrefix(), ...args);
}

export function warn(...args) {
    const prefix = formatPrefix('WARN');
    console.warn(isTTY() ? chalk.yellow(prefix) : prefix, ...args);
}

export function alert(...args) {
    const prefix = formatPrefix('ALERT');
    console.log(isTTY() ? chalk.magenta(prefix) : prefix, ...args);
}

export function errMSG(...args) {
    const prefix = formatPrefix('ERROR');
    console.error(isTTY() ? chalk.red(prefix) : prefix, ...args);
}

export function debugMSG(...args) {
    if (process.env.DEBUG === 'true') {
        const prefix = formatPrefix('DEBUG');
        console.log(isTTY() ? chalk.dim(prefix) : prefix, ...args);
    }
}
