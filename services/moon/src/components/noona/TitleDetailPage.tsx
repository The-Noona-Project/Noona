"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import {buildKavitaSeriesUrl, fetchManagedServiceHostUrl} from "@/utils/kavitaLinks";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type RavenTitle = {
    title?: string | null;
    titleName?: string | null;
    uuid?: string | null;
    sourceUrl?: string | null;
    lastDownloaded?: string | null;
    lastDownloadedAt?: string | null;
    chapterCount?: number | null;
    chaptersDownloaded?: number | null;
    downloadPath?: string | null;
    summary?: string | null;
    coverUrl?: string | null;
    type?: string | null;
    downloadedChapterNumbers?: string[] | null;
};

type TitleFile = {
    name: string;
    sizeBytes: number;
    modifiedAt?: string | null;
    modifiedAtMs?: number | null;
};

type TitleFilesResponse = {
    uuid: string;
    title?: string | null;
    files: TitleFile[];
};

type TitleSyncResponse = {
    status?: string | null;
    message?: string | null;
    totalQueued?: number | null;
    newChaptersQueued?: number | null;
    missingChaptersQueued?: number | null;
    latestChapter?: string | null;
    previousLastDownloaded?: string | null;
    currentLastDownloaded?: string | null;
    sourceChapterCount?: number | null;
    queuedChapters?: string[] | null;
    newChapterNumbers?: string[] | null;
    missingChapterNumbers?: string[] | null;
    downloadedChapterNumbers?: string[] | null;
};

type RavenDownloadTask = {
    taskId?: string | null;
    title?: string | null;
    titleUuid?: string | null;
    status?: string | null;
    currentChapter?: string | null;
    totalChapters?: number | null;
    completedChapters?: number | null;
    message?: string | null;
    recoveredFromCache?: boolean | null;
    queuedChapterNumbers?: string[] | null;
    remainingChapterNumbers?: string[] | null;
    newChapterNumbers?: string[] | null;
    missingChapterNumbers?: string[] | null;
};

type RavenTaskSummary = {
    currentTask?: RavenDownloadTask | null;
};

type KavitaSeriesResult = {
    seriesId?: number | null;
    libraryId?: number | null;
    name?: string | null;
    originalName?: string | null;
    localizedName?: string | null;
    libraryName?: string | null;
    aliases?: string[] | null;
    url?: string | null;
};

type KavitaSearchResponse = {
    baseUrl?: string | null;
    series?: KavitaSeriesResult[] | null;
    error?: string;
};

type KavitaMetadataMatch = {
    provider?: string | null;
    title?: string | null;
    summary?: string | null;
    score?: number | null;
    coverImageUrl?: string | null;
    aniListId?: number | string | null;
    malId?: number | string | null;
    cbrId?: number | string | null;
};

type KavitaMetadataResponse = {
    seriesId?: number | null;
    matches?: KavitaMetadataMatch[] | null;
    error?: string;
};

