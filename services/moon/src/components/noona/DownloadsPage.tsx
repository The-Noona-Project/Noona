"use client";

import {useEffect, useEffectEvent, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Row, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";
import styles from "./DownloadsPage.module.scss";

type RavenDownloadProgress = {
    taskId?: string | null;
    taskType?: string | null;
    title?: string | null;
    titleUuid?: string | null;
    queuedAt?: number | null;
    totalChapters?: number | null;
    sourceChapterCount?: number | null;
    completedChapters?: number | null;
    currentChapter?: string | null;
    currentChapterNumber?: string | null;
    status?: string | null;
    latestChapter?: string | null;
    message?: string | null;
    startedAt?: number | null;
    completedAt?: number | null;
    errorMessage?: string | null;
    recoveredFromCache?: boolean | null;
    recoveryState?: string | null;
    queuedChapterNumbers?: string[] | null;
    completedChapterNumbers?: string[] | null;
    remainingChapterNumbers?: string[] | null;
    newChapterNumbers?: string[] | null;
    missingChapterNumbers?: string[] | null;
    workerIndex?: number | null;
    cpuCoreId?: number | null;
    workerPid?: number | null;
    executionMode?: string | null;
    pauseRequested?: boolean | null;
    lastUpdated?: number | null;
};

type RavenActiveWorker = {
    taskId?: string | null;
    title?: string | null;
    status?: string | null;
    workerIndex?: number | null;
    cpuCoreId?: number | null;
    workerPid?: number | null;
    executionMode?: string | null;
    pauseRequested?: boolean | null;
};

type RavenDownloadSummary = {
    activeDownloads?: number;
    maxThreads?: number;
    threadRateLimitsKbps?: number[] | null;
    workerExecutionMode?: string | null;
    workerCpuCoreIds?: number[] | null;
    availableCpuIds?: number[] | null;
    activeWorkers?: RavenActiveWorker[] | null;
    state?: string | null;
    statusText?: string | null;
    currentTask?: RavenDownloadProgress | null;
    error?: string;
};

type RavenLibrarySyncResponse = {
    message?: string | null;
    queuedChapters?: number | null;
    updatedTitles?: number | null;
};

type RavenPauseResponse = {
    message?: string | null;
    affectedTasks?: number | null;
    pausedImmediately?: string[] | null;
    pausingAfterCurrentChapter?: string[] | null;
};

type ResolvedTaskView = {
    key: string;
    titleName: string;
    statusRaw: string;
    status: string;
    taskType: string;
    current: string;
    latestChapter: string;
    message: string;
    errorMessage: string;
    total: number;
    completed: number;
    percent: number;
    queued: string[];
    remaining: string[];
    newChapters: string[];
    missingChapters: string[];
    completedChapterNumbers: string[];
    recovered: boolean;
    recoveryState: string;
    sourceChapterCount: number | null;
    workerIndex: number | null;
    cpuCoreId: number | null;
    workerPid: number | null;
    executionMode: string;
    pauseRequested: boolean;
    queuedAtLabel: string;
    updatedAtLabel: string;
    completedAtLabel: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const formatEpochMs = (value: unknown): string => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    return new Date(value).toLocaleString();
};
const parseErrorMessage = (json: unknown, fallback: string): string => {
    if (json && typeof json === "object" && "error" in json && typeof (json as {
        error?: unknown
    }).error === "string") {
        const message = normalizeString((json as { error?: unknown }).error).trim();
        if (message) return message;
    }
    return fallback;
};
const normalizeNumberList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map((entry) => normalizeString(entry).trim())
        .filter(Boolean);
};
const statusBadgeBackground = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    if (status === "completed") return "success-alpha-weak";
    if (status === "failed" || status === "interrupted") return "danger-alpha-weak";
    if (status === "paused") return "warning-alpha-weak";
    if (status === "recovering" || status === "downloading") return "brand-alpha-weak";
    return "neutral-alpha-weak";
};
const progressBarBackground = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    if (status === "completed") return "success-alpha-medium";
    if (status === "failed" || status === "interrupted") return "danger-alpha-medium";
    if (status === "paused") return "warning-alpha-medium";
    return "brand-alpha-medium";
};
const isTerminalStatus = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    return status === "completed"
        || status === "failed"
        || status === "error"
        || status === "paused"
        || status === "cancelled"
        || status === "canceled";
};
const buildTaskKey = (entry: RavenDownloadProgress, fallbackIndex = 0): string => {
    const taskId = normalizeString(entry.taskId).trim();
    if (taskId) {
        return taskId;
    }

    const titleUuid = normalizeString(entry.titleUuid).trim();
    const title = normalizeString(entry.title).trim() || "untitled";
    const timestamp = typeof entry.queuedAt === "number" && Number.isFinite(entry.queuedAt)
        ? entry.queuedAt
        : typeof entry.startedAt === "number" && Number.isFinite(entry.startedAt)
            ? entry.startedAt
            : typeof entry.completedAt === "number" && Number.isFinite(entry.completedAt)
                ? entry.completedAt
                : fallbackIndex;
    return `${titleUuid || title}:${timestamp}`;
};
const mergeTaskSnapshot = (base: RavenDownloadProgress, incoming: RavenDownloadProgress): RavenDownloadProgress => {
    const merged: RavenDownloadProgress = {...base};

    for (const [rawKey, rawValue] of Object.entries(incoming) as Array<[keyof RavenDownloadProgress, unknown]>) {
        if (rawValue == null) {
            continue;
        }

        const currentValue = merged[rawKey];
        if (Array.isArray(rawValue)) {
            if (rawValue.length === 0 && Array.isArray(currentValue) && currentValue.length > 0) {
                continue;
            }
            merged[rawKey] = rawValue as never;
            continue;
        }

        if (typeof rawValue === "string") {
            if (!rawValue.trim() && typeof currentValue === "string" && currentValue.trim()) {
                continue;
            }
            merged[rawKey] = rawValue as never;
            continue;
        }

        merged[rawKey] = rawValue as never;
    }

    return merged;
};
const compareTaskEntries = (left: RavenDownloadProgress, right: RavenDownloadProgress) => {
    const rank = (statusRaw: string) => {
        const status = statusRaw.trim().toLowerCase();
        if (status === "downloading") return 0;
        if (status === "recovering") return 1;
        if (status === "queued") return 2;
        if (status === "interrupted") return 3;
        if (status === "paused") return 4;
        if (status === "completed") return 5;
        if (status === "failed" || status === "error") return 6;
        return 7;
    };
    const leftRank = rank(normalizeString(left.status));
    const rightRank = rank(normalizeString(right.status));
    if (leftRank !== rightRank) {
        return leftRank - rightRank;
    }

    const leftUpdated = Math.max(
        typeof left.lastUpdated === "number" && Number.isFinite(left.lastUpdated) ? left.lastUpdated : 0,
        typeof left.startedAt === "number" && Number.isFinite(left.startedAt) ? left.startedAt : 0,
        typeof left.queuedAt === "number" && Number.isFinite(left.queuedAt) ? left.queuedAt : 0,
        typeof left.completedAt === "number" && Number.isFinite(left.completedAt) ? left.completedAt : 0,
    );
    const rightUpdated = Math.max(
        typeof right.lastUpdated === "number" && Number.isFinite(right.lastUpdated) ? right.lastUpdated : 0,
        typeof right.startedAt === "number" && Number.isFinite(right.startedAt) ? right.startedAt : 0,
        typeof right.queuedAt === "number" && Number.isFinite(right.queuedAt) ? right.queuedAt : 0,
        typeof right.completedAt === "number" && Number.isFinite(right.completedAt) ? right.completedAt : 0,
    );

    return rightUpdated - leftUpdated;
};
const formatTaskListPreview = (values: string[], limit = 10): string => {
    if (values.length === 0) {
        return "";
    }

    const preview = values.slice(0, limit).join(", ");
    const hiddenCount = values.length - limit;
    return hiddenCount > 0 ? `${preview} +${hiddenCount} more` : preview;
};
const resolveTaskView = (entry: RavenDownloadProgress, fallbackIndex = 0): ResolvedTaskView => {
    const queued = normalizeNumberList(entry.queuedChapterNumbers);
    const remaining = normalizeNumberList(entry.remainingChapterNumbers);
    const newChapters = normalizeNumberList(entry.newChapterNumbers);
    const missingChapters = normalizeNumberList(entry.missingChapterNumbers);
    const completedChapterNumbers = normalizeNumberList(entry.completedChapterNumbers);
    const total =
        typeof entry.totalChapters === "number" && Number.isFinite(entry.totalChapters)
            ? entry.totalChapters
            : queued.length;
    const completed =
        typeof entry.completedChapters === "number" && Number.isFinite(entry.completedChapters)
            ? entry.completedChapters
            : completedChapterNumbers.length;

    return {
        key: buildTaskKey(entry, fallbackIndex),
        titleName: normalizeString(entry.title).trim() || "Untitled",
        statusRaw: normalizeString(entry.status).trim() || "unknown",
        status: normalizeString(entry.status).trim().toLowerCase() || "unknown",
        taskType: normalizeString(entry.taskType).trim(),
        current: normalizeString(entry.currentChapter).trim(),
        latestChapter: normalizeString(entry.latestChapter).trim(),
        message: normalizeString(entry.message).trim(),
        errorMessage: normalizeString(entry.errorMessage).trim(),
        total,
        completed,
        percent: total > 0 ? Math.min(100, Math.max(0, (completed / total) * 100)) : 0,
        queued,
        remaining,
        newChapters,
        missingChapters,
        completedChapterNumbers,
        recovered: entry.recoveredFromCache === true,
        recoveryState: normalizeString(entry.recoveryState).trim(),
        sourceChapterCount:
            typeof entry.sourceChapterCount === "number" && Number.isFinite(entry.sourceChapterCount)
                ? entry.sourceChapterCount
                : null,
        workerIndex:
            typeof entry.workerIndex === "number" && Number.isFinite(entry.workerIndex)
                ? entry.workerIndex
                : null,
        cpuCoreId:
            typeof entry.cpuCoreId === "number" && Number.isFinite(entry.cpuCoreId)
                ? entry.cpuCoreId
                : null,
        workerPid:
            typeof entry.workerPid === "number" && Number.isFinite(entry.workerPid)
                ? entry.workerPid
                : null,
        executionMode: normalizeString(entry.executionMode).trim() || "thread",
        pauseRequested: entry.pauseRequested === true,
        queuedAtLabel: formatEpochMs(entry.queuedAt),
        updatedAtLabel: formatEpochMs(entry.lastUpdated ?? entry.startedAt),
        completedAtLabel: formatEpochMs(entry.completedAt),
    };
};

