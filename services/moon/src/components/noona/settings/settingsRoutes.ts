export type SettingsTabId = "general" | "moon" | "raven" | "vault" | "sage" | "warden" | "portal";
export type SettingsMainSectionId = "ecosystem" | "users";
export type PortalSettingsSubtabId = "discord" | "kavita" | "komf";

type SettingsTabRoute = {
    id: SettingsTabId;
    label: string;
    description: string;
};

type PortalSettingsSubtabRoute = {
    id: PortalSettingsSubtabId;
    label: string;
    description: string;
};

export type SettingsRouteSelection = {
    section: SettingsMainSectionId;
    tab: SettingsTabId;
    portalSubtab: PortalSettingsSubtabId;
    href: string;
    title: string;
    description: string;
};

const SETTINGS_TABS: SettingsTabRoute[] = [
    {
        id: "general",
        label: "General",
        description: "Manage ecosystem-wide actions, debug logging, and service diagnostics.",
    },
    {
        id: "moon",
        label: "Moon",
        description: "Configure Moon and review the active Discord-authenticated account.",
    },
    {
        id: "raven",
        label: "Raven",
        description: "Adjust Raven runtime settings, naming templates, and download worker limits.",
    },
    {
        id: "vault",
        label: "Vault",
        description: "Inspect Vault collections, secrets-backed storage, and reset controls.",
    },
    {
        id: "sage",
        label: "Sage",
        description: "Edit Sage runtime configuration and restart behavior.",
    },
    {
        id: "warden",
        label: "Warden",
        description: "Review orchestrator-specific controls and managed image updates.",
    },
    {
        id: "portal",
        label: "Portal",
        description: "Configure Portal integrations, Discord onboarding, and managed Komf settings.",
    },
];

export const TAB_ORDER = SETTINGS_TABS.map((entry) => entry.id) as SettingsTabId[];

export const TAB_LABELS: Record<SettingsTabId, string> = {
    general: "General",
    moon: "Moon",
    raven: "Raven",
    vault: "Vault",
    sage: "Sage",
    warden: "Warden",
    portal: "Portal",
};

export const PORTAL_SETTINGS_SUBTABS: PortalSettingsSubtabRoute[] = [
    {
        id: "discord",
        label: "Discord",
        description: "Configure Portal's Discord bot, OAuth, and guild role wiring.",
    },
    {
        id: "kavita",
        label: "Kavita",
        description: "Manage Portal's Kavita, Vault, and command-access integration settings.",
    },
    {
        id: "komf",
        label: "Komf",
        description: "Edit the managed Komf application.yml and related runtime settings.",
    },
];

const TAB_SET = new Set<SettingsTabId>(TAB_ORDER);
const PORTAL_SUBTAB_SET = new Set<PortalSettingsSubtabId>(PORTAL_SETTINGS_SUBTABS.map((entry) => entry.id));
const SETTINGS_TABS_BY_ID = new Map<SettingsTabId, SettingsTabRoute>(SETTINGS_TABS.map((entry) => [entry.id, entry]));
const PORTAL_SUBTABS_BY_ID = new Map<PortalSettingsSubtabId, PortalSettingsSubtabRoute>(
    PORTAL_SETTINGS_SUBTABS.map((entry) => [entry.id, entry]),
);

export const SETTINGS_LANDING_HREF = "/settings/general";
export const SETTINGS_USER_MANAGEMENT_HREF = "/settings/usermanagement";

export const getSettingsHrefForTab = (tab: SettingsTabId): string =>
    tab === "portal" ? getSettingsHrefForPortalSubtab("discord") : `/settings/${tab}`;

export const getSettingsHrefForPortalSubtab = (subtab: PortalSettingsSubtabId): string => `/settings/portal/${subtab}`;

const buildSelection = (
    section: SettingsMainSectionId,
    tab: SettingsTabId,
    portalSubtab: PortalSettingsSubtabId,
): SettingsRouteSelection => {
    if (section === "users") {
        return {
            section,
            tab: "general",
            portalSubtab: "discord",
            href: SETTINGS_USER_MANAGEMENT_HREF,
            title: "User Management",
            description: "Manage Discord-linked Moon accounts and default permissions for new users.",
        };
    }

    if (tab === "portal") {
        const portalEntry = PORTAL_SUBTABS_BY_ID.get(portalSubtab) ?? PORTAL_SUBTABS_BY_ID.get("discord");
        return {
            section,
            tab,
            portalSubtab,
            href: getSettingsHrefForPortalSubtab(portalSubtab),
            title: `Portal ${portalEntry?.label ?? "Discord"}`,
            description: portalEntry?.description
                ?? "Configure Portal integrations, Discord onboarding, and managed Komf settings.",
        };
    }

    const tabEntry = SETTINGS_TABS_BY_ID.get(tab) ?? SETTINGS_TABS_BY_ID.get("general");
    return {
        section,
        tab,
        portalSubtab: "discord",
        href: getSettingsHrefForTab(tab),
        title: tabEntry?.label ?? "General",
        description: tabEntry?.description ?? "Manage Noona settings.",
    };
};

export const parseSettingsSlug = (slug: string[] | undefined): SettingsRouteSelection | null => {
    if (!Array.isArray(slug) || slug.length === 0) {
        return buildSelection("ecosystem", "general", "discord");
    }

    const [firstSegmentRaw, secondSegmentRaw, ...rest] = slug;
    const firstSegment = firstSegmentRaw?.toLowerCase().trim() ?? "";
    const secondSegment = secondSegmentRaw?.toLowerCase().trim() ?? "";
    if (rest.length > 0) return null;

    if (firstSegment === "usermanagement") {
        return slug.length === 1 ? buildSelection("users", "general", "discord") : null;
    }

    if (firstSegment === "portal") {
        if (slug.length === 1) {
            return buildSelection("ecosystem", "portal", "discord");
        }
        if (!PORTAL_SUBTAB_SET.has(secondSegment as PortalSettingsSubtabId)) {
            return null;
        }
        return buildSelection("ecosystem", "portal", secondSegment as PortalSettingsSubtabId);
    }

    if (slug.length !== 1 || !TAB_SET.has(firstSegment as SettingsTabId) || firstSegment === "portal") {
        return null;
    }

    return buildSelection("ecosystem", firstSegment as SettingsTabId, "discord");
};

export const resolveLegacySettingsHref = (value: string | string[] | undefined): string => {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = typeof raw === "string" ? raw.toLowerCase().trim() : "";
    if (!normalized) return SETTINGS_LANDING_HREF;
    if (normalized === "users" || normalized === "usermanagement") return SETTINGS_USER_MANAGEMENT_HREF;
    if (normalized === "portal") return getSettingsHrefForPortalSubtab("discord");
    if (!TAB_SET.has(normalized as SettingsTabId) || normalized === "portal") return SETTINGS_LANDING_HREF;
    return getSettingsHrefForTab(normalized as SettingsTabId);
};
