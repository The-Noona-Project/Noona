"use client";

import {Badge, Button, Card, Column, Heading, Input, Row, SmartLink, Spinner, Text} from "@once-ui-system/core";
import styles from "./DownloadsPage.module.scss";

type ResolvedSearchOption = {
    optionIndex: number;
    title: string;
    href: string;
    coverUrl: string;
    type: string;
};

type DownloadsAddModalProps = {
    addQuery: string;
    searching: boolean;
    searchError: string | null;
    hasSearchResult: boolean;
    resolvedSearchOptions: ResolvedSearchOption[];
    selectedCount: number;
    selectedOptionSet: Set<number>;
    queueing: boolean;
    queueError: string | null;
    queueMessage: string | null;
    onClose: () => void;
    onQueryChange: (value: string) => void;
    onSearch: () => void;
    onToggleSelected: (optionIndex: number) => void;
    onSelectAll: () => void;
    onClearSelection: () => void;
    onQueueSelected: () => void;
};

export function DownloadsAddModal({
                                      addQuery,
                                      searching,
                                      searchError,
                                      hasSearchResult,
                                      resolvedSearchOptions,
                                      selectedCount,
                                      selectedOptionSet,
                                      queueing,
                                      queueError,
                                      queueMessage,
                                      onClose,
                                      onQueryChange,
                                      onSearch,
                                      onToggleSelected,
                                      onSelectAll,
                                      onClearSelection,
                                      onQueueSelected,
                                  }: DownloadsAddModalProps) {
    const searchResultCount = resolvedSearchOptions.length;

    return (
        <Column
            role="presentation"
            center
            className={styles.addDownloadOverlay}
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose();
                }
            }}
        >
            <Column className={styles.addDownloadShell} fillWidth>
                <Card
                    background="surface"
                    border="neutral-alpha-weak"
                    padding="0"
                    radius="l"
                    className={styles.addDownloadCard}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="add-download-title"
                    aria-describedby="add-download-description"
                >
                    <Column fillHeight gap="0" style={{minHeight: 0}}>
                        <Row
                            horizontal="between"
                            vertical="center"
                            gap="12"
                            paddingX="l"
                            paddingY="m"
                            className={styles.modalHeader}
                            style={{flexWrap: "wrap"}}
                        >
                            <Column gap="4" style={{minWidth: 0}}>
                                <Heading as="h2" id="add-download-title" variant="heading-strong-l">
                                    Add download
                                </Heading>
                                <Text
                                    id="add-download-description"
                                    onBackground="neutral-weak"
                                    variant="body-default-xs"
                                    wrap="balance"
                                >
                                    Search Raven, pick the source entries you want, then queue the set in one pass.
                                </Text>
                            </Column>
                            <Button variant="secondary" onClick={onClose} disabled={queueing}>
                                Close
                            </Button>
                        </Row>

                        <Column
                            gap="16"
                            padding="l"
                            fillHeight
                            className={styles.modalBody}
                            style={{minHeight: 0}}
                        >
                            <Card
                                fillWidth
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="l"
                                radius="l"
                                className={styles.heroPanel}
                            >
                                <Column gap="12">
                                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                                        <Column gap="4" style={{minWidth: 0}}>
                                            <Text variant="label-default-s" onBackground="neutral-weak">
                                                Download flow
                                            </Text>
                                            <Text variant="body-default-s" wrap="balance">
                                                Keep the search focused here, then use the result list below to queue
                                                exactly what you want.
                                            </Text>
                                        </Column>
                                        <Row gap="8" style={{flexWrap: "wrap"}}>
                                            <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                                {searchResultCount} results
                                            </Badge>
                                            <Badge background="brand-alpha-weak" onBackground="neutral-strong">
                                                {selectedCount} selected
                                            </Badge>
                                        </Row>
                                    </Row>
                                    <Row gap="8" style={{flexWrap: "wrap"}}>
                                        <Row className={styles.stepBadge} gap="8" vertical="center" paddingX="12"
                                             paddingY="8" radius="m">
                                            <Text variant="body-default-xs">1. Search</Text>
                                        </Row>
                                        <Row className={styles.stepBadge} gap="8" vertical="center" paddingX="12"
                                             paddingY="8" radius="m">
                                            <Text variant="body-default-xs">2. Select</Text>
                                        </Row>
                                        <Row className={styles.stepBadge} gap="8" vertical="center" paddingX="12"
                                             paddingY="8" radius="m">
                                            <Text variant="body-default-xs">3. Queue</Text>
                                        </Row>
                                    </Row>
                                </Column>
                            </Card>

                            <Card
                                fillWidth
                                background="surface"
                                border="neutral-alpha-weak"
                                padding="l"
                                radius="l"
                                className={styles.searchPanel}
                            >
                                <Column gap="12">
                                    <Column gap="4">
                                        <Text variant="label-default-s" onBackground="neutral-weak">
                                            Search title
                                        </Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                            Start with the series name. Press <span
                                            className={styles.shortcutKey}>Enter</span> to search and <span
                                            className={styles.shortcutKey}>Ctrl+Enter</span> to queue the current
                                            selection.
                                        </Text>
                                    </Column>
                                    <Row gap="8" style={{flexWrap: "wrap", alignItems: "flex-end"}}>
                                        <Column fillWidth style={{flex: "1 1 420px"}}>
                                            <Input
                                                id="add-title-query"
                                                name="add-title-query"
                                                type="text"
                                                label="Search query"
                                                placeholder="Absolute Duo"
                                                value={addQuery}
                                                onChange={(event) => onQueryChange(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === "Enter") {
                                                        event.preventDefault();
                                                        onSearch();
                                                    }
                                                }}
                                            />
                                        </Column>
                                        <Button
                                            variant="primary"
                                            disabled={searching || !addQuery.trim()}
                                            onClick={onSearch}
                                        >
                                            {searching ? "Searching..." : "Search Raven"}
                                        </Button>
                                    </Row>
                                    {searchError && (
                                        <Card fillWidth background="surface" border="danger-alpha-weak" padding="m"
                                              radius="l">
                                            <Text onBackground="danger-strong" variant="body-default-xs" wrap="balance">
                                                {searchError}
                                            </Text>
                                        </Card>
                                    )}
                                    {!hasSearchResult && !searching && !searchError && (
                                        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m"
                                              radius="l">
                                            <Column gap="8">
                                                <Text variant="body-default-s">Ready to search.</Text>
                                                <Text onBackground="neutral-weak" variant="body-default-xs"
                                                      wrap="balance">
                                                    Search once, review the returned source options, then queue only the
                                                    entries you actually want.
                                                </Text>
                                            </Column>
                                        </Card>
                                    )}
                                </Column>
                            </Card>

                            {searching && (
                                <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
                                    <Row fillWidth horizontal="center" vertical="center" gap="12" paddingY="12">
                                        <Spinner/>
                                        <Text onBackground="neutral-weak" variant="body-default-xs">
                                            Searching Raven sources...
                                        </Text>
                                    </Row>
                                </Card>
                            )}

                            {hasSearchResult && (
                                <Card
                                    fillWidth
                                    background="surface"
                                    border="neutral-alpha-weak"
                                    padding="0"
                                    radius="l"
                                    className={styles.resultsPanel}
                                >
                                    <Column gap="0">
                                        <Column gap="12" padding="l">
                                            <Row horizontal="between" vertical="center" gap="12"
                                                 style={{flexWrap: "wrap"}}>
                                                <Column gap="4">
                                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                                        Search results
                                                    </Text>
                                                    <Heading as="h3" variant="heading-strong-m">
                                                        Pick source entries
                                                    </Heading>
                                                </Column>
                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                    <Button
                                                        variant="secondary"
                                                        disabled={queueing || searchResultCount === 0}
                                                        onClick={onSelectAll}
                                                    >
                                                        Select all
                                                    </Button>
                                                    <Button
                                                        variant="secondary"
                                                        disabled={queueing || selectedCount === 0}
                                                        onClick={onClearSelection}
                                                    >
                                                        Clear selection
                                                    </Button>
                                                </Row>
                                            </Row>

                                            {searchResultCount === 0 && (
                                                <Card fillWidth background="surface" border="neutral-alpha-weak"
                                                      padding="m" radius="l">
                                                    <Column gap="8">
                                                        <Text variant="body-default-s">No matches found.</Text>
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            Try a shorter title, an alternate romanization, or a broader
                                                            search term.
                                                        </Text>
                                                    </Column>
                                                </Card>
                                            )}

                                            {searchResultCount > 0 && (
                                                <Column gap="8" className={styles.resultsViewport}>
                                                    {resolvedSearchOptions.map((option) => {
                                                        const checked = selectedOptionSet.has(option.optionIndex);

                                                        return (
                                                            <Card
                                                                key={`${option.optionIndex}-${option.title || option.href}`}
                                                                background="surface"
                                                                border={checked ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                                padding="m"
                                                                radius="l"
                                                                fillWidth
                                                                className={`${styles.resultCard} ${checked ? styles.resultCardSelected : ""}`}
                                                                onClick={() => onToggleSelected(option.optionIndex)}
                                                            >
                                                                <Column gap="8">
                                                                    <Row horizontal="between" vertical="center"
                                                                         gap="12">
                                                                        <Row gap="12" vertical="center"
                                                                             style={{minWidth: 0}}>
                                                                            {option.coverUrl && (
                                                                                // eslint-disable-next-line @next/next/no-img-element -- Raven cover URLs come from arbitrary remote hosts.
                                                                                <img
                                                                                    src={option.coverUrl}
                                                                                    alt={`${option.title || `Option ${option.optionIndex}`} cover`}
                                                                                    className={styles.coverThumb}
                                                                                    loading="lazy"
                                                                                />
                                                                            )}
                                                                            <Column gap="8" style={{minWidth: 0}}>
                                                                                <Text variant="heading-default-s"
                                                                                      wrap="balance">
                                                                                    {option.title || `Option ${option.optionIndex}`}
                                                                                </Text>
                                                                                <Row gap="8" style={{flexWrap: "wrap"}}>
                                                                                    <Badge
                                                                                        background={checked ? "brand-alpha-weak" : "neutral-alpha-weak"}
                                                                                        onBackground="neutral-strong">
                                                                                        Option {option.optionIndex}
                                                                                    </Badge>
                                                                                    {option.type && (
                                                                                        <Badge
                                                                                            background="neutral-alpha-weak"
                                                                                            onBackground="neutral-strong">
                                                                                            {option.type}
                                                                                        </Badge>
                                                                                    )}
                                                                                </Row>
                                                                            </Column>
                                                                        </Row>
                                                                        <input
                                                                            type="checkbox"
                                                                            name="download-source"
                                                                            checked={checked}
                                                                            className={styles.selectionCheckbox}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            onChange={() => onToggleSelected(option.optionIndex)}
                                                                            aria-label={`Select option ${option.optionIndex}`}
                                                                        />
                                                                    </Row>
                                                                    {option.href && (
                                                                        <Text onBackground="neutral-weak"
                                                                              variant="body-default-xs" wrap="balance">
                                                                            Source:{" "}
                                                                            <SmartLink
                                                                                href={option.href}
                                                                                onClick={(event) => event.stopPropagation()}
                                                                            >
                                                                                {option.href}
                                                                            </SmartLink>
                                                                        </Text>
                                                                    )}
                                                                </Column>
                                                            </Card>
                                                        );
                                                    })}
                                                </Column>
                                            )}
                                        </Column>

                                        {searchResultCount > 0 && (
                                            <Row
                                                horizontal="between"
                                                vertical="center"
                                                gap="12"
                                                paddingX="l"
                                                paddingY="m"
                                                className={styles.queueBar}
                                                style={{flexWrap: "wrap"}}
                                            >
                                                <Column gap="4" style={{minWidth: 0}}>
                                                    <Text variant="body-default-s">
                                                        {selectedCount === 0 ? "Select at least one result to queue." : `${selectedCount} result${selectedCount === 1 ? "" : "s"} ready to queue.`}
                                                    </Text>
                                                    {queueMessage && (
                                                        <Text onBackground="neutral-weak" variant="body-default-xs"
                                                              wrap="balance">
                                                            {queueMessage}
                                                        </Text>
                                                    )}
                                                    {queueError && (
                                                        <Text onBackground="danger-strong" variant="body-default-xs"
                                                              wrap="balance">
                                                            {queueError}
                                                        </Text>
                                                    )}
                                                </Column>
                                                <Button
                                                    variant="primary"
                                                    disabled={queueing || selectedCount === 0}
                                                    onClick={onQueueSelected}
                                                >
                                                    {queueing ? "Queueing..." : `Queue selected (${selectedCount})`}
                                                </Button>
                                            </Row>
                                        )}
                                    </Column>
                                </Card>
                            )}
                        </Column>
                    </Column>
                </Card>
            </Column>
        </Column>
    );
}
