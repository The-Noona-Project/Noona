"use client";

import {useEffect, useMemo, useState} from "react";
import {useRouter} from "next/navigation";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
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

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

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

    const fileCount = files?.files?.length ?? 0;
    const coverUrl = normalizeString(title?.coverUrl).trim();
    const mediaType = normalizeString(title?.type).trim();

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

    const load = async () => {
        if (!normalizedUuid) return;

        setLoading(true);
        setError(null);
        setTitle(null);
        setFiles(null);
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
                <AuthGate>
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
            <AuthGate>
                <Column maxWidth="l" horizontal="center" gap="16" paddingY="24">
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
                        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
                            Refresh
                        </Button>
                    </Row>
                </Row>

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
