import {dump, load} from "js-yaml";

const PRIORITY_STEP = 10;

const PROVIDER_DEFINITIONS = [
    {key: "mangaUpdates", label: "MangaUpdates", defaultPriority: 10, defaultEnabled: true},
    {
        key: "mal",
        label: "MyAnimeList",
        defaultPriority: 20,
        defaultEnabled: false,
        credentialKey: "malClientId" as const
    },
    {key: "aniList", label: "AniList", defaultPriority: 30, defaultEnabled: false},
    {key: "mangaDex", label: "MangaDex", defaultPriority: 40, defaultEnabled: false},
    {key: "nautiljon", label: "Nautiljon", defaultPriority: 50, defaultEnabled: false},
    {key: "yenPress", label: "Yen Press", defaultPriority: 60, defaultEnabled: false},
    {key: "kodansha", label: "Kodansha", defaultPriority: 70, defaultEnabled: false},
    {key: "viz", label: "VIZ", defaultPriority: 80, defaultEnabled: false},
    {key: "bookWalker", label: "BookWalker", defaultPriority: 90, defaultEnabled: false},
    {key: "bangumi", label: "Bangumi", defaultPriority: 100, defaultEnabled: false},
    {
        key: "comicVine",
        label: "Comic Vine",
        defaultPriority: 110,
        defaultEnabled: false,
        credentialKey: "comicVineApiKey" as const
    },
];

const PROVIDER_MAP = new Map(PROVIDER_DEFINITIONS.map((entry) => [entry.key, entry]));

type KomfCredentialKey = "malClientId" | "comicVineApiKey";

type PlainRecord = Record<string, unknown>;

export type KomfProviderState = {
    key: string;
    label: string;
    priority: number;
    enabled: boolean;
    credentialKey: KomfCredentialKey | null;
};

export type KomfConfigState = {
    parseError: string | null;
    providers: KomfProviderState[];
    malClientId: string;
    comicVineApiKey: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const isPlainRecord = (value: unknown): value is PlainRecord => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const toMultilineString = (value: unknown): string => {
    if (typeof value !== "string") {
        return "";
    }

    return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
};

const normalizePriority = (value: unknown, fallback: number): number => {
    const parsed = Number.parseInt(String(value ?? ""), 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        return fallback;
    }

    return parsed;
};

const titleCaseProviderKey = (key: string): string => {
    const parts = key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[\s_-]+/)
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return key;
    }

    return parts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
};

const cloneYamlRoot = (value: unknown): PlainRecord => {
    if (!isPlainRecord(value)) {
        return {};
    }

    return JSON.parse(JSON.stringify(value)) as PlainRecord;
};

const parseKomfYamlRoot = (raw: string, fallbackRaw: string): PlainRecord => {
    const source = normalizeString(toMultilineString(raw)) ? toMultilineString(raw) : toMultilineString(fallbackRaw);
    const parsed = source ? load(source) : {};

    if (!isPlainRecord(parsed)) {
        throw new Error("Komf application.yml must contain a YAML object.");
    }

    return cloneYamlRoot(parsed);
};

const getMetadataProvidersRecord = (root: PlainRecord, create = false): PlainRecord => {
    const current = root.metadataProviders;
    if (isPlainRecord(current)) {
        return current;
    }

    if (!create) {
        return {};
    }

    const next: PlainRecord = {};
    root.metadataProviders = next;
    return next;
};

const getDefaultProvidersRecord = (root: PlainRecord, create = false): PlainRecord => {
    const metadataProviders = getMetadataProvidersRecord(root, create);
    const current = metadataProviders.defaultProviders;
    if (isPlainRecord(current)) {
        return current;
    }

    if (!create) {
        return {};
    }

    const next: PlainRecord = {};
    metadataProviders.defaultProviders = next;
    return next;
};

const sortProviders = (providers: KomfProviderState[]): KomfProviderState[] => {
    return [...providers].sort((left, right) => {
        if (left.priority !== right.priority) {
            return left.priority - right.priority;
        }

        return left.label.localeCompare(right.label);
    });
};

const readProviderStates = (root: PlainRecord): KomfProviderState[] => {
    const defaultProviders = getDefaultProvidersRecord(root, false);
    const providerKeys = Array.from(
        new Set([
            ...PROVIDER_DEFINITIONS.map((entry) => entry.key),
            ...Object.keys(defaultProviders),
        ]),
    );

    return sortProviders(
        providerKeys.map((key, index) => {
            const definition = PROVIDER_MAP.get(key);
            const providerNode = isPlainRecord(defaultProviders[key]) ? defaultProviders[key] : {};

            return {
                key,
                label: definition?.label ?? titleCaseProviderKey(key),
                priority: normalizePriority(providerNode.priority, definition?.defaultPriority ?? ((index + 1) * PRIORITY_STEP)),
                enabled: typeof providerNode.enabled === "boolean" ? providerNode.enabled : definition?.defaultEnabled ?? false,
                credentialKey: definition?.credentialKey ?? null,
            };
        }),
    );
};

