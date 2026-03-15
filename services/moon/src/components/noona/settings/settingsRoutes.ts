export type SettingsTabId = "general" | "moon" | "raven" | "vault" | "sage" | "warden" | "portal";
export type SettingsMainSectionId = "ecosystem" | "users";
export type PortalSettingsSubtabId = "discord" | "kavita" | "komf";
export type SettingsNavSectionId = "general" | "storage" | "downloads" | "external" | "users";
export type SettingsViewId =
    "overview"
    | "filesystem"
    | "database"
    | "downloader"
    | "updater"
    | "discord"
    | "kavita"
    | "komf"
    | "users";

type PortalSettingsSubtabRoute = {
    id: PortalSettingsSubtabId;
    label: string;
    description: string;
};

type SettingsNavItem = {
    id: SettingsViewId;
    label: string;
    href: string;
    description: string;
};

type SettingsNavSection = {
    id: SettingsNavSectionId;
    label: string;
    items: SettingsNavItem[];
};

export type SettingsRouteSelection = {
    section: SettingsMainSectionId;
    navSection: SettingsNavSectionId;
    view: SettingsViewId;
    tab: SettingsTabId;
    portalSubtab: PortalSettingsSubtabId;
    href: string;
    title: string;
    description: string;
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
        description: "Configure Kavita defaults used when Portal provisions new users.",
    },
    {
        id: "komf",
        label: "Komf",
        description: "Edit the managed Komf application.yml and related runtime settings.",
    },
];

export const TAB_ORDER: SettingsTabId[] = ["general", "moon", "raven", "vault", "sage", "warden", "portal"];

export const TAB_LABELS: Record<SettingsTabId, string> = {
    general: "General",
    moon: "Moon",
    raven: "Raven",
    vault: "Vault",
    sage: "Sage",
    warden: "Warden",
    portal: "Portal",
};

export const VIEW_LABELS: Record<SettingsViewId, string> = {
    overview: "Overview",
    filesystem: "Storage folders",
    database: "Database",
    downloader: "Download rules, workers & VPN",
    updater: "Updates",
    discord: "Discord",
    kavita: "Kavita",
    komf: "Komf",
    users: "Users & roles",
};

export const SETTINGS_LANDING_HREF = "/settings/general";
export const SETTINGS_USER_MANAGEMENT_HREF = "/settings/users";

export const getSettingsHrefForView = (view: SettingsViewId): string => {
    switch (view) {
        case "overview":
            return "/settings/general";
        case "filesystem":
            return "/settings/storage/filesystem";
        case "database":
            return "/settings/storage/database";
        case "downloader":
            return "/settings/downloads/downloader";
        case "updater":
            return "/settings/downloads/updater";
        case "discord":
            return "/settings/external/discord";
        case "kavita":
            return "/settings/external/kavita";
        case "komf":
            return "/settings/external/komf";
        case "users":
            return SETTINGS_USER_MANAGEMENT_HREF;
        default:
            return SETTINGS_LANDING_HREF;
    }
};

export const getSettingsHrefForPortalSubtab = (subtab: PortalSettingsSubtabId): string => {
    if (subtab === "kavita") {
        return getSettingsHrefForView("kavita");
    }

    if (subtab === "komf") {
        return getSettingsHrefForView("komf");
    }

    return getSettingsHrefForView("discord");
};

export const getSettingsHrefForTab = (tab: SettingsTabId): string => {
    switch (tab) {
        case "general":
        case "moon":
        case "sage":
            return getSettingsHrefForView("overview");
        case "raven":
            return getSettingsHrefForView("downloader");
        case "vault":
            return getSettingsHrefForView("database");
        case "warden":
            return getSettingsHrefForView("updater");
        case "portal":
            return getSettingsHrefForView("discord");
        default:
            return SETTINGS_LANDING_HREF;
    }
};

