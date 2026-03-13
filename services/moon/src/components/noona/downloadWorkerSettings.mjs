export const THREAD_RATE_LIMIT_UNLIMITED = "-1";
export const CPU_CORE_UNPINNED = "-1";

export function formatCpuCoreIdDraft(value) {
    if (typeof value === "string") {
        const raw = value.trim();
        if (!raw || raw === "-1") {
            return CPU_CORE_UNPINNED;
        }
        if (!/^-?\d+$/.test(raw)) {
            return raw;
        }
        const parsedRaw = Number(raw);
        if (!Number.isFinite(parsedRaw) || parsedRaw < -1) {
            return CPU_CORE_UNPINNED;
        }
        return String(Math.floor(parsedRaw));
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < -1) {
        return CPU_CORE_UNPINNED;
    }
    return String(Math.floor(parsed));
}

export function normalizeCpuCoreIdDrafts(value, threadCount) {
    const normalizedThreadCount = Math.max(1, Math.floor(threadCount || 1));
    const source = Array.isArray(value) ? value : [];
    return Array.from({length: normalizedThreadCount}, (_, index) => formatCpuCoreIdDraft(source[index]));
}

export function formatWorkerCpuLabel(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `CPU ${value}` : "CPU auto";
}
