import chalk from 'chalk';

/**
 * Automatically determines the prefix (e.g., [moon], [warden]) based on caller path.
 * @returns {string}
 */
function getPrefix() {
    const error = new Error();
    const stack = error.stack?.split('\n')[2] || '';
    const match = stack.match(/\/([^\/]+)\/[^\/]+\.mjs/);
    return match ? `[${match[1]}]` : '[noona]';
}

export function log(...args) {
    console.log(chalk.blue(getPrefix()), ...args);
}

export function warn(...args) {
    console.warn(chalk.yellow(getPrefix()), ...args);
}

export function alert(...args) {
    console.log(chalk.magentaBright(getPrefix()), chalk.bgMagenta('ALERT'), ...args);
}

export function errMSG(...args) {
    console.error(chalk.red(getPrefix()), chalk.bold('ERROR:'), ...args);
}

export function debugMSG(...args) {
    if (process.env.DEBUG === 'true') {
        console.log(chalk.gray(getPrefix()), chalk.dim('[DEBUG]'), ...args);
    }
}