type KavitaMetadataApplyResponse = {
    success?: boolean | null;
    seriesId?: number | null;
    message?: string | null;
    coverSync?: {
        status?: string | null;
        message?: string | null;
    } | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const normalizeStringList = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.map((entry) => normalizeString(entry).trim()).filter(Boolean)
        : [];

const normalizeKavitaProviderId = (value: unknown): string | null => {
    if (value == null) return null;
    const normalized = String(value).trim();
    return normalized || null;
};

const selectPreferredKavitaSeries = (series: KavitaSeriesResult[], titleName: string) => {
    const normalizedTitle = normalizeString(titleName).trim().toLowerCase();
    if (!normalizedTitle) {
        return series[0] ?? null;
    }

    const exact = series.find((entry) => normalizeString(entry?.name).trim().toLowerCase() === normalizedTitle);
    if (exact) {
        return exact;
    }

    const aliasExact = series.find((entry) =>
        Array.isArray(entry?.aliases) && entry.aliases.some((alias) => normalizeString(alias).trim().toLowerCase() === normalizedTitle),
    );
    if (aliasExact) {
        return aliasExact;
    }

    return series[0] ?? null;
};

const formatBytes = (value: number | null | undefined) => {
    const bytes = typeof value === "number" && Number.isFinite(value) ? value : 0;
    const units = ["B", "KB", "MB", "GB"];
    let index = 0;
    let current = bytes;
    while (current >= 1024 && index < units.length - 1) {
        current /= 1024;
        index += 1;
    }
    return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

export function TitleDetailPage({uuid}: { uuid: string }) {
    const router = useRouter();
    const normalizedUuid = normalizeString(uuid).trim();

    const [title, setTitle] = useState<RavenTitle | null>(null);
    const [files, setFiles] = useState<TitleFilesResponse | null>(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [editTitle, setEditTitle] = useState("");
    const [editSourceUrl, setEditSourceUrl] = useState("");
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [deletingFiles, setDeletingFiles] = useState(false);
    const [deleteFilesError, setDeleteFilesError] = useState<string | null>(null);
    const [deleteFilesMessage, setDeleteFilesMessage] = useState<string | null>(null);
    const [syncingTitle, setSyncingTitle] = useState(false);
    const [syncTitleMessage, setSyncTitleMessage] = useState<string | null>(null);
    const [syncTitleError, setSyncTitleError] = useState<string | null>(null);
    const [syncResult, setSyncResult] = useState<TitleSyncResponse | null>(null);
    const [currentTask, setCurrentTask] = useState<RavenDownloadTask | null>(null);
    const [kavitaSearchLoading, setKavitaSearchLoading] = useState(false);
    const [kavitaSearchError, setKavitaSearchError] = useState<string | null>(null);
    const [kavitaSeries, setKavitaSeries] = useState<KavitaSeriesResult[]>([]);
    const [managedKavitaBaseUrl, setManagedKavitaBaseUrl] = useState<string | null>(null);
    const [selectedKavitaSeriesId, setSelectedKavitaSeriesId] = useState<number | null>(null);
    const [kavitaMetadataLoading, setKavitaMetadataLoading] = useState(false);
    const [kavitaMetadataError, setKavitaMetadataError] = useState<string | null>(null);
    const [kavitaMetadataMessage, setKavitaMetadataMessage] = useState<string | null>(null);
    const [kavitaMetadataMatches, setKavitaMetadataMatches] = useState<KavitaMetadataMatch[]>([]);
    const [kavitaMetadataApplyingId, setKavitaMetadataApplyingId] = useState<string | null>(null);

    const fileCount = files?.files?.length ?? 0;
    const coverUrl = normalizeString(title?.coverUrl).trim();
    const mediaType = normalizeString(title?.type).trim();
    const currentTitleName = normalizeString(title?.title ?? title?.titleName).trim();
    const downloadedChapterNumbers = useMemo(
        () => normalizeStringList(title?.downloadedChapterNumbers),
        [title],
    );
    const selectedKavitaSeries = useMemo(
        () => kavitaSeries.find((entry) => typeof entry?.seriesId === "number" && entry.seriesId === selectedKavitaSeriesId) ?? null,
        [kavitaSeries, selectedKavitaSeriesId],
    );
    const selectedKavitaSeriesUrl = useMemo(
        () =>
            buildKavitaSeriesUrl({
                baseUrl: managedKavitaBaseUrl,
                libraryId: selectedKavitaSeries?.libraryId,
                seriesId: selectedKavitaSeries?.seriesId,
                fallbackUrl: selectedKavitaSeries?.url,
            }),
        [managedKavitaBaseUrl, selectedKavitaSeries],
    );

    const latestFileTimestamp = useMemo(() => {
        const list = files?.files ?? [];
        const best = list.reduce<number | null>((acc, entry) => {
            const ms = typeof entry.modifiedAtMs === "number" && Number.isFinite(entry.modifiedAtMs) ? entry.modifiedAtMs : null;
            if (ms == null) return acc;
            if (acc == null) return ms;
            return ms > acc ? ms : acc;
        }, null);
        return best != null ? new Date(best).toISOString() : null;
    }, [files]);
    const syncQueuedChapters = useMemo(() => normalizeStringList(syncResult?.queuedChapters), [syncResult]);
    const syncNewChapterNumbers = useMemo(() => normalizeStringList(syncResult?.newChapterNumbers), [syncResult]);
    const syncMissingChapterNumbers = useMemo(() => normalizeStringList(syncResult?.missingChapterNumbers), [syncResult]);
    const syncDownloadedChapterNumbers = useMemo(() => {
        const fromResult = normalizeStringList(syncResult?.downloadedChapterNumbers);
        return fromResult.length > 0 ? fromResult : downloadedChapterNumbers;
    }, [syncResult, downloadedChapterNumbers]);

    const load = async () => {
        if (!normalizedUuid) return;

        setLoading(true);
        setError(null);
        setTitle(null);
        setFiles(null);
        setCurrentTask(null);
        setSelectedFiles(new Set());
        setDeleteFilesError(null);
        setDeleteFilesMessage(null);

        try {
            const [titleRes, filesRes] = await Promise.all([
                fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}`, {cache: "no-store"}),
                fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}/files`, {cache: "no-store"}),
            ]);

            const titleJson = (await titleRes.json().catch(() => null)) as unknown;
            if (!titleRes.ok) {
                const message =
                    titleJson && typeof titleJson === "object" && "error" in titleJson && typeof (titleJson as {
                        error?: unknown
                    }).error === "string"
                        ? String((titleJson as { error?: unknown }).error)
                        : `Failed to load title (HTTP ${titleRes.status}).`;
                throw new Error(message);
            }

            const filesJson = (await filesRes.json().catch(() => null)) as unknown;
            if (!filesRes.ok) {
                const message =
                    filesJson && typeof filesJson === "object" && "error" in filesJson && typeof (filesJson as {
                        error?: unknown
                    }).error === "string"
                        ? String((filesJson as { error?: unknown }).error)
                        : `Failed to load files (HTTP ${filesRes.status}).`;
                throw new Error(message);
            }

            const normalizedTitle = (titleJson && typeof titleJson === "object" ? (titleJson as RavenTitle) : {}) as RavenTitle;
            const normalizedFiles = (filesJson && typeof filesJson === "object" ? (filesJson as TitleFilesResponse) : null) as TitleFilesResponse | null;

            setTitle(normalizedTitle);
            setFiles(normalizedFiles);
            setEditTitle(normalizeString(normalizedTitle.title ?? normalizedTitle.titleName));
            setEditSourceUrl(normalizeString(normalizedTitle.sourceUrl));
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setError(message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, [normalizedUuid]);

    useEffect(() => {
        let cancelled = false;

        const loadManagedKavitaUrl = async () => {
            const hostUrl = await fetchManagedServiceHostUrl("noona-kavita");
            if (!cancelled) {
                setManagedKavitaBaseUrl(hostUrl);
            }
        };

        void loadManagedKavitaUrl();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!normalizedUuid) {
            return;
        }

        let cancelled = false;
        let intervalId: number | null = null;

        const loadCurrentTask = async () => {
            try {
                const response = await fetch("/api/noona/raven/downloads/summary", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as RavenTaskSummary | null;
                if (!response.ok || cancelled) {
                    return;
                }

                const task = payload?.currentTask;
                const taskUuid = normalizeString(task?.titleUuid).trim();
                const taskTitle = normalizeString(task?.title).trim().toLowerCase();
                const matchesUuid = taskUuid && taskUuid === normalizedUuid;
                const matchesTitle = currentTitleName && taskTitle === currentTitleName.toLowerCase();

                setCurrentTask(matchesUuid || matchesTitle ? (task ?? null) : null);
            } catch {
                if (!cancelled) {
                    setCurrentTask(null);
                }
            }
        };

        void loadCurrentTask();
        intervalId = window.setInterval(() => {
            void loadCurrentTask();
        }, 3000);

        return () => {
            cancelled = true;
            if (intervalId != null) {
                window.clearInterval(intervalId);
            }
        };
    }, [normalizedUuid, currentTitleName]);

    const loadKavitaSeries = async (query: string) => {
        const normalizedQuery = normalizeString(query).trim();
        if (!normalizedQuery) {
            setKavitaSeries([]);
            setSelectedKavitaSeriesId(null);
            setKavitaSearchError(null);
            return;
        }

        setKavitaSearchLoading(true);
        setKavitaSearchError(null);
        setKavitaMetadataError(null);
        setKavitaMetadataMessage(null);
        setKavitaMetadataMatches([]);

        try {
            const [response, hostUrl] = await Promise.all([
                fetch(`/api/noona/portal/kavita/search?query=${encodeURIComponent(normalizedQuery)}`, {
                    cache: "no-store",
                }),
                fetchManagedServiceHostUrl("noona-kavita"),
            ]);
            const payload = (await response.json().catch(() => null)) as KavitaSearchResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Kavita search failed (HTTP ${response.status}).`);
            }

            setManagedKavitaBaseUrl(hostUrl);
            const series = Array.isArray(payload?.series) ? payload.series : [];
            const preferred = selectPreferredKavitaSeries(series, normalizedQuery);
            setKavitaSeries(series);
            setSelectedKavitaSeriesId(typeof preferred?.seriesId === "number" ? preferred.seriesId : null);
        } catch (error_) {
            setKavitaSeries([]);
            setSelectedKavitaSeriesId(null);
            setKavitaSearchError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setKavitaSearchLoading(false);
        }
    };

    const loadKavitaMetadataMatches = async () => {
        if (selectedKavitaSeriesId == null) {
            setKavitaMetadataError("Pick a Kavita title match first.");
            return;
        }

        const metadataQuery = normalizeString(currentTitleName || selectedKavitaSeries?.name).trim();
        if (!metadataQuery) {
            setKavitaMetadataError("Moon could not determine a title query for metadata matching.");
            return;
        }

        setKavitaMetadataLoading(true);
        setKavitaMetadataError(null);
        setKavitaMetadataMessage(null);

        try {
            const response = await fetch("/api/noona/portal/kavita/title-match", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    seriesId: selectedKavitaSeriesId,
                    query: metadataQuery,
                }),
            });
            const payload = (await response.json().catch(() => null)) as KavitaMetadataResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Kavita metadata lookup failed (HTTP ${response.status}).`);
            }

            setKavitaMetadataMatches(Array.isArray(payload?.matches) ? payload.matches : []);
            setKavitaMetadataMessage("Fetched metadata candidates from Kavita.");
        } catch (error_) {
            setKavitaMetadataMatches([]);
            setKavitaMetadataError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setKavitaMetadataLoading(false);
        }
    };

    const applyKavitaMetadataMatch = async (match: KavitaMetadataMatch) => {
        if (selectedKavitaSeriesId == null) {
            setKavitaMetadataError("Pick a Kavita title match first.");
            return;
        }

        const aniListId = normalizeKavitaProviderId(match.aniListId);
        const malId = normalizeKavitaProviderId(match.malId);
        const cbrId = normalizeKavitaProviderId(match.cbrId);
        if (!aniListId && !malId && !cbrId) {
            setKavitaMetadataError("The selected metadata candidate does not include any provider ids Kavita can apply.");
            return;
        }

        const applyingId = [aniListId, malId, cbrId].filter(Boolean).join(":");
        setKavitaMetadataApplyingId(applyingId);
        setKavitaMetadataError(null);
        setKavitaMetadataMessage(null);

        try {
            const response = await fetch("/api/noona/portal/kavita/title-match/apply", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    seriesId: selectedKavitaSeriesId,
                    titleUuid: normalizedUuid,
                    aniListId,
                    malId,
                    cbrId,
                }),
            });
            const payload = (await response.json().catch(() => null)) as KavitaMetadataApplyResponse | null;
            if (!response.ok) {
                throw new Error(normalizeString(payload?.error).trim() || `Kavita metadata apply failed (HTTP ${response.status}).`);
            }

            const coverSyncStatus = normalizeString(payload?.coverSync?.status).trim().toLowerCase();
            const responseMessage =
                normalizeString(payload?.coverSync?.message).trim()
                || normalizeString(payload?.message).trim()
                || "Applied the selected Kavita metadata match.";

            if (coverSyncStatus === "failed") {
                setKavitaMetadataError(responseMessage);
            } else {
                setKavitaMetadataMessage(responseMessage);
            }
        } catch (error_) {
            setKavitaMetadataError(error_ instanceof Error ? error_.message : String(error_));
        } finally {
            setKavitaMetadataApplyingId(null);
        }
    };

    useEffect(() => {
        if (!currentTitleName) {
            setKavitaSeries([]);
            setSelectedKavitaSeriesId(null);
            return;
        }

        void loadKavitaSeries(currentTitleName);
    }, [currentTitleName]);

    useEffect(() => {
        setKavitaMetadataMatches([]);
        setKavitaMetadataError(null);
        setKavitaMetadataMessage(null);
    }, [selectedKavitaSeriesId]);

    const save = async () => {
        setSaveError(null);
        setSaving(true);

        try {
            const res = await fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}`, {
                method: "PATCH",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    title: editTitle,
                    sourceUrl: editSourceUrl,
                }),
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Save failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            await load();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSaveError(message);
        } finally {
            setSaving(false);
        }
    };

    const deleteTitle = async () => {
        setDeleteError(null);
        setDeleting(true);

        try {
            const res = await fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}`, {
                method: "DELETE",
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Delete failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            router.push("/libraries");
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setDeleteError(message);
        } finally {
            setDeleting(false);
        }
    };

    const checkForNewAndMissingChapters = async () => {
        setSyncingTitle(true);
        setSyncTitleMessage(null);
        setSyncTitleError(null);
        setSyncResult(null);

        try {
            const res = await fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}/checkForNew`, {
                method: "POST",
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Check failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            const payload = json && typeof json === "object" ? (json as TitleSyncResponse) : null;
            setSyncResult(payload);
            const totalQueued = typeof payload?.totalQueued === "number" && Number.isFinite(payload.totalQueued)
                ? payload.totalQueued
                : null;
            const newCount =
                typeof payload?.newChaptersQueued === "number" && Number.isFinite(payload.newChaptersQueued)
                    ? payload.newChaptersQueued
                    : null;
            const missingCount =
                typeof payload?.missingChaptersQueued === "number" && Number.isFinite(payload.missingChaptersQueued)
                    ? payload.missingChaptersQueued
                    : null;

            const fallbackMessage = totalQueued != null && totalQueued > 0
                ? `Queued ${totalQueued} chapter(s)${newCount != null && missingCount != null ? ` (${newCount} new, ${missingCount} missing)` : ""}.`
                : "No new or missing chapters found.";
            setSyncTitleMessage(normalizeString(payload?.message).trim() || fallbackMessage);
            await load();
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setSyncTitleError(message);
        } finally {
            setSyncingTitle(false);
        }
    };

    const toggleFileSelection = (name: string) => {
        setSelectedFiles((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
        });
    };

    const selectAllFiles = () => {
        const fileList = files?.files ?? [];
        setSelectedFiles(new Set(fileList.map((entry) => entry.name)));
    };

    const clearFileSelection = () => {
        setSelectedFiles(new Set());
    };

    const deleteSelectedFiles = async (names: string[]) => {
        const normalized = names.map((entry) => normalizeString(entry).trim()).filter(Boolean);
        if (normalized.length === 0) return;

        setDeletingFiles(true);
        setDeleteFilesError(null);
        setDeleteFilesMessage(null);
        try {
            const res = await fetch(`/api/noona/raven/title/${encodeURIComponent(normalizedUuid)}/files`, {
                method: "DELETE",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({names: normalized}),
            });

            const json = (await res.json().catch(() => null)) as unknown;
            if (!res.ok) {
                const message =
                    json && typeof json === "object" && "error" in json && typeof (json as {
                        error?: unknown
                    }).error === "string"
                        ? String((json as { error?: unknown }).error)
                        : `Delete failed (HTTP ${res.status}).`;
                throw new Error(message);
            }

            setSelectedFiles((prev) => {
                const next = new Set(prev);
                for (const name of normalized) next.delete(name);
                return next;
            });
            await load();
            setDeleteFilesMessage(`Deleted ${normalized.length} file(s).`);
        } catch (error_) {
            const message = error_ instanceof Error ? error_.message : String(error_);
            setDeleteFilesError(message);
        } finally {
            setDeletingFiles(false);
        }
    };

    if (!normalizedUuid) {
        return (
            <SetupModeGate>
                <AuthGate requiredPermission="library_management"
                          deniedMessage="Library access requires Library management permission.">
                    <Column maxWidth="m" horizontal="center" gap="16" paddingY="24">
                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="8">
                                <Heading as="h2" variant="heading-strong-l">
                                    Invalid title
                                </Heading>
                                <Text onBackground="neutral-weak">Missing UUID.</Text>
                                <Button variant="primary" onClick={() => router.push("/libraries")}>
                                    Back to library
                                </Button>
                            </Column>
                        </Card>
                    </Column>
                </AuthGate>
            </SetupModeGate>
        );
    }

    return (
        <SetupModeGate>
            <AuthGate requiredPermission="library_management"
                      deniedMessage="Library access requires Library management permission.">
                <Column
                    fillWidth
                    horizontal="center"
                    gap="16"
                    paddingY="24"
                    paddingX="16"
                    style={{maxWidth: "var(--moon-page-max-width, 116rem)"}}
                    m={{style: {paddingInline: "24px"}}}
                >
                <Row fillWidth horizontal="between" vertical="center" gap="12" s={{direction: "column"}}>
                    <Row gap="16" vertical="center" style={{minWidth: 0}}>
                        {coverUrl && (
                            <img
                                src={coverUrl}
                                alt={`${normalizeString(title?.title ?? title?.titleName) || "Title"} cover`}
                                style={{
                                    width: 64,
                                    height: 96,
                                    objectFit: "cover",
                                    borderRadius: 12,
                                    border: "1px solid rgba(255,255,255,0.12)",
                                    flex: "0 0 auto",
                                }}
                                loading="lazy"
                            />
                        )}
                        <Column gap="8" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                {normalizeString(title?.title ?? title?.titleName) || "Title"}
                            </Heading>
                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                {mediaType && (
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        {mediaType}
                                    </Badge>
                                )}
                                <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                    {normalizedUuid}
                                </Badge>
                            </Row>
                        </Column>
                    </Row>
                    <Row gap="12" style={{flexWrap: "wrap"}}>
                        <Button variant="secondary" onClick={() => router.push("/libraries")}>
                            Back
                        </Button>
                        {typeof selectedKavitaSeriesUrl === "string" && selectedKavitaSeriesUrl.trim() && (
                            <Button variant="secondary"
                                    onClick={() => window.open(selectedKavitaSeriesUrl, "_blank", "noopener,noreferrer")}>
                                Open in Kavita
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            onClick={() => void checkForNewAndMissingChapters()}
                            disabled={syncingTitle || loading}
                        >
                            {syncingTitle ? "Checking..." : "Check new/missing"}
                        </Button>
                        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
                            Refresh
                        </Button>
                    </Row>
                </Row>

                    {(syncTitleError || syncTitleMessage) && (
                        <Card
                            fillWidth
                            background="surface"
                            border={syncTitleError ? "danger-alpha-weak" : "neutral-alpha-weak"}
                            padding="m"
                            radius="l"
                        >
                            <Text
                                variant="body-default-xs"
                                onBackground={syncTitleError ? "danger-strong" : "neutral-weak"}
                                wrap="balance"
                            >
                                {syncTitleError || syncTitleMessage}
                            </Text>
                        </Card>
                    )}

                {error && (
                    <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                        <Column gap="8">
                            <Heading as="h2" variant="heading-strong-l">
                                Unable to load title
                            </Heading>
                            <Text>{error}</Text>
                        </Column>
                    </Card>
                )}

                {loading && (
                    <Row fillWidth horizontal="center" paddingY="64">
                        <Spinner/>
                    </Row>
                )}

                {!loading && !error && (
                    <Column fillWidth gap="16">
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                    <Column gap="4">
                                        <Heading as="h2" variant="heading-strong-l">
                                            Sync planner
                                        </Heading>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Raven now tracks a stored chapter index for this title, so missing-chapter
                                            checks
                                            no longer depend on guessing chapter numbers from archive file names.
                                        </Text>
                                    </Column>
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        indexed chapters: {syncDownloadedChapterNumbers.length}
                                    </Badge>
                                </Row>

                                <Row
                                    fillWidth
                                    gap="12"
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                        alignItems: "start",
                                    }}
                                >
                                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m"
                                          radius="l">
                                        <Column gap="8">
                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                Library state
                                            </Text>
                                            <Row gap="8" style={{flexWrap: "wrap"}}>
                                                <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                    last
                                                    downloaded: {normalizeString(title?.lastDownloaded).trim() || "0"}
                                                </Badge>
                                                {typeof title?.chapterCount === "number" && Number.isFinite(title.chapterCount) && (
                                                    <Badge background="neutral-alpha-weak"
                                                           onBackground="neutral-strong">
                                                        source count: {title.chapterCount}
                                                    </Badge>
                                                )}
                                            </Row>
                                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                                {syncDownloadedChapterNumbers.length > 0
                                                    ? syncDownloadedChapterNumbers.join(", ")
                                                    : "No stored chapter index yet."}
                                            </Text>
                                        </Column>
                                    </Card>

                                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m"
                                          radius="l">
                                        <Column gap="8">
                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                Latest sync result
                                            </Text>
                                            {syncResult ? (
                                                <>
                                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            status: {normalizeString(syncResult.status).trim() || "unknown"}
                                                        </Badge>
                                                        <Badge background="brand-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            queued: {typeof syncResult.totalQueued === "number" ? syncResult.totalQueued : 0}
                                                        </Badge>
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            new: {syncNewChapterNumbers.length}
                                                        </Badge>
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            missing: {syncMissingChapterNumbers.length}
                                                        </Badge>
                                                    </Row>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">
                                                        {normalizeString(syncResult.message).trim() || "No sync summary was returned."}
                                                    </Text>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">
                                                        {syncQueuedChapters.length > 0
                                                            ? `Queued chapters: ${syncQueuedChapters.join(", ")}`
                                                            : "Nothing is queued from the last sync pass."}
                                                    </Text>
                                                </>
                                            ) : (
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    Run `Check new/missing` to see Raven&apos;s exact plan for this
                                                    title.
                                                </Text>
                                            )}
                                        </Column>
                                    </Card>

                                    <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m"
                                          radius="l">
                                        <Column gap="8">
                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                Live task
                                            </Text>
                                            {currentTask ? (
                                                <>
                                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                                        <Badge background="brand-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            {normalizeString(currentTask.status).trim() || "tracking"}
                                                        </Badge>
                                                        {currentTask.recoveredFromCache && (
                                                            <Badge background="brand-alpha-weak"
                                                                   onBackground="neutral-strong">
                                                                recovered
                                                            </Badge>
                                                        )}
                                                        <Badge background="neutral-alpha-weak"
                                                               onBackground="neutral-strong">
                                                            chapters: {typeof currentTask.completedChapters === "number" ? currentTask.completedChapters : 0}/
                                                            {typeof currentTask.totalChapters === "number" ? currentTask.totalChapters : "?"}
                                                        </Badge>
                                                    </Row>
                                                    {normalizeString(currentTask.currentChapter).trim() && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            Current: {normalizeString(currentTask.currentChapter).trim()}
                                                        </Text>
                                                    )}
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">
                                                        {normalizeString(currentTask.message).trim()
                                                            || "Raven is actively tracking this title."}
                                                    </Text>
                                                    <Text onBackground="neutral-weak" variant="body-default-xs"
                                                          wrap="balance">
                                                        {normalizeStringList(currentTask.remainingChapterNumbers).length > 0
                                                            ? `Remaining: ${normalizeStringList(currentTask.remainingChapterNumbers).join(", ")}`
                                                            : "No remaining chapter queue is currently cached for this title."}
                                                    </Text>
                                                </>
                                            ) : (
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    No active or cached Raven task currently matches this title.
                                                </Text>
                                            )}
                                        </Column>
                                    </Card>
                                </Row>
                            </Column>
                        </Card>

                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Overview
                                </Heading>

                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                    {typeof title?.lastDownloaded === "string" && title.lastDownloaded.trim() && (
                                        <Badge background="success-alpha-weak" onBackground="neutral-strong">
                                            last chapter: {title.lastDownloaded}
                                        </Badge>
                                    )}
                                    {mediaType && (
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            type: {mediaType}
                                        </Badge>
                                    )}
                                    {typeof title?.chapterCount === "number" && Number.isFinite(title.chapterCount) && (
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            chapters:{" "}
                                            {typeof title?.chaptersDownloaded === "number" && Number.isFinite(title.chaptersDownloaded)
                                                ? `${title.chaptersDownloaded}/${title.chapterCount}`
                                                : title.chapterCount}
                                        </Badge>
                                    )}
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        files: {fileCount}
                                    </Badge>
                                    {latestFileTimestamp && (
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            latest file: {latestFileTimestamp}
                                        </Badge>
                                    )}
                                    {typeof title?.lastDownloadedAt === "string" && title.lastDownloadedAt.trim() && (
                                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                            updated: {title.lastDownloadedAt}
                                        </Badge>
                                    )}
                                </Row>

                                {typeof title?.sourceUrl === "string" && title.sourceUrl.trim() && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Source: <SmartLink href={title.sourceUrl}>{title.sourceUrl}</SmartLink>
                                    </Text>
                                )}

                                {typeof title?.downloadPath === "string" && title.downloadPath.trim() && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        Download path: {title.downloadPath}
                                    </Text>
                                )}

                                {typeof title?.summary === "string" && title.summary.trim() && (
                                    <Text onBackground="neutral-weak" variant="body-default-s" wrap="balance">
                                        {title.summary}
                                    </Text>
                                )}
                            </Column>
                        </Card>

                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                    <Heading as="h2" variant="heading-strong-l">
                                        Kavita
                                    </Heading>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button
                                            variant="secondary"
                                            disabled={!currentTitleName || kavitaSearchLoading}
                                            onClick={() => void loadKavitaSeries(currentTitleName)}
                                        >
                                            {kavitaSearchLoading ? "Searching..." : "Refresh Kavita search"}
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            disabled={selectedKavitaSeriesId == null || kavitaMetadataLoading}
                                            onClick={() => void loadKavitaMetadataMatches()}
                                        >
                                            {kavitaMetadataLoading ? "Matching..." : "Search metadata matches"}
                                        </Button>
                                    </Row>
                                </Row>

                                {(kavitaSearchError || kavitaMetadataError || kavitaMetadataMessage) && (
                                    <Column gap="4">
                                        {kavitaSearchError && (
                                            <Text onBackground="danger-strong" variant="body-default-xs">
                                                {kavitaSearchError}
                                            </Text>
                                        )}
                                        {kavitaMetadataError && (
                                            <Text onBackground="danger-strong" variant="body-default-xs">
                                                {kavitaMetadataError}
                                            </Text>
                                        )}
                                        {kavitaMetadataMessage && (
                                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                                {kavitaMetadataMessage}
                                            </Text>
                                        )}
                                    </Column>
                                )}

                                {kavitaSeries.length === 0 && !kavitaSearchLoading && !kavitaSearchError && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        No Kavita series matches found for this title yet.
                                    </Text>
                                )}

                                {kavitaSeries.length > 0 && (
                                    <Column gap="8">
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Select the Kavita title entry Moon should use for metadata matching and
                                            direct links.
                                        </Text>
                                        {kavitaSeries.map((entry) => {
                                            const entrySeriesId = typeof entry.seriesId === "number" ? entry.seriesId : null;
                                            const selected = entrySeriesId != null && entrySeriesId === selectedKavitaSeriesId;
                                            const entryUrl = buildKavitaSeriesUrl({
                                                baseUrl: managedKavitaBaseUrl,
                                                libraryId: entry.libraryId,
                                                seriesId: entry.seriesId,
                                                fallbackUrl: entry.url,
                                            });
                                            return (
                                                <Row
                                                    key={`${entrySeriesId ?? "series"}:${entry.libraryId ?? "library"}`}
                                                    fillWidth horizontal="between" vertical="center" gap="12"
                                                    background={selected ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                    padding="12" radius="m">
                                                    <Column gap="4" style={{minWidth: 0}}>
                                                        <Text variant="body-default-s">
                                                            {normalizeString(entry.name).trim() || "Unnamed Kavita series"}
                                                        </Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {normalizeString(entry.libraryName).trim() || "Unknown library"}
                                                            {Array.isArray(entry.aliases) && entry.aliases.length > 0 ? ` • ${entry.aliases.join(", ")}` : ""}
                                                        </Text>
                                                    </Column>
                                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                                        {typeof entryUrl === "string" && entryUrl.trim() && (
                                                            <Button variant="secondary"
                                                                    onClick={() => window.open(entryUrl, "_blank", "noopener,noreferrer")}>
                                                                Open
                                                            </Button>
                                                        )}
                                                        <Button
                                                            variant={selected ? "primary" : "secondary"}
                                                            disabled={entrySeriesId == null}
                                                            onClick={() => setSelectedKavitaSeriesId(entrySeriesId)}
                                                        >
                                                            {selected ? "Selected" : "Use title"}
                                                        </Button>
                                                    </Row>
                                                </Row>
                                            );
                                        })}
                                    </Column>
                                )}

                                {kavitaMetadataMatches.length > 0 && (
                                    <Column gap="8">
                                        <Text variant="label-default-s">Metadata candidates</Text>
                                        {kavitaMetadataMatches.map((match, index) => {
                                            const matchKey = [
                                                normalizeKavitaProviderId(match.aniListId),
                                                normalizeKavitaProviderId(match.malId),
                                                normalizeKavitaProviderId(match.cbrId),
                                                String(index),
                                            ].filter(Boolean).join(":");
                                            const applying = kavitaMetadataApplyingId === matchKey;
                                            return (
                                                <Row key={matchKey} fillWidth horizontal="between" vertical="center"
                                                     gap="12" background="neutral-alpha-weak" padding="12" radius="m">
                                                    <Column gap="4" style={{minWidth: 0}}>
                                                        <Text variant="body-default-s">
                                                            {normalizeString(match.title).trim() || "Untitled metadata result"}
                                                        </Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {normalizeString(match.provider).trim() || "Unknown provider"}
                                                            {typeof match.score === "number" && Number.isFinite(match.score) ? ` • score ${match.score}` : ""}
                                                        </Text>
                                                        {normalizeString(match.summary).trim() && (
                                                            <Text onBackground="neutral-weak" variant="body-default-xs"
                                                                  wrap="balance">
                                                                {match.summary}
                                                            </Text>
                                                        )}
                                                    </Column>
                                                    <Button
                                                        variant="secondary"
                                                        disabled={applying}
                                                        onClick={() => void applyKavitaMetadataMatch(match)}
                                                    >
                                                        {applying ? "Applying..." : "Apply match"}
                                                    </Button>
                                                </Row>
                                            );
                                        })}
                                    </Column>
                                )}
                            </Column>
                        </Card>

                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Edit
                                </Heading>

                                <Input
                                    id="edit-title"
                                    name="edit-title"
                                    type="text"
                                    placeholder="Title name"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                />

                                <Input
                                    id="edit-sourceUrl"
                                    name="edit-sourceUrl"
                                    type="url"
                                    placeholder="Source URL"
                                    value={editSourceUrl}
                                    onChange={(e) => setEditSourceUrl(e.target.value)}
                                />

                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                    <Button variant="primary" disabled={saving} onClick={() => void save()}>
                                        {saving ? "Saving..." : "Save changes"}
                                    </Button>
                                    {saveError && (
                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                            {saveError}
                                        </Text>
                                    )}
                                </Row>
                            </Column>
                        </Card>

                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                    <Heading as="h2" variant="heading-strong-l">
                                        Downloaded files
                                    </Heading>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Button
                                            variant="secondary"
                                            disabled={!files || files.files.length === 0 || deletingFiles}
                                            onClick={() => selectAllFiles()}
                                        >
                                            Select all
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            disabled={selectedFiles.size === 0 || deletingFiles}
                                            onClick={() => clearFileSelection()}
                                        >
                                            Clear selection
                                        </Button>
                                        <Button
                                            variant="secondary"
                                            disabled={selectedFiles.size === 0 || deletingFiles}
                                            onClick={() => void deleteSelectedFiles(Array.from(selectedFiles))}
                                        >
                                            {deletingFiles ? "Deleting..." : `Delete selected (${selectedFiles.size})`}
                                        </Button>
                                    </Row>
                                </Row>

                                {!files && (
                                    <Text onBackground="neutral-weak">No file metadata available yet.</Text>
                                )}

                                {files && files.files.length === 0 && (
                                    <Text onBackground="neutral-weak">No downloaded files found.</Text>
                                )}

                                {files && files.files.length > 0 && (
                                    <Column gap="8">
                                        {(deleteFilesError || deleteFilesMessage) && (
                                            <Column gap="4">
                                                {deleteFilesError && (
                                                    <Text onBackground="danger-strong" variant="body-default-xs">
                                                        {deleteFilesError}
                                                    </Text>
                                                )}
                                                {deleteFilesMessage && (
                                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                                        {deleteFilesMessage}
                                                    </Text>
                                                )}
                                            </Column>
                                        )}
                                        <Line background="neutral-alpha-weak"/>
                                        {files.files.map((file) => {
                                            const modified =
                                                (typeof file.modifiedAt === "string" && file.modifiedAt.trim()) ||
                                                (typeof file.modifiedAtMs === "number" && Number.isFinite(file.modifiedAtMs)
                                                    ? new Date(file.modifiedAtMs).toISOString()
                                                    : "");
                                            const checked = selectedFiles.has(file.name);

                                            return (
                                                <Row key={file.name} horizontal="between" gap="12">
                                                    <Row gap="8" style={{minWidth: 0}}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggleFileSelection(file.name)}
                                                            aria-label={`Select ${file.name}`}
                                                        />
                                                        <Column gap="4" style={{minWidth: 0}}>
                                                            <Text variant="body-default-s" wrap="balance">
                                                                {file.name}
                                                            </Text>
                                                            {modified && (
                                                                <Text onBackground="neutral-weak"
                                                                      variant="body-default-xs">
                                                                    {modified}
                                                                </Text>
                                                            )}
                                                        </Column>
                                                    </Row>
                                                    <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                                            {formatBytes(file.sizeBytes)}
                                                        </Text>
                                                        <Button
                                                            variant="secondary"
                                                            disabled={deletingFiles}
                                                            onClick={() => void deleteSelectedFiles([file.name])}
                                                        >
                                                            Delete
                                                        </Button>
                                                    </Row>
                                                </Row>
                                            );
                                        })}
                                    </Column>
                                )}
                            </Column>
                        </Card>

                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="l" radius="l">
                            <Column gap="12">
                                <Heading as="h2" variant="heading-strong-l">
                                    Danger zone
                                </Heading>

                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    This removes the title record from the library (downloads on disk are not deleted).
                                </Text>

                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                    <Button variant="secondary" disabled={deleting} onClick={() => void deleteTitle()}>
                                        {deleting ? "Deleting..." : "Delete title"}
                                    </Button>
                                    {deleteError && (
                                        <Text onBackground="danger-strong" variant="body-default-xs">
                                            {deleteError}
                                        </Text>
                                    )}
                                </Row>
                            </Column>
                        </Card>
                    </Column>
                )}
            </Column>
            </AuthGate>
        </SetupModeGate>
    );
}
