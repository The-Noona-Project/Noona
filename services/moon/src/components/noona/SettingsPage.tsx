"use client";

import {useEffect, useMemo, useState} from "react";
import {Badge, Button, Card, Column, Heading, Input, Line, Row, Spinner, Text} from "@once-ui-system/core";
import {SetupModeGate} from "./SetupModeGate";
import {AuthGate} from "./AuthGate";

type DownloadNamingSettings = {
    titleTemplate?: string | null;
    chapterTemplate?: string | null;
    pageTemplate?: string | null;
    pagePad?: number | null;
    chapterPad?: number | null;
    error?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const normalizeNumber = (value: unknown): number | null => {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(n) ? n : null;
};

export function SettingsPage() {
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);

    const [titleTemplate, setTitleTemplate] = useState("{title}");
    const [chapterTemplate, setChapterTemplate] = useState("Chapter {chapter} [Pages {pages} {domain} - Noona].cbz");
    const [pageTemplate, setPageTemplate] = useState("{page_padded}{ext}");
    const [pagePad, setPagePad] = useState("3");
    const [chapterPad, setChapterPad] = useState("4");

    const tokens = useMemo(
        () => [
            "{title}",
            "{type}",
            "{type_slug}",
            "{chapter}",
            "{chapter_padded}",
            "{pages}",
            "{domain}",
            "{page}",
            "{page_padded}",
            "{ext}",
        ],
        [],
    );

    const load = async () => {
        setLoading(true);
        setError(null);
        setMessage(null);

        try {
            const res = await fetch("/api/noona/settings/downloads/naming", {cache: "no-store"});
            const json = (await res.json().catch(() => null)) as DownloadNamingSettings | null;

            if (!res.ok) {
                const msg = typeof json?.error === "string" && json.error.trim()
                    ? json.error.trim()
                    : `Failed to load settings (HTTP ${res.status}).`;
                throw new Error(msg);
            }

            setTitleTemplate(normalizeString(json?.titleTemplate).trim() || "{title}");
            setChapterTemplate(
                normalizeString(json?.chapterTemplate).trim() || "Chapter {chapter} [Pages {pages} {domain} - Noona].cbz",
            );
            setPageTemplate(normalizeString(json?.pageTemplate).trim() || "{page_padded}{ext}");

            const loadedPagePad = normalizeNumber(json?.pagePad);
            const loadedChapterPad = normalizeNumber(json?.chapterPad);
            setPagePad(String(loadedPagePad && loadedPagePad > 0 ? Math.floor(loadedPagePad) : 3));
            setChapterPad(String(loadedChapterPad && loadedChapterPad > 0 ? Math.floor(loadedChapterPad) : 4));
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setError(msg);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const save = async () => {
        setSaving(true);
        setError(null);
        setMessage(null);

        try {
            const res = await fetch("/api/noona/settings/downloads/naming", {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    titleTemplate,
                    chapterTemplate,
                    pageTemplate,
                    pagePad: Number(pagePad),
                    chapterPad: Number(chapterPad),
                }),
            });

            const json = (await res.json().catch(() => null)) as DownloadNamingSettings | null;
            if (!res.ok) {
                const msg = typeof json?.error === "string" && json.error.trim()
                    ? json.error.trim()
                    : `Failed to save settings (HTTP ${res.status}).`;
                throw new Error(msg);
            }

            setMessage("Saved settings.");
        } catch (error_) {
            const msg = error_ instanceof Error ? error_.message : String(error_);
            setError(msg);
        } finally {
            setSaving(false);
        }
    };

    return (
        <SetupModeGate>
            <AuthGate>
                <Column maxWidth="l" horizontal="center" gap="16" paddingY="24">
                    <Row fillWidth horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Heading variant="display-strong-s" wrap="balance">
                                Settings
                            </Heading>
                            <Text onBackground="neutral-weak" wrap="balance">
                                Configure Noona download behavior and naming.
                            </Text>
                        </Column>
                        <Row gap="12" style={{flexWrap: "wrap"}}>
                            <Button variant="secondary" disabled={loading} onClick={() => void load()}>
                                Refresh
                            </Button>
                            <Button variant="primary" disabled={saving || loading} onClick={() => void save()}>
                                {saving ? "Saving..." : "Save"}
                            </Button>
                        </Row>
                    </Row>

                    {error && (
                        <Text onBackground="danger-strong" variant="body-default-xs">
                            {error}
                        </Text>
                    )}
                    {message && (
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            {message}
                        </Text>
                    )}

                    {loading && (
                        <Row fillWidth horizontal="center" paddingY="32">
                            <Spinner/>
                        </Row>
                    )}

                    {!loading && (
                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                            <Column gap="16">
                                <Row gap="8" vertical="center">
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        Downloads
                                    </Badge>
                                    <Heading as="h2" variant="heading-strong-l">
                                        Naming schema
                                    </Heading>
                                </Row>

                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    Available tokens: {tokens.join(" ")}
                                </Text>

                                <Line background="neutral-alpha-weak"/>

                                <Column gap="12">
                                    <Input
                                        id="titleTemplate"
                                        name="titleTemplate"
                                        label="Title folder template"
                                        value={titleTemplate}
                                        onChange={(e) => setTitleTemplate(e.target.value)}
                                    />
                                    <Input
                                        id="chapterTemplate"
                                        name="chapterTemplate"
                                        label="Chapter file template (.cbz)"
                                        value={chapterTemplate}
                                        onChange={(e) => setChapterTemplate(e.target.value)}
                                    />
                                    <Input
                                        id="pageTemplate"
                                        name="pageTemplate"
                                        label="Page file template"
                                        value={pageTemplate}
                                        onChange={(e) => setPageTemplate(e.target.value)}
                                    />

                                    <Row gap="12" style={{flexWrap: "wrap"}}>
                                        <Input
                                            id="pagePad"
                                            name="pagePad"
                                            label="Page padding"
                                            type="number"
                                            value={pagePad}
                                            onChange={(e) => setPagePad(e.target.value)}
                                        />
                                        <Input
                                            id="chapterPad"
                                            name="chapterPad"
                                            label="Chapter padding"
                                            type="number"
                                            value={chapterPad}
                                            onChange={(e) => setChapterPad(e.target.value)}
                                        />
                                    </Row>
                                </Column>
                            </Column>
                        </Card>
                    )}
                </Column>
            </AuthGate>
        </SetupModeGate>
    );
}