export const SETTINGS_NAV_SECTIONS: SettingsNavSection[] = [
    {
        id: "general",
        label: "System",
        items: [
            {
                id: "overview",
                label: "Overview",
                href: getSettingsHrefForView("overview"),
                description: "Check service status, links, and core system actions.",
            },
        ],
    },
    {
        id: "storage",
        label: "Storage",
        items: [
            {
                id: "filesystem",
                label: "Storage folders",
                href: getSettingsHrefForView("filesystem"),
                description: "Review storage paths, shared mounts, and folder layout.",
            },
            {
                id: "database",
                label: "Database",
                href: getSettingsHrefForView("database"),
                description: "Inspect database access, collections, and reset tools.",
            },
        ],
    },
    {
        id: "downloads",
        label: "Downloads",
        items: [
            {
                id: "downloader",
                label: "Download rules, workers & VPN",
                href: getSettingsHrefForView("downloader"),
                description: "Adjust naming, worker limits, and VPN behavior for downloads.",
            },
            {
                id: "updater",
                label: "Updates",
                href: getSettingsHrefForView("updater"),
                description: "Check for service updates and apply managed image changes.",
            },
        ],
    },
    {
        id: "external",
        label: "Integrations",
        items: [
            {
                id: "discord",
                label: "Discord",
                href: getSettingsHrefForView("discord"),
                description: "Change Discord bot credentials, onboarding, and command access.",
            },
            {
                id: "kavita",
                label: "Kavita",
                href: getSettingsHrefForView("kavita"),
                description: "Manage Kavita defaults and Portal integration settings.",
            },
            {
                id: "komf",
                label: "Komf",
                href: getSettingsHrefForView("komf"),
                description: "Komf application.yml and runtime settings.",
            },
        ],
    },
    {
        id: "users",
        label: "People",
        items: [
            {
                id: "users",
                label: "Users & roles",
                href: SETTINGS_USER_MANAGEMENT_HREF,
                description: "Manage Moon accounts, roles, and default permissions.",
            },
        ],
    },
];

const buildSelection = ({
                            section,
                            navSection,
                            view,
                            tab,
                            portalSubtab = "discord",
                            title,
                            description,
                        }: {
    section: SettingsMainSectionId;
    navSection: SettingsNavSectionId;
    view: SettingsViewId;
    tab: SettingsTabId;
    portalSubtab?: PortalSettingsSubtabId;
    title: string;
    description: string;
}): SettingsRouteSelection => ({
    section,
    navSection,
    view,
    tab,
    portalSubtab,
    href: getSettingsHrefForView(view),
    title,
    description,
});

