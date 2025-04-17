// noona/logger/makeLoadBar.mjs

/**
 * Generates a formatted progress bar string with optional label and size info.
 *
 * @param {number} percent - Progress percentage (0–100).
 * @param {object} options
 * @param {number} [options.width=20] - Width of the progress bar.
 * @param {string} [options.label=''] - Optional image label.
 * @param {string} [options.size=''] - Optional total size (e.g., '128 MB').
 * @returns {string}
 */
export function makeLoadBar(percent, { width = 20, label = '', size = '' } = {}) {
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;

    const bar = `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`.padEnd(width + 4);
    const percentText = `${String(percent).padStart(3)}%`;
    const labelText = label?.padEnd(24) ?? '';
    const sizeText = size ? `(${size})` : '';

    return `${bar} ${percentText} ${labelText} ${sizeText}`;
}
