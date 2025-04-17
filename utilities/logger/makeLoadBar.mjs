/**
 * @fileoverview
 * Generates a static string-based progress bar with optional label and size info.
 *
 * @module makeLoadBar
 */

/**
 * Creates a visual load bar string for CLI output.
 *
 * @param {number} percent - Percentage complete (0–100)
 * @param {object} [options={}]
 * @param {number} [options.width=20] - Width of the bar in characters
 * @param {string} [options.label=''] - Optional label text (left-aligned)
 * @param {string} [options.size=''] - Optional file/image size string
 * @returns {string} Formatted progress bar line
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