export const parseSettingsSlug = (slug: string[] | undefined): SettingsRouteSelection | null => {
    if (!Array.isArray(slug) || slug.length === 0) {
        return buildSelection({
            section: "ecosystem",
            navSection: "general",
            view: "overview",
            tab: "general",
            title: "Overview",
            description: "Check service status, links, and core system actions.",
        });
    }

    const normalized = slug.map((segment) => (typeof segment === "string" ? segment.toLowerCase().trim() : ""));
    const [firstSegment = "", secondSegment = "", thirdSegment = ""] = normalized;
    if (thirdSegment) {
        return null;
    }

    if (firstSegment === "general") {
        return buildSelection({
            section: "ecosystem",
            navSection: "general",
            view: "overview",
            tab: "general",
            title: "Overview",
            description: "Check service status, links, and core system actions.",
        });
    }

    if (firstSegment === "storage") {
        if (!secondSegment || secondSegment === "filesystem") {
            return buildSelection({
                section: "ecosystem",
                navSection: "storage",
                view: "filesystem",
                tab: "vault",
                title: "Storage folders",
                description: "Review storage paths, shared mounts, and folder layout.",
            });
        }
        if (secondSegment === "database") {
            return buildSelection({
                section: "ecosystem",
                navSection: "storage",
                view: "database",
                tab: "vault",
                title: "Database",
                description: "Inspect database access, collections, and reset tools.",
            });
        }
        return null;
    }

    if (firstSegment === "downloads") {
        if (!secondSegment || secondSegment === "downloader") {
            return buildSelection({
                section: "ecosystem",
                navSection: "downloads",
                view: "downloader",
                tab: "raven",
                title: "Download rules, workers & VPN",
                description: "Adjust naming, worker limits, and VPN behavior for downloads.",
            });
        }
        if (secondSegment === "updater") {
            return buildSelection({
                section: "ecosystem",
                navSection: "downloads",
                view: "updater",
                tab: "warden",
                title: "Updates",
                description: "Check for service updates and apply managed image changes.",
            });
        }
        return null;
    }

    if (firstSegment === "external") {
        if (!secondSegment || secondSegment === "discord") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "discord",
                tab: "portal",
                portalSubtab: "discord",
                title: "Discord",
                description: "Change Discord bot credentials, onboarding, and command access.",
            });
        }
        if (secondSegment === "kavita") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "kavita",
                tab: "portal",
                portalSubtab: "kavita",
                title: "Kavita",
                description: "Manage Kavita defaults and Portal integration settings.",
            });
        }
        if (secondSegment === "komf") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "komf",
                tab: "portal",
                portalSubtab: "komf",
                title: "Komf",
                description: "Komf application.yml and runtime settings.",
            });
        }
        return null;
    }

    if (firstSegment === "users" || firstSegment === "usermanagement") {
        return buildSelection({
            section: "users",
            navSection: "users",
            view: "users",
            tab: "general",
            title: "Users & roles",
            description: "Manage Moon accounts, roles, and default permissions.",
        });
    }

    if (firstSegment === "moon" || firstSegment === "sage") {
        return buildSelection({
            section: "ecosystem",
            navSection: "general",
            view: "overview",
            tab: firstSegment === "moon" ? "moon" : "sage",
            title: "Overview",
            description: "Check service status, links, and core system actions.",
        });
    }

    if (firstSegment === "raven") {
        return buildSelection({
            section: "ecosystem",
            navSection: "downloads",
            view: "downloader",
            tab: "raven",
            title: "Download rules, workers & VPN",
            description: "Adjust naming, worker limits, and VPN behavior for downloads.",
        });
    }

    if (firstSegment === "vault") {
        return buildSelection({
            section: "ecosystem",
            navSection: "storage",
            view: "database",
            tab: "vault",
            title: "Database",
            description: "Inspect database access, collections, and reset tools.",
        });
    }

    if (firstSegment === "warden") {
        return buildSelection({
            section: "ecosystem",
            navSection: "downloads",
            view: "updater",
            tab: "warden",
            title: "Updates",
            description: "Check for service updates and apply managed image changes.",
        });
    }

    if (firstSegment === "portal") {
        if (!secondSegment || secondSegment === "discord") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "discord",
                tab: "portal",
                portalSubtab: "discord",
                title: "Discord",
                description: "Change Discord bot credentials, onboarding, and command access.",
            });
        }
        if (secondSegment === "kavita") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "kavita",
                tab: "portal",
                portalSubtab: "kavita",
                title: "Kavita",
                description: "Manage Kavita defaults and Portal integration settings.",
            });
        }
        if (secondSegment === "komf") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "komf",
                tab: "portal",
                portalSubtab: "komf",
                title: "Komf",
                description: "Komf application.yml and runtime settings.",
            });
        }
        return null;
    }

    return null;
};

export const resolveLegacySettingsHref = (value: string | string[] | undefined): string => {
    const raw = Array.isArray(value) ? value[0] : value;
    const normalized = typeof raw === "string" ? raw.toLowerCase().trim() : "";
    if (!normalized) return SETTINGS_LANDING_HREF;
    if (normalized === "users" || normalized === "usermanagement") return SETTINGS_USER_MANAGEMENT_HREF;
    if (normalized === "portal") return getSettingsHrefForView("discord");
    if (normalized === "moon" || normalized === "sage") return getSettingsHrefForView("overview");
    if (normalized === "raven") return getSettingsHrefForView("downloader");
    if (normalized === "vault") return getSettingsHrefForView("database");
    if (normalized === "warden") return getSettingsHrefForView("updater");
    return SETTINGS_LANDING_HREF;
};
