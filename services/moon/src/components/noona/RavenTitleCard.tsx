import {Badge, Card, Column, Heading, Row, SmartLink, Text} from "@once-ui-system/core";

export type RavenTitleCardEntry = {
    title?: string | null;
    titleName?: string | null;
    uuid?: string | null;
    lastDownloaded?: string | null;
    coverUrl?: string | null;
    type?: string | null;
    chapterCount?: number | null;
    chaptersDownloaded?: number | null;
};

export const RAVEN_TITLE_CARD_WIDTH = 240;
export const RAVEN_TITLE_CARD_HEIGHT = 340;

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

type RavenTitleCardProps = {
    entry: RavenTitleCardEntry;
    clickable?: boolean;
};

export function RavenTitleCard({entry, clickable = true}: RavenTitleCardProps) {
    const uuid = normalizeString(entry.uuid);
    const title = normalizeString(entry.title ?? entry.titleName).trim() || uuid || "Untitled";
    const lastDownloaded = normalizeString(entry.lastDownloaded);
    const coverUrl = normalizeString(entry.coverUrl).trim();
    const type = normalizeString(entry.type).trim();
    const chapterCount = typeof entry.chapterCount === "number" && Number.isFinite(entry.chapterCount)
        ? entry.chapterCount
        : null;
    const chaptersDownloaded = typeof entry.chaptersDownloaded === "number" && Number.isFinite(entry.chaptersDownloaded)
        ? entry.chaptersDownloaded
        : null;
    const downloadTotal = typeof chaptersDownloaded === "number" ? chaptersDownloaded : 0;
    const chapterTotalText = typeof chapterCount === "number"
        ? `${downloadTotal}/${chapterCount}`
        : `${downloadTotal}`;
    const href = uuid ? `/libraries/${encodeURIComponent(uuid)}` : "/libraries";

    const card = (
        <Card
            background="surface"
            border="neutral-alpha-weak"
            padding="0"
            radius="l"
            fillWidth
            style={{
                position: "relative",
                overflow: "hidden",
                width: "100%",
                height: RAVEN_TITLE_CARD_HEIGHT,
            }}
        >
            {coverUrl ? (
                <img
                    src={coverUrl}
                    alt={`${title} cover`}
                    style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                    }}
                    loading="lazy"
                />
            ) : (
                <Row
                    fill
                    background="neutral-alpha-weak"
                    style={{
                        position: "absolute",
                        inset: 0,
                    }}
                />
            )}

            <Column
                fill
                style={{
                    position: "absolute",
                    inset: 0,
                    justifyContent: "space-between",
                }}
            >
                <Column
                    gap="8"
                    padding="12"
                    background="overlay"
                    style={{
                        background: "linear-gradient(180deg, rgba(0, 0, 0, 0.82) 0%, rgba(0, 0, 0, 0.15) 100%)",
                    }}
                >
                    <Row horizontal="between" vertical="center" gap="8" style={{flexWrap: "wrap"}}>
                        {type && (
                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                {type}
                            </Badge>
                        )}
                        <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                            {chapterTotalText}
                        </Badge>
                    </Row>
                    <Heading
                        as="h3"
                        variant="heading-strong-m"
                        onBackground="neutral-strong"
                        wrap="balance"
                        style={{
                            minWidth: 0,
                            lineHeight: 1.2,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {title}
                    </Heading>
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        Downloaded: {chapterTotalText}
                    </Text>
                </Column>

                <Row
                    padding="12"
                    background="overlay"
                    style={{
                        background: "linear-gradient(0deg, rgba(0, 0, 0, 0.78) 0%, rgba(0, 0, 0, 0) 100%)",
                    }}
                >
                    <Text
                        onBackground="neutral-weak"
                        variant="body-default-xs"
                        style={{
                            minWidth: 0,
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {lastDownloaded ? `Last: ${lastDownloaded}` : uuid || "No chapter metadata yet"}
                    </Text>
                </Row>
            </Column>
        </Card>
    );

    if (!clickable) {
        return (
            <Column fillWidth aria-disabled="true" style={{width: "100%"}}>
                {card}
            </Column>
        );
    }

    return (
        <SmartLink
            href={href}
            unstyled
            fillWidth
            style={{display: "block", width: "100%"}}
        >
            {card}
        </SmartLink>
    );
}