export function DownloadsPage() {
    const [downloads, setDownloads] = useState<RavenDownloadProgress[] | null>(null);
    const [downloadsError, setDownloadsError] = useState<string | null>(null);

    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);
    const [summary, setSummary] = useState<RavenDownloadSummary | null>(null);

    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const [history, setHistory] = useState<RavenDownloadProgress[]>([]);

    const [syncingLibrary, setSyncingLibrary] = useState(false);
    const [syncLibraryMessage, setSyncLibraryMessage] = useState<string | null>(null);
    const [syncLibraryError, setSyncLibraryError] = useState<string | null>(null);
    const [pausingDownloads, setPausingDownloads] = useState(false);
    const [pauseDownloadsMessage, setPauseDownloadsMessage] = useState<string | null>(null);
    const [pauseDownloadsError, setPauseDownloadsError] = useState<string | null>(null);
    const pollDownloads = async () => {
        try {
            const res = await fetch("/api/noona/raven/downloads/status", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as unknown;

            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Failed to load downloads (HTTP ${res.status}).`));
            }

            setDownloads(Array.isArray(json) ? (json as RavenDownloadProgress[]) : []);
            setDownloadsError(null);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setDownloadsError(message);
        }
    };

    const loadSummary = async () => {
        setSummaryLoading(true);
        setSummaryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/summary", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as RavenDownloadSummary | null;
            if (!res.ok) {
                setSummaryError(parseErrorMessage(json, `Failed to load summary (HTTP ${res.status}).`));
                return;
            }
            setSummary(json ?? {});
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSummaryError(message);
        } finally {
            setSummaryLoading(false);
        }
    };

    const loadHistory = async () => {
        setHistoryLoading(true);
        setHistoryError(null);
        try {
            const res = await fetch("/api/noona/raven/downloads/history", {cache: "no-store"});
            const json = await res.json().catch(() => null);
            if (!res.ok) {
                setHistoryError(parseErrorMessage(json, `Failed to load history (HTTP ${res.status}).`));
                return;
            }
            setHistory(Array.isArray(json) ? json as RavenDownloadProgress[] : []);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setHistoryError(message);
        } finally {
            setHistoryLoading(false);
        }
    };

    const refreshAll = async () => {
        await Promise.all([pollDownloads(), loadSummary(), loadHistory()]);
    };

    const refreshAllOnMount = useEffectEvent(() => {
        void refreshAll();
    });

    useEffect(() => {
        const interval = window.setInterval(() => {
            void pollDownloads();
        }, 1500);

        refreshAllOnMount();

        return () => {
            window.clearInterval(interval);
        };
    }, []);

    const checkLibraryForNewChapters = async () => {
        setSyncingLibrary(true);
        setSyncLibraryMessage(null);
        setSyncLibraryError(null);

        try {
            const res = await fetch("/api/noona/raven/library/checkForNew", {
                method: "POST",
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Sync failed (HTTP ${res.status}).`));
            }

            const payload = json && typeof json === "object" ? (json as RavenLibrarySyncResponse) : null;
            const queued = typeof payload?.queuedChapters === "number" && Number.isFinite(payload.queuedChapters)
                ? payload.queuedChapters
                : null;
            const updatedTitles =
                typeof payload?.updatedTitles === "number" && Number.isFinite(payload.updatedTitles)
                    ? payload.updatedTitles
                    : null;

            const fallbackMessage =
                queued != null && queued > 0
                    ? `Queued ${queued} chapter(s) across ${updatedTitles ?? "multiple"} title(s).`
                    : "No new or missing chapters found.";

            setSyncLibraryMessage(normalizeString(payload?.message).trim() || fallbackMessage);
            await refreshAll();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSyncLibraryError(message);
        } finally {
            setSyncingLibrary(false);
        }
    };

    const requestPauseDownloads = async () => {
        setPausingDownloads(true);
        setPauseDownloadsMessage(null);
        setPauseDownloadsError(null);

        try {
            const res = await fetch("/api/noona/raven/downloads/pause", {
                method: "POST",
            });
            const json = (await res.json().catch(() => null)) as RavenPauseResponse | null;
            if (!res.ok) {
                throw new Error(parseErrorMessage(json, `Pause failed (HTTP ${res.status}).`));
            }

            const affectedTasks = typeof json?.affectedTasks === "number" && Number.isFinite(json.affectedTasks)
                ? json.affectedTasks
                : null;
            const fallbackMessage = affectedTasks != null && affectedTasks > 0
                ? `Pause request accepted for ${affectedTasks} task(s). Raven will stop after the current chapter.`
                : "No active Raven downloads were available to pause.";
            setPauseDownloadsMessage(normalizeString(json?.message).trim() || fallbackMessage);
            await refreshAll();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setPauseDownloadsError(message);
        } finally {
            setPausingDownloads(false);
        }
    };

    const activeDownloads = useMemo(() => {
        const list = downloads ?? [];
        return list.filter((entry) => !isTerminalStatus(normalizeString(entry.status)));
    }, [downloads]);
    const currentTask = useMemo(() => {
        const task = summary?.currentTask;
        return task && typeof task === "object" ? task : null;
    }, [summary]);
    const activeTaskViews = useMemo(
        () => [...activeDownloads].sort(compareTaskEntries).map((entry, index) => resolveTaskView(entry, index)),
        [activeDownloads],
    );
    const currentTaskDeck = useMemo(() => {
        const tasksByKey = new Map<string, RavenDownloadProgress>();
        const pushTask = (task: RavenDownloadProgress | null) => {
            if (!task) {
                return;
            }

            const key = buildTaskKey(task, tasksByKey.size);
            const existing = tasksByKey.get(key);
            tasksByKey.set(key, existing ? mergeTaskSnapshot(existing, task) : task);
        };

        pushTask(currentTask);
        for (const entry of activeDownloads) {
            pushTask(entry);
        }

        return Array.from(tasksByKey.values())
            .filter((entry) => {
                const title = normalizeString(entry.title).trim();
                const status = normalizeString(entry.status).trim().toLowerCase();
                return Boolean(title)
                    || status === "queued"
                    || status === "downloading"
                    || status === "recovering"
                    || status === "interrupted"
                    || normalizeNumberList(entry.remainingChapterNumbers).length > 0
                    || normalizeNumberList(entry.completedChapterNumbers).length > 0;
            })
            .sort(compareTaskEntries);
    }, [activeDownloads, currentTask]);
    const currentTaskDeckViews = useMemo(
        () => currentTaskDeck.map((entry, index) => resolveTaskView(entry, index)),
        [currentTaskDeck],
    );
    const historyViews = useMemo(
        () =>
            [...history]
                .sort((left, right) => {
                    const leftCompleted = typeof left.completedAt === "number" && Number.isFinite(left.completedAt)
                        ? left.completedAt
                        : 0;
                    const rightCompleted = typeof right.completedAt === "number" && Number.isFinite(right.completedAt)
                        ? right.completedAt
                        : 0;
                    return rightCompleted - leftCompleted;
                })
                .map((entry, index) => resolveTaskView(entry, index)),
        [history],
    );
    const focusTask = currentTaskDeckViews[0] ?? null;
    const remainingChapterCount = activeTaskViews.reduce((total, task) => total + task.remaining.length, 0);
    const completedHistoryCount = historyViews.filter((task) => task.status === "completed").length;
    const interruptedHistoryCount = historyViews.length - completedHistoryCount;
    const showcaseStatus = currentTaskDeckViews[0]?.statusRaw || normalizeString(summary?.state).trim() || "idle";
    const taskShowcaseCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="xl"
            className={`${styles.sectionCard} ${styles.showcaseCard}`}
        >
            <Column gap="16">
                <Row fillWidth horizontal="between" vertical="start" gap="16" s={{direction: "column"}}>
                    <Column gap="8" style={{minWidth: 0}}>
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Raven mission control
                        </Text>
                        <Heading as="h2" variant="display-strong-s" wrap="balance">
                            {focusTask
                                ? `${focusTask.titleName} is in focus`
                                : normalizeString(summary?.statusText).trim() || "Raven is standing by"}
                        </Heading>
                        <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                            A cleaner ops board for live queue health, chapter progress, and worker pacing.
                        </Text>
                    </Column>
                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        <Badge background={statusBadgeBackground(showcaseStatus)}>
                            {showcaseStatus}
                        </Badge>
                        <Badge background="neutral-alpha-weak">
                            live tasks: {currentTaskDeckViews.length}
                        </Badge>
                        <Badge background="neutral-alpha-weak">
                            remaining chapters: {remainingChapterCount}
                        </Badge>
                        <Badge background="neutral-alpha-weak">
                            workers: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                        </Badge>
                    </Row>
                </Row>

                <Row
                    fillWidth
                    gap="12"
                    style={{
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1.45fr) minmax(min(100%, 18rem), 0.95fr)",
                        alignItems: "stretch",
                    }}
                    m={{style: {gridTemplateColumns: "1fr"}}}
                >
                    <Card fillWidth padding="l" radius="l" background="surface" border="neutral-alpha-weak">
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                <Column gap="4">
                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                        Focus board
                                    </Text>
                                    <Heading as="h3" variant="heading-strong-l" wrap="balance">
                                        {focusTask ? focusTask.titleName : "No active task"}
                                    </Heading>
                                </Column>
                                {focusTask && (
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background={statusBadgeBackground(focusTask.statusRaw)}>
                                            {focusTask.statusRaw}
                                        </Badge>
                                        {focusTask.workerIndex != null && (
                                            <Badge background="neutral-alpha-weak">
                                                worker {focusTask.workerIndex + 1}
                                            </Badge>
                                        )}
                                        {focusTask.cpuCoreId != null && (
                                            <Badge background="neutral-alpha-weak">
                                                CPU {focusTask.cpuCoreId >= 0 ? focusTask.cpuCoreId : "auto"}
                                            </Badge>
                                        )}
                                        {focusTask.recovered && (
                                            <Badge background="brand-alpha-weak">
                                                recovered
                                            </Badge>
                                        )}
                                    </Row>
                                )}
                            </Row>

                            {focusTask ? (
                                <>
                                    {(focusTask.message || focusTask.current) && (
                                        <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                            {focusTask.current ? `Current chapter: ${focusTask.current}` : focusTask.message}
                                        </Text>
                                    )}
                                    {focusTask.errorMessage && (
                                        <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                            {focusTask.errorMessage}
                                        </Text>
                                    )}
                                    <Row fillWidth background="neutral-alpha-weak" radius="l"
                                         className={styles.progressTrackLarge}>
                                        <Row
                                            background={progressBarBackground(focusTask.statusRaw)}
                                            radius="l"
                                            style={{
                                                width: focusTask.status === "queued" ? "12%" : `${focusTask.percent}%`,
                                                height: "100%",
                                                minWidth: focusTask.status === "queued" ? 18 : 0,
                                            }}
                                        />
                                    </Row>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background="neutral-alpha-weak">
                                            chapters: {focusTask.completed}/{focusTask.total || "?"}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            remaining: {focusTask.remaining.length}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            new: {focusTask.newChapters.length}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            missing: {focusTask.missingChapters.length}
                                        </Badge>
                                    </Row>
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        {focusTask.remaining.length > 0
                                            ? `Remaining queue: ${formatTaskListPreview(focusTask.remaining, 10)}`
                                            : "No remaining queue on the focused task."}
                                    </Text>
                                    <div className={styles.taskTimelineGrid}>
                                        <Column gap="2">
                                            <Text variant="label-default-xs" onBackground="neutral-weak">
                                                Queued
                                            </Text>
                                            <Text variant="body-default-xs" onBackground="neutral-strong"
                                                  wrap="balance">
                                                {focusTask.queuedAtLabel || "No timestamp"}
                                            </Text>
                                        </Column>
                                        <Column gap="2">
                                            <Text variant="label-default-xs" onBackground="neutral-weak">
                                                Last update
                                            </Text>
                                            <Text variant="body-default-xs" onBackground="neutral-strong"
                                                  wrap="balance">
                                                {focusTask.updatedAtLabel || "No timestamp"}
                                            </Text>
                                        </Column>
                                        <Column gap="2">
                                            <Text variant="label-default-xs" onBackground="neutral-weak">
                                                Recovery
                                            </Text>
                                            <Text variant="body-default-xs" onBackground="neutral-strong"
                                                  wrap="balance">
                                                {focusTask.recoveryState || "Direct run"}
                                            </Text>
                                        </Column>
                                    </div>
                                </>
                            ) : (
                                <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                    Raven is idle. Queue a title or run a library sweep and the focus board will lock
                                    onto the next task automatically.
                                </Text>
                            )}
                        </Column>
                    </Card>

                    <Column gap="12">
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak">
                            <Column gap="8">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Queue actions
                                </Text>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="primary" href="/downloads/add">
                                        Add download
                                    </Button>
                                    <Button
                                        variant="secondary"
                                        disabled={pausingDownloads || activeTaskViews.length === 0}
                                        onClick={() => void requestPauseDownloads()}
                                    >
                                        {pausingDownloads ? "Pausing..." : "Pause downloads"}
                                    </Button>
                                </Row>
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary" onClick={() => void checkLibraryForNewChapters()}
                                            disabled={syncingLibrary}>
                                        {syncingLibrary ? "Checking..." : "Check new/missing"}
                                    </Button>
                                    <Button variant="secondary" onClick={() => void refreshAll()}>
                                        Refresh all
                                    </Button>
                                </Row>
                            </Column>
                        </Card>
                        <Card fillWidth padding="m" radius="l" background="surface" border="neutral-alpha-weak">
                            <Column gap="8">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Signals
                                </Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Completed jobs: {completedHistoryCount}
                                </Text>
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Interrupted jobs: {interruptedHistoryCount}
                                </Text>
                                {pauseDownloadsMessage && !pauseDownloadsError && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        {pauseDownloadsMessage}
                                    </Text>
                                )}
                                {pauseDownloadsError && (
                                    <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                        {pauseDownloadsError}
                                    </Text>
                                )}
                                {syncLibraryMessage && !syncLibraryError && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        {syncLibraryMessage}
                                    </Text>
                                )}
                                {syncLibraryError && (
                                    <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                        {syncLibraryError}
                                    </Text>
                                )}
                            </Column>
                        </Card>
                    </Column>
                </Row>
            </Column>
        </Card>
    );
    const activeDownloadsCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="xl"
            className={styles.sectionCard}
        >
            <Column gap="12">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Live queue
                        </Text>
                        <Heading as="h2" variant="heading-strong-l">
                            Active jobs
                        </Heading>
                    </Column>
                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        <Badge background="neutral-alpha-weak">
                            {activeTaskViews.length} active
                        </Badge>
                        <Button
                            variant="secondary"
                            disabled={pausingDownloads || activeTaskViews.length === 0}
                            onClick={() => void requestPauseDownloads()}
                        >
                            {pausingDownloads ? "Pausing..." : "Pause downloads"}
                        </Button>
                        <Button variant="secondary" onClick={() => void pollDownloads()}>
                            Refresh status
                        </Button>
                    </Row>
                </Row>

                {pauseDownloadsError && (
                    <Text onBackground="danger-strong" variant="body-default-xs">
                        {pauseDownloadsError}
                    </Text>
                )}
                {pauseDownloadsMessage && !pauseDownloadsError && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        {pauseDownloadsMessage}
                    </Text>
                )}

                {downloadsError && (
                    <Text onBackground="danger-strong" variant="body-default-xs">
                        {downloadsError}
                    </Text>
                )}

                {!downloads && !downloadsError && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Loading download status...
                    </Text>
                )}

                {downloads && activeTaskViews.length === 0 && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        No active downloads.
                    </Text>
                )}

                {downloads && activeTaskViews.length > 0 && (
                    <Column gap="12">
                        {activeTaskViews.map((task) => (
                            <Card
                                key={task.key}
                                fillWidth
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="m"
                                radius="l"
                                className={styles.downloadCard}
                            >
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Text variant="body-strong-s" wrap="balance">
                                            {task.titleName}
                                        </Text>
                                        <Badge background={statusBadgeBackground(task.statusRaw)}>
                                            {task.statusRaw}
                                        </Badge>
                                    </Row>

                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background="neutral-alpha-weak">
                                            {task.completed}/{task.total || "?"} chapters
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            remaining {task.remaining.length}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            {task.taskType || "download"}
                                        </Badge>
                                        {task.workerIndex != null && (
                                            <Badge background="neutral-alpha-weak">
                                                worker {task.workerIndex + 1}
                                            </Badge>
                                        )}
                                        {task.cpuCoreId != null && (
                                            <Badge background="neutral-alpha-weak">
                                                CPU {task.cpuCoreId >= 0 ? task.cpuCoreId : "auto"}
                                            </Badge>
                                        )}
                                        {task.recovered && (
                                            <Badge background="brand-alpha-weak">
                                                recovered
                                            </Badge>
                                        )}
                                    </Row>

                                    {(task.current || task.message) && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            {task.current ? `Current: ${task.current}` : task.message}
                                        </Text>
                                    )}

                                    {task.remaining.length > 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Next up: {formatTaskListPreview(task.remaining, 8)}
                                        </Text>
                                    )}
                                    {task.completedChapterNumbers.length > 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Completed: {formatTaskListPreview(task.completedChapterNumbers, 8)}
                                        </Text>
                                    )}

                                    {task.errorMessage && (
                                        <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                            {task.errorMessage}
                                        </Text>
                                    )}

                                    <Row
                                        fillWidth
                                        background="neutral-alpha-weak"
                                        radius="l"
                                        className={styles.progressTrackSmall}
                                    >
                                        <Row
                                            background={progressBarBackground(task.statusRaw)}
                                            radius="l"
                                            style={{
                                                width: task.status === "queued" ? "12%" : `${task.percent}%`,
                                                height: "100%",
                                                minWidth: task.status === "queued" ? 18 : 0,
                                            }}
                                        />
                                    </Row>
                                </Column>
                            </Card>
                        ))}
                    </Column>
                )}
            </Column>
        </Card>
    );
    const workersCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="xl"
            className={styles.sectionCard}
        >
            <Column gap="12">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Worker lanes
                        </Text>
                        <Heading as="h3" variant="heading-strong-l">
                            Throughput settings
                        </Heading>
                    </Column>
                    <Button variant="secondary" disabled={summaryLoading} onClick={() => void loadSummary()}>
                        Refresh
                    </Button>
                </Row>
                {summaryError && (
                    <Text onBackground="danger-strong" variant="body-default-xs">
                        {summaryError}
                    </Text>
                )}
                {summaryLoading && (
                    <Row fillWidth horizontal="center" paddingY="12">
                        <Spinner/>
                    </Row>
                )}
                {!summaryLoading && (
                    <Column gap="8">
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Badge background="neutral-alpha-weak">
                                active: {activeTaskViews.length}
                            </Badge>
                            <Badge background="neutral-alpha-weak">
                                completed: {completedHistoryCount}
                            </Badge>
                            <Badge background="neutral-alpha-weak">
                                interrupted: {interruptedHistoryCount}
                            </Badge>
                        </Row>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Badge background="neutral-alpha-weak">
                                max threads: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                            </Badge>
                            <Badge background="neutral-alpha-weak">
                                mode: {normalizeString(summary?.workerExecutionMode).trim() || "thread"}
                            </Badge>
                        </Row>
                        {Array.isArray(summary?.availableCpuIds) && summary.availableCpuIds.length > 0 && (
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {summary.availableCpuIds.map((cpuId) => (
                                    <Badge key={`available-cpu-${cpuId}`} background="neutral-alpha-weak">
                                        CPU {cpuId}
                                    </Badge>
                                ))}
                            </Row>
                        )}
                        {Array.isArray(summary?.workerCpuCoreIds) && summary.workerCpuCoreIds.length > 0 && (
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {summary.workerCpuCoreIds.map((cpuCoreId, index) => (
                                    <Badge key={`worker-core-${index}`} background="neutral-alpha-weak">
                                        worker {index + 1}:
                                        CPU {typeof cpuCoreId === "number" && cpuCoreId >= 0 ? cpuCoreId : "auto"}
                                    </Badge>
                                ))}
                            </Row>
                        )}
                        {Array.isArray(summary?.threadRateLimitsKbps) && summary.threadRateLimitsKbps.length > 0 ? (
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {summary.threadRateLimitsKbps.map((limit, index) => (
                                    <Badge key={`worker-${index}`} background="neutral-alpha-weak">
                                        worker {index + 1}: {typeof limit === "number" && limit > 0 ? `${limit} KB/s` : "unlimited"}
                                    </Badge>
                                ))}
                            </Row>
                        ) : (
                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                No worker speed limits are currently exposed by Raven.
                            </Text>
                        )}
                        {Array.isArray(summary?.activeWorkers) && summary.activeWorkers.length > 0 && (
                            <Column gap="8">
                                {summary.activeWorkers.map((worker, index) => (
                                    <Card
                                        key={normalizeString(worker.taskId).trim() || `active-worker-${index}`}
                                        fillWidth
                                        background="surface"
                                        border="neutral-alpha-weak"
                                        padding="m"
                                        radius="l"
                                    >
                                        <Column gap="8">
                                            <Row horizontal="between" vertical="center" gap="12"
                                                 style={{flexWrap: "wrap"}}>
                                                <Text variant="body-strong-s" wrap="balance">
                                                    {normalizeString(worker.title).trim() || "Idle worker"}
                                                </Text>
                                                <Badge
                                                    background={statusBadgeBackground(normalizeString(worker.status).trim() || "queued")}>
                                                    {normalizeString(worker.status).trim() || "queued"}
                                                </Badge>
                                            </Row>
                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                <Badge background="neutral-alpha-weak">
                                                    worker {typeof worker.workerIndex === "number" ? worker.workerIndex + 1 : index + 1}
                                                </Badge>
                                                <Badge background="neutral-alpha-weak">
                                                    CPU {typeof worker.cpuCoreId === "number" && worker.cpuCoreId >= 0 ? worker.cpuCoreId : "auto"}
                                                </Badge>
                                                <Badge background="neutral-alpha-weak">
                                                    PID {typeof worker.workerPid === "number" ? worker.workerPid : "unknown"}
                                                </Badge>
                                                <Badge background="neutral-alpha-weak">
                                                    {normalizeString(worker.executionMode).trim() || "thread"}
                                                </Badge>
                                                {worker.pauseRequested === true && (
                                                    <Badge background="warning-alpha-weak">
                                                        pause queued
                                                    </Badge>
                                                )}
                                            </Row>
                                        </Column>
                                    </Card>
                                ))}
                            </Column>
                        )}
                    </Column>
                )}
            </Column>
        </Card>
    );
    const historyCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="xl"
            className={styles.sectionCard}
        >
            <Column gap="8" id="raven-history">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            History
                        </Text>
                        <Heading as="h3" variant="heading-strong-l">
                            Finished and interrupted runs
                        </Heading>
                    </Column>
                    <Button variant="secondary" disabled={historyLoading} onClick={() => void loadHistory()}>
                        Refresh
                    </Button>
                </Row>
                {historyError && (
                    <Text onBackground="danger-strong" variant="body-default-xs">
                        {historyError}
                    </Text>
                )}
                {historyLoading && (
                    <Row fillWidth horizontal="center" paddingY="12">
                        <Spinner/>
                    </Row>
                )}
                {!historyLoading && historyViews.length === 0 && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        No history yet.
                    </Text>
                )}
                {!historyLoading && historyViews.length > 0 && (
                    <Row
                        fillWidth
                        gap="12"
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                            alignItems: "stretch",
                        }}
                    >
                        {historyViews.map((task) => (
                            <Card
                                key={task.key}
                                fillWidth
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="m"
                                radius="l"
                                className={styles.downloadCard}
                            >
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4" style={{minWidth: 0}}>
                                            <Text variant="body-strong-s" wrap="balance">
                                                {task.titleName}
                                            </Text>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                {task.taskType || "download job"}
                                            </Text>
                                        </Column>
                                        <Badge background={statusBadgeBackground(task.statusRaw)}>
                                            {task.statusRaw}
                                        </Badge>
                                    </Row>

                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background="neutral-alpha-weak">
                                            done {task.completed}/{task.total || "?"}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            new {task.newChapters.length}
                                        </Badge>
                                        <Badge background="neutral-alpha-weak">
                                            missing {task.missingChapters.length}
                                        </Badge>
                                    </Row>

                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        Queued: {task.queuedAtLabel || "n/a"}
                                    </Text>
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        Updated: {task.updatedAtLabel || "n/a"}
                                    </Text>
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        Completed: {task.completedAtLabel || "n/a"}
                                    </Text>

                                    {task.remaining.length > 0 && (
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Remaining queue: {formatTaskListPreview(task.remaining, 6)}
                                        </Text>
                                    )}

                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        Recovery: {task.recovered ? "Recovered" : "Direct"}{task.recoveryState ? ` - ${task.recoveryState}` : ""}
                                    </Text>

                                    <Text
                                        onBackground={task.errorMessage ? "danger-strong" : "neutral-weak"}
                                        variant="body-default-xs"
                                        wrap="balance"
                                    >
                                        {task.errorMessage || "No error recorded."}
                                    </Text>
                                </Column>
                            </Card>
                        ))}
                    </Row>
                )}
            </Column>
        </Card>
    );

    return (
        <SetupModeGate>
            <AuthGate requiredPermission="download_management"
                      deniedMessage="Downloads access requires Download management permission.">
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    paddingX="16"
                    style={{maxWidth: "var(--moon-page-max-width, 116rem)"}}
                    className={styles.pageShell}
                    m={{style: {paddingInline: "24px"}}}
                >
                    <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                Downloads
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Queue new titles, monitor active downloads, and review Raven history.
                            </Text>
                        </Column>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="primary" href="/downloads/add">
                                Add download
                            </Button>
                            <Button variant="secondary" onClick={() => void checkLibraryForNewChapters()}
                                    disabled={syncingLibrary}>
                                {syncingLibrary ? "Checking..." : "Check new/missing"}
                            </Button>
                            <Button variant="secondary" onClick={() => void refreshAll()}>
                                Refresh
                            </Button>
                            <Button variant="secondary" href="/libraries">
                                Open library
                            </Button>
                        </Row>
                    </Row>

                    {taskShowcaseCard}

                    <Row
                        fillWidth
                        gap="16"
                        style={{
                            display: "grid",
                            gridTemplateColumns: "minmax(0, 1.25fr) minmax(min(100%, 21rem), 0.85fr)",
                            alignItems: "start",
                        }}
                        m={{style: {gridTemplateColumns: "1fr"}}}
                    >
                        {activeDownloadsCard}
                        {workersCard}
                    </Row>

                    {historyCard}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
