export const formatJSON = (value: unknown): string => {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return String(value);
    }
};

export const formatTable = (rows: Record<string, unknown>[] = [], columns?: string[]): string => {
    if (!Array.isArray(rows) || rows.length === 0) {
        return '—';
    }

    const resolvedColumns = columns?.length
        ? columns
        : Array.from(new Set(rows.flatMap((row) => Object.keys(row || {}))));

    const normalized = rows.map((row) => {
        const source = row && typeof row === 'object' ? row : {};
        return resolvedColumns.map((column) => String(source[column] ?? ''));
    });

    const widths = resolvedColumns.map((column, columnIndex) => {
        return Math.max(column.length, ...normalized.map((row) => row[columnIndex].length));
    });

    const header = resolvedColumns.map((column, index) => column.padEnd(widths[index])).join('  ');
    const separator = widths.map((width) => '─'.repeat(width)).join('  ');
    const body = normalized.map((row) => row.map((value, index) => value.padEnd(widths[index])).join('  ')).join('\n');
    return `${header}\n${separator}\n${body}`;
};

export const formatProgressEvent = (event: Record<string, unknown> = {}): string => {
    const { type, service, step, status, message, ...rest } = event as Record<string, string>;
    const parts = [] as string[];
    if (type) parts.push(String(type));
    if (service) parts.push(`service: ${service}`);
    if (step) parts.push(`step: ${step}`);
    if (status) parts.push(`status: ${status}`);
    if (message) parts.push(String(message));
    const extra = Object.entries(rest)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => `${key}: ${value}`);
    parts.push(...extra);
    if (parts.length === 0) {
        return JSON.stringify(event);
    }
    return parts.join(' • ');
};
