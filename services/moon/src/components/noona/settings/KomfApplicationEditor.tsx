"use client";

import {useMemo} from "react";
import {Button, Card, Column, Heading, Input, Row, Switch, Text} from "@once-ui-system/core";
import editorStyles from "../ConfigEditor.module.scss";
import {
    type KomfProviderState,
    moveKomfProvider,
    readKomfConfigState,
    resetKomfYaml,
    updateKomfCredential,
    updateKomfProvider,
} from "./komfConfig";

type KomfApplicationEditorProps = {
    label: string;
    description?: string | null;
    warning?: string | null;
    value: string;
    defaultValue: string;
    disabled?: boolean;
    showRawEditor?: boolean;
    onChange: (value: string) => void;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function KomfApplicationEditor({
                                          label,
                                          description,
                                          warning,
                                          value,
                                          defaultValue,
                                          disabled = false,
                                          showRawEditor = false,
                                          onChange,
                                      }: KomfApplicationEditorProps) {
    const state = useMemo(() => readKomfConfigState(value, defaultValue), [defaultValue, value]);
    const rawEditorVisible = showRawEditor || state.parseError !== null;

    const handleProviderUpdate = (providerKey: string, updates: { enabled?: boolean; priority?: number }) => {
        onChange(updateKomfProvider(value, defaultValue, providerKey, updates));
    };

    const handleCredentialUpdate = (key: "malClientId" | "comicVineApiKey", nextValue: string) => {
        onChange(updateKomfCredential(value, defaultValue, key, nextValue));
    };

    const renderProviderRow = (provider: KomfProviderState, index: number, total: number) => {
        const needsMalClientId = provider.enabled && provider.credentialKey === "malClientId" && !state.malClientId;
        const needsComicVineApiKey = provider.enabled && provider.credentialKey === "comicVineApiKey" && !state.comicVineApiKey;

        return (
            <Card
                key={`komf-provider-${provider.key}`}
                fillWidth
                background="neutral-alpha-weak"
                border="neutral-alpha-weak"
                padding="m"
                radius="l"
            >
                <Column gap="12">
                    <Row horizontal="between" vertical="center" gap="12" style={{flexWrap: "wrap"}}>
                        <Column gap="4" style={{minWidth: 0}}>
                            <Text variant="label-default-s">{provider.label}</Text>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Provider key: {provider.key}
                            </Text>
                        </Column>
                        <Row gap="8" vertical="center">
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                {provider.enabled ? "Enabled" : "Disabled"}
                            </Text>
                            <Switch
                                isChecked={provider.enabled}
                                disabled={disabled}
                                ariaLabel={`Toggle ${provider.label}`}
                                onToggle={() => handleProviderUpdate(provider.key, {enabled: !provider.enabled})}
                            />
                        </Row>
                    </Row>
                    <Row gap="12" vertical="end" style={{flexWrap: "wrap"}}>
                        <div style={{minWidth: 140, flex: "0 0 140px"}}>
                            <Input
                                id={`komf-provider-priority-${provider.key}`}
                                name={`komf-provider-priority-${provider.key}`}
                                label="Priority"
                                type="number"
                                value={String(provider.priority)}
                                disabled={disabled}
                                onChange={(event) => {
                                    const parsed = Number.parseInt(event.target.value, 10);
                                    if (!Number.isInteger(parsed) || parsed < 1) {
                                        return;
                                    }

                                    handleProviderUpdate(provider.key, {priority: parsed});
                                }}
                            />
                        </div>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button
                                variant="secondary"
                                disabled={disabled || index === 0}
                                onClick={() => onChange(moveKomfProvider(value, defaultValue, provider.key, "up"))}
                            >
                                Move up
                            </Button>
                            <Button
                                variant="secondary"
                                disabled={disabled || index >= total - 1}
                                onClick={() => onChange(moveKomfProvider(value, defaultValue, provider.key, "down"))}
                            >
                                Move down
                            </Button>
                        </Row>
                    </Row>
                    {(needsMalClientId || needsComicVineApiKey) && (
                        <Text onBackground="warning-strong" variant="body-default-xs">
                            {needsMalClientId
                                ? "MyAnimeList requires malClientId when the provider is enabled."
                                : "Comic Vine requires comicVineApiKey when the provider is enabled."}
                        </Text>
                    )}
                </Column>
            </Card>
        );
    };

    return (
        <Card fillWidth background="surface" border="neutral-alpha-weak" padding="l" radius="l">
            <Column gap="12">
                <Heading as="h3" variant="heading-strong-l">{label}</Heading>
                {normalizeString(description) && (
                    <Text onBackground="neutral-weak" variant="body-default-xs">
                        {normalizeString(description)}
                    </Text>
                )}
                {normalizeString(warning) && (
                    <Text onBackground="warning-strong" variant="body-default-xs">
                        {normalizeString(warning)}
                    </Text>
                )}

                {state.parseError ? (
                    <Column gap="8">
                        <Text onBackground="danger-strong" variant="body-default-xs">
                            Komf application.yml could not be parsed: {state.parseError}
                        </Text>
                        <Row gap="8" style={{flexWrap: "wrap"}}>
                            <Button
                                variant="secondary"
                                disabled={disabled}
                                onClick={() => onChange(resetKomfYaml(defaultValue))}
                            >
                                Reset to recommended template
                            </Button>
                        </Row>
                    </Column>
                ) : (
                    <>
                        <Card fillWidth background="neutral-alpha-weak" border="neutral-alpha-weak" padding="m"
                              radius="l">
                            <Column gap="8">
                                <Heading as="h4" variant="heading-strong-m">Provider credentials</Heading>
                                <Text onBackground="neutral-weak" variant="body-default-xs">
                                    These fields are only needed when their matching providers are enabled.
                                </Text>
                                <Row gap="12" style={{flexWrap: "wrap"}}>
                                    {state.providers.some((provider) => provider.enabled && provider.credentialKey === "malClientId") && (
                                        <div style={{minWidth: 260, flex: "1 1 260px"}}>
                                            <Input
                                                id="komf-mal-client-id"
                                                name="komf-mal-client-id"
                                                label="malClientId"
                                                value={state.malClientId}
                                                disabled={disabled}
                                                onChange={(event) => handleCredentialUpdate("malClientId", event.target.value)}
                                            />
                                        </div>
                                    )}
                                    {state.providers.some((provider) => provider.enabled && provider.credentialKey === "comicVineApiKey") && (
                                        <div style={{minWidth: 260, flex: "1 1 260px"}}>
                                            <Input
                                                id="komf-comic-vine-api-key"
                                                name="komf-comic-vine-api-key"
                                                label="comicVineApiKey"
                                                type="password"
                                                value={state.comicVineApiKey}
                                                disabled={disabled}
                                                onChange={(event) => handleCredentialUpdate("comicVineApiKey", event.target.value)}
                                            />
                                        </div>
                                    )}
                                </Row>
                                {!state.providers.some((provider) => provider.enabled && provider.credentialKey !== null) && (
                                    <Text onBackground="neutral-weak" variant="body-default-xs">
                                        No enabled providers currently require additional credentials.
                                    </Text>
                                )}
                            </Column>
                        </Card>

                        <Column gap="8">
                            <Heading as="h4" variant="heading-strong-m">Metadata providers</Heading>
                            <Text onBackground="neutral-weak" variant="body-default-xs">
                                Komf tries enabled providers in ascending priority order. Use the switches and ordering
                                controls below to tune metadata lookups.
                            </Text>
                            <Column gap="8">
                                {state.providers.map((provider, index) =>
                                    renderProviderRow(provider, index, state.providers.length),
                                )}
                            </Column>
                        </Column>
                    </>
                )}

                {rawEditorVisible && (
                    <Column gap="8">
                        <Heading as="h4" variant="heading-strong-m">Raw application.yml</Heading>
                        <Text onBackground="neutral-weak" variant="body-default-xs">
                            Advanced fallback editor for the full managed Komf YAML file.
                        </Text>
                        <textarea
                            id="komf-application-yml"
                            name="komf-application-yml"
                            className={editorStyles.configTextarea}
                            value={value}
                            disabled={disabled}
                            aria-label="Komf application.yml"
                            spellCheck={false}
                            onChange={(event) => onChange(event.target.value)}
                        />
                    </Column>
                )}
            </Column>
        </Card>
    );
}

export default KomfApplicationEditor;
