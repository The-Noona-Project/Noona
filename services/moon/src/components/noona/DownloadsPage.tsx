"use client";

import {useCallback, useEffect, useEffectEvent, useMemo, useState} from "react";
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
    lastUpdated?: number | null;
};

type RavenDownloadSummary = {
    activeDownloads?: number;
    maxThreads?: number;
    threadRateLimitsKbps?: number[] | null;
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
    if (status === "recovering" || status === "downloading") return "brand-alpha-weak";
    return "neutral-alpha-weak";
};
const progressBarBackground = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    if (status === "completed") return "success-alpha-medium";
    if (status === "failed" || status === "interrupted") return "danger-alpha-medium";
    return "brand-alpha-medium";
};
const truncateLabel = (value: string, limit = 24): string =>
    value.length > limit ? `${value.slice(0, Math.max(1, limit - 1)).trim()}...` : value;
const isTerminalStatus = (statusRaw: string) => {
    const status = statusRaw.trim().toLowerCase();
    return status === "completed"
        || status === "failed"
        || status === "error"
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
        if (status === "completed") return 4;
        if (status === "failed" || status === "error") return 5;
        return 6;
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
    const [taskSlideIndex, setTaskSlideIndex] = useState(0);

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
    const currentTaskSlide = currentTaskDeckViews[taskSlideIndex] ?? null;
    const advanceTaskSlide = useCallback((direction: number) => {
        if (currentTaskDeckViews.length < 2) {
            return;
        }

        setTaskSlideIndex((previous) => {
            const next = previous + direction;
            return (next + currentTaskDeckViews.length) % currentTaskDeckViews.length;
        });
    }, [currentTaskDeckViews.length]);

    useEffect(() => {
        if (taskSlideIndex < currentTaskDeckViews.length) {
            return;
        }
        setTaskSlideIndex(0);
    }, [currentTaskDeckViews.length, taskSlideIndex]);

    useEffect(() => {
        if (currentTaskDeckViews.length < 2) {
            return;
        }

        const interval = window.setInterval(() => {
            advanceTaskSlide(1);
        }, 5200);

        return () => {
            window.clearInterval(interval);
        };
    }, [advanceTaskSlide, currentTaskDeckViews.length]);

    const taskShowcaseCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="l"
            className={`${styles.sectionCard} ${styles.showcaseCard}`}
        >
            <Column gap="16">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4" style={{minWidth: 0}}>
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Current Raven tasks
                        </Text>
                        <Heading as="h2" variant="heading-strong-l">
                            {normalizeString(summary?.statusText).trim() || "Raven live deck"}
                        </Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            Auto-rotating deck for live Raven work, including recovered tasks restored from cache.
                        </Text>
                    </Column>
                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        <Badge
                            background={statusBadgeBackground(currentTaskSlide?.statusRaw || normalizeString(summary?.state).trim() || "idle")}
                            onBackground="neutral-strong"
                        >
                            {currentTaskSlide?.statusRaw || normalizeString(summary?.state).trim() || "idle"}
                        </Badge>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            live tasks: {currentTaskDeckViews.length}
                        </Badge>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            active downloads: {activeTaskViews.length}
                        </Badge>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            workers: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                        </Badge>
                    </Row>
                </Row>

                {currentTaskDeckViews.length > 0 ? (
                    <>
                        <div className={styles.taskDeckViewport}>
                            <div className={styles.taskDeckTrack}
                                 style={{transform: `translateX(-${taskSlideIndex * 100}%)`}}>
                                {currentTaskDeckViews.map((task, index) => (
                                    <section
                                        key={task.key}
                                        className={styles.taskDeckSlide}
                                        aria-hidden={index !== taskSlideIndex}
                                    >
                                        <div className={styles.taskSlideGrid}>
                                            <div className={styles.taskHeroPanel}>
                                                <Column gap="12">
                                                    <Row horizontal="between" vertical="center" gap="12"
                                                         style={{flexWrap: "wrap"}}>
                                                        <Column gap="4" style={{minWidth: 0}}>
                                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                                Task {index + 1} of {currentTaskDeckViews.length}
                                                            </Text>
                                                            <Heading as="h3" variant="heading-strong-l" wrap="balance">
                                                                {task.titleName}
                                                            </Heading>
                                                        </Column>
                                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                                            <Badge background={statusBadgeBackground(task.statusRaw)}
                                                                   onBackground="neutral-strong">
                                                                {task.statusRaw}
                                                            </Badge>
                                                            <Badge background="neutral-alpha-weak"
                                                                   onBackground="neutral-strong">
                                                                chapters: {task.completed}/{task.total || "?"}
                                                            </Badge>
                                                            {task.remaining.length > 0 && (
                                                                <Badge background="neutral-alpha-weak"
                                                                       onBackground="neutral-strong">
                                                                    remaining: {task.remaining.length}
                                                                </Badge>
                                                            )}
                                                            {task.recovered && (
                                                                <Badge background="brand-alpha-weak"
                                                                       onBackground="neutral-strong">
                                                                    recovered
                                                                </Badge>
                                                            )}
                                                        </Row>
                                                    </Row>

                                                    {(task.message || task.current) && (
                                                        <Column gap="4">
                                                            {task.message && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-s" wrap="balance">
                                                                    {task.message}
                                                                </Text>
                                                            )}
                                                            {task.current && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs" wrap="balance">
                                                                    Current chapter: {task.current}
                                                                </Text>
                                                            )}
                                                        </Column>
                                                    )}

                                                    {task.errorMessage && (
                                                        <Text onBackground="danger-strong" variant="body-default-xs"
                                                              wrap="balance">
                                                            {task.errorMessage}
                                                        </Text>
                                                    )}

                                                    <Row
                                                        fillWidth
                                                        background="neutral-alpha-weak"
                                                        radius="l"
                                                        className={styles.progressTrackLarge}
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
                                            </div>
                                            <div className={styles.taskInsetStack}>
                                                <Card
                                                    fillWidth
                                                    background="surface"
                                                    border="neutral-alpha-weak"
                                                    padding="m"
                                                    radius="l"
                                                    className={styles.taskInsetCard}
                                                >
                                                    <Column gap="8">
                                                        <Text variant="label-default-s" onBackground="neutral-weak">
                                                            Remaining queue
                                                        </Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {task.remaining.length > 0
                                                                ? formatTaskListPreview(task.remaining, 12)
                                                                : "No remaining chapters."}
                                                        </Text>
                                                    </Column>
                                                </Card>
                                                <Card
                                                    fillWidth
                                                    background="surface"
                                                    border="neutral-alpha-weak"
                                                    padding="m"
                                                    radius="l"
                                                    className={styles.taskInsetCard}
                                                >
                                                    <Column gap="8">
                                                        <Text variant="label-default-s" onBackground="neutral-weak">
                                                            Discovery split
                                                        </Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {task.newChapters.length > 0
                                                                ? `New: ${formatTaskListPreview(task.newChapters, 10)}`
                                                                : "No newly discovered chapters in this task."}
                                                        </Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {task.missingChapters.length > 0
                                                                ? `Missing: ${formatTaskListPreview(task.missingChapters, 10)}`
                                                                : "No missing chapters in this task."}
                                                        </Text>
                                                    </Column>
                                                </Card>
                                            </div>
                                        </div>
                                    </section>
                                ))}
                            </div>
                        </div>

                        <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                {currentTaskDeckViews.length > 1
                                    ? "The deck advances automatically. Use the slide controls to focus a different task."
                                    : "Raven currently has one task in focus."}
                            </Text>
                            {currentTaskDeckViews.length > 1 && (
                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    <Button size="s" variant="secondary" onClick={() => advanceTaskSlide(-1)}>
                                        Back
                                    </Button>
                                    {currentTaskDeckViews.map((task, index) => (
                                        <Button
                                            key={`task-slide-${task.key}`}
                                            size="s"
                                            variant={index === taskSlideIndex ? "primary" : "secondary"}
                                            onClick={() => setTaskSlideIndex(index)}
                                        >
                                            {truncateLabel(task.titleName, 16)}
                                        </Button>
                                    ))}
                                    <Button size="s" variant="secondary" onClick={() => advanceTaskSlide(1)}>
                                        Next
                                    </Button>
                                </Row>
                            )}
                        </Row>
                    </>
                ) : (
                    <div className={styles.taskHeroPanel}>
                        <Column gap="8">
                            <Heading as="h3" variant="heading-strong-l">
                                Raven is idle
                            </Heading>
                            <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                Queue a title or run a library sync and this deck will become a live Raven presentation.
                            </Text>
                        </Column>
                    </div>
                )}
            </Column>
        </Card>
    );
    const activeDownloadsCard = (
        <Card
            fillWidth
            background="surface"
            border="neutral-alpha-weak"
            padding="l"
            radius="l"
            className={styles.sectionCard}
        >
            <Column gap="12">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Active downloads
                        </Text>
                        <Heading as="h2" variant="heading-strong-l">
                            Live queue cards
                        </Heading>
                    </Column>
                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            {activeTaskViews.length} live
                        </Badge>
                        <Button variant="secondary" onClick={() => void pollDownloads()}>
                            Refresh status
                        </Button>
                    </Row>
                </Row>

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
                    <div className={styles.activeGrid}>
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
                                        <Text variant="heading-default-s" wrap="balance">
                                            {task.titleName}
                                        </Text>
                                        <Badge background={statusBadgeBackground(task.statusRaw)}
                                               onBackground="neutral-strong">
                                            {task.statusRaw}
                                        </Badge>
                                    </Row>

                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            {task.completed}/{task.total || "?"}
                                        </Badge>
                                        {task.taskType && (
                                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                {task.taskType}
                                            </Badge>
                                        )}
                                        {task.remaining.length > 0 && (
                                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                {task.remaining.length} left
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
                                            Remaining: {formatTaskListPreview(task.remaining, 8)}
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
                    </div>
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
            radius="l"
            className={styles.sectionCard}
        >
            <Column gap="8">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Download workers
                        </Text>
                        <Heading as="h3" variant="heading-strong-l">
                            Worker lanes
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
                    <Row gap="8" style={{flexWrap: "wrap"}}>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            active: {activeTaskViews.length}
                        </Badge>
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            max threads: {typeof summary?.maxThreads === "number" ? summary.maxThreads : "unknown"}
                        </Badge>
                        {Array.isArray(summary?.threadRateLimitsKbps) && summary.threadRateLimitsKbps.map((limit, index) => (
                            <Badge key={`worker-${index}`} background="neutral-alpha-weak"
                                   onBackground="neutral-strong">
                                worker {index + 1}: {typeof limit === "number" && limit > 0 ? `${limit} KB/s` : "unlimited"}
                            </Badge>
                        ))}
                    </Row>
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
            radius="l"
            className={styles.sectionCard}
        >
            <Column gap="8" id="raven-history">
                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Download history
                        </Text>
                        <Heading as="h3" variant="heading-strong-l">
                            Completed and interrupted jobs
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
                    <div className={styles.historyGrid}>
                        {historyViews.map((task) => (
                            <Card
                                key={task.key}
                                fillWidth
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="m"
                                radius="l"
                                className={styles.historyCard}
                            >
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Text variant="heading-default-s" wrap="balance">
                                            {task.titleName}
                                        </Text>
                                        <Badge background={statusBadgeBackground(task.statusRaw)}
                                               onBackground="neutral-strong">
                                            {task.statusRaw}
                                        </Badge>
                                    </Row>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            chapters: {task.completed}/{task.total || "?"}
                                        </Badge>
                                        {task.recovered && (
                                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                                recovered
                                            </Badge>
                                        )}
                                    </Row>
                                    <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                        {task.completedAtLabel
                                            ? `Completed: ${task.completedAtLabel}`
                                            : task.updatedAtLabel
                                                ? `Last update: ${task.updatedAtLabel}`
                                                : "No completion stamp recorded."}
                                    </Text>
                                    {task.errorMessage && (
                                        <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                            {task.errorMessage}
                                        </Text>
                                    )}
                                </Column>
                            </Card>
                        ))}
                    </div>
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

                    {(syncLibraryError || syncLibraryMessage) && (
                        <Card
                            fillWidth
                            background="surface"
                            border={syncLibraryError ? "danger-alpha-weak" : "neutral-alpha-weak"}
                            padding="m"
                            radius="l"
                            className={styles.sectionCard}
                        >
                            <Text
                                variant="body-default-xs"
                                onBackground={syncLibraryError ? "danger-strong" : "neutral-weak"}
                                wrap="balance"
                            >
                                {syncLibraryError || syncLibraryMessage}
                            </Text>
                        </Card>
                    )}

                    {taskShowcaseCard}

                    {activeDownloadsCard}

                    {workersCard}

                    {historyCard}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