const writeProviderStates = (root: PlainRecord, providers: KomfProviderState[]) => {
    const existing = getDefaultProvidersRecord(root, false);
    const orderedProviders = sortProviders(providers);
    const nextProviders: PlainRecord = {};

    for (const provider of orderedProviders) {
        const currentNode = isPlainRecord(existing[provider.key]) ? {...existing[provider.key] as PlainRecord} : {};
        if (provider.key === "mangaUpdates" && !normalizeString(currentNode.mode)) {
            currentNode.mode = "API";
        }
        currentNode.priority = provider.priority;
        currentNode.enabled = provider.enabled;
        nextProviders[provider.key] = currentNode;
    }

    const metadataProviders = getMetadataProvidersRecord(root, true);
    metadataProviders.defaultProviders = nextProviders;
};

const dumpKomfYaml = (root: PlainRecord): string => {
    const next = dump(root, {
        lineWidth: 120,
        noCompatMode: true,
        sortKeys: false,
    }).trimEnd();

    return next ? `${next}\n` : "";
};

const mutateKomfYaml = (
    raw: string,
    fallbackRaw: string,
    mutator: (root: PlainRecord) => void,
): string => {
    const root = parseKomfYamlRoot(raw, fallbackRaw);
    mutator(root);
    return dumpKomfYaml(root);
};

export const resetKomfYaml = (fallbackRaw: string): string => {
    const normalized = toMultilineString(fallbackRaw).trim();
    return normalized ? `${normalized}\n` : "";
};

export const readKomfConfigState = (raw: string, fallbackRaw: string): KomfConfigState => {
    try {
        const root = parseKomfYamlRoot(raw, fallbackRaw);
        const metadataProviders = getMetadataProvidersRecord(root, false);

        return {
            parseError: null,
            providers: readProviderStates(root),
            malClientId: normalizeString(metadataProviders.malClientId),
            comicVineApiKey: normalizeString(metadataProviders.comicVineApiKey),
        };
    } catch (error_) {
        const message = error_ instanceof Error ? error_.message : String(error_);
        return {
            parseError: message,
            providers: [],
            malClientId: "",
            comicVineApiKey: "",
        };
    }
};

export const updateKomfProvider = (
    raw: string,
    fallbackRaw: string,
    key: string,
    updates: { enabled?: boolean; priority?: number },
): string => {
    return mutateKomfYaml(raw, fallbackRaw, (root) => {
        const providers = readProviderStates(root);
        const existingIndex = providers.findIndex((entry) => entry.key === key);
        const definition = PROVIDER_MAP.get(key);
        const nextProvider: KomfProviderState = existingIndex >= 0
            ? {
                ...providers[existingIndex],
                ...(typeof updates.enabled === "boolean" ? {enabled: updates.enabled} : {}),
                ...(typeof updates.priority === "number" ? {priority: normalizePriority(updates.priority, providers[existingIndex].priority)} : {}),
            }
            : {
                key,
                label: definition?.label ?? titleCaseProviderKey(key),
                priority: normalizePriority(updates.priority, definition?.defaultPriority ?? ((providers.length + 1) * PRIORITY_STEP)),
                enabled: updates.enabled === true,
                credentialKey: definition?.credentialKey ?? null,
            };

        const nextProviders = existingIndex >= 0
            ? providers.map((entry, index) => (index === existingIndex ? nextProvider : entry))
            : [...providers, nextProvider];

        writeProviderStates(root, nextProviders);
    });
};

export const moveKomfProvider = (
    raw: string,
    fallbackRaw: string,
    key: string,
    direction: "up" | "down",
): string => {
    return mutateKomfYaml(raw, fallbackRaw, (root) => {
        const orderedProviders = sortProviders(readProviderStates(root));
        const currentIndex = orderedProviders.findIndex((entry) => entry.key === key);
        if (currentIndex < 0) {
            return;
        }

        const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
        if (swapIndex < 0 || swapIndex >= orderedProviders.length) {
            return;
        }

        const nextProviders = [...orderedProviders];
        const [target] = nextProviders.splice(currentIndex, 1);
        nextProviders.splice(swapIndex, 0, target);

        writeProviderStates(
            root,
            nextProviders.map((provider, index) => ({
                ...provider,
                priority: (index + 1) * PRIORITY_STEP,
            })),
        );
    });
};

export const updateKomfCredential = (
    raw: string,
    fallbackRaw: string,
    key: KomfCredentialKey,
    value: string,
): string => {
    return mutateKomfYaml(raw, fallbackRaw, (root) => {
        const metadataProviders = getMetadataProvidersRecord(root, true);
        metadataProviders[key] = value.trim();
    });
};
