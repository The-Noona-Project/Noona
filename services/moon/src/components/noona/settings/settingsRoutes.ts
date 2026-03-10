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
    overview: "General",
    filesystem: "FileSystem",
    database: "Database",
    downloader: "Downloader",
    updater: "Noona Updater",
    discord: "Discord",
    kavita: "Kavita",
    komf: "Komf",
    users: "Users",
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
        label: "General",
        items: [
            {
                id: "overview",
                label: "Overview",
                href: getSettingsHrefForView("overview"),
                description: "Loaded profile, service links, and ecosystem controls.",
            },
        ],
    },
    {
        id: "storage",
        label: "Storage",
        items: [
            {
                id: "filesystem",
                label: "FileSystem",
                href: getSettingsHrefForView("filesystem"),
                description: "Folder tree, storage root, and shared mounts.",
            },
            {
                id: "database",
                label: "Database",
                href: getSettingsHrefForView("database"),
                description: "Mongo URI, collection viewer, and reset tooling.",
            },
        ],
    },
    {
        id: "downloads",
        label: "Downloads",
        items: [
            {
                id: "downloader",
                label: "Downloader",
                href: getSettingsHrefForView("downloader"),
                description: "Raven worker controls, speed limits, and naming.",
            },
            {
                id: "updater",
                label: "Noona Updater",
                href: getSettingsHrefForView("updater"),
                description: "Managed Docker checks, update actions, and auto-update policy.",
            },
        ],
    },
    {
        id: "external",
        label: "External",
        items: [
            {
                id: "discord",
                label: "Discord",
                href: getSettingsHrefForView("discord"),
                description: "Portal Discord bot credentials, validation, and command roles.",
            },
            {
                id: "kavita",
                label: "Kavita",
                href: getSettingsHrefForView("kavita"),
                description: "Kavita account defaults and Portal bridge settings.",
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
        label: "Users",
        items: [
            {
                id: "users",
                label: "User Management",
                href: SETTINGS_USER_MANAGEMENT_HREF,
                description: "Manage Discord-linked Moon accounts and default permissions.",
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
            title: "General",
            description: "Loaded profile, service links, and ecosystem controls.",
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
            title: "General",
            description: "Loaded profile, service links, and ecosystem controls.",
        });
    }

    if (firstSegment === "storage") {
        if (!secondSegment || secondSegment === "filesystem") {
            return buildSelection({
                section: "ecosystem",
                navSection: "storage",
                view: "filesystem",
                tab: "vault",
                title: "Storage FileSystem",
                description: "Folder tree, storage root, and shared mount paths.",
            });
        }
        if (secondSegment === "database") {
            return buildSelection({
                section: "ecosystem",
                navSection: "storage",
                view: "database",
                tab: "vault",
                title: "Storage Database",
                description: "Mongo URI, collection viewer, and reset controls.",
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
                title: "Downloads Downloader",
                description: "Raven worker controls, speed limits, and naming.",
            });
        }
        if (secondSegment === "updater") {
            return buildSelection({
                section: "ecosystem",
                navSection: "downloads",
                view: "updater",
                tab: "warden",
                title: "Downloads Noona Updater",
                description: "Managed Docker checks, update actions, and auto-update policy.",
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
                title: "External Discord",
                description: "Portal Discord bot credentials, validation, and command roles.",
            });
        }
        if (secondSegment === "kavita") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "kavita",
                tab: "portal",
                portalSubtab: "kavita",
                title: "External Kavita",
                description: "Kavita account defaults and Portal bridge settings.",
            });
        }
        if (secondSegment === "komf") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "komf",
                tab: "portal",
                portalSubtab: "komf",
                title: "External Komf",
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
            title: "User Management",
            description: "Manage Discord-linked Moon accounts and default permissions for new users.",
        });
    }

    if (firstSegment === "moon" || firstSegment === "sage") {
        return buildSelection({
            section: "ecosystem",
            navSection: "general",
            view: "overview",
            tab: firstSegment === "moon" ? "moon" : "sage",
            title: "General",
            description: "Loaded profile, service links, and ecosystem controls.",
        });
    }

    if (firstSegment === "raven") {
        return buildSelection({
            section: "ecosystem",
            navSection: "downloads",
            view: "downloader",
            tab: "raven",
            title: "Downloads Downloader",
            description: "Raven worker controls, speed limits, and naming.",
        });
    }

    if (firstSegment === "vault") {
        return buildSelection({
            section: "ecosystem",
            navSection: "storage",
            view: "database",
            tab: "vault",
            title: "Storage Database",
            description: "Mongo URI, collection viewer, and reset controls.",
        });
    }

    if (firstSegment === "warden") {
        return buildSelection({
            section: "ecosystem",
            navSection: "downloads",
            view: "updater",
            tab: "warden",
            title: "Downloads Noona Updater",
            description: "Managed Docker checks, update actions, and auto-update policy.",
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
                title: "External Discord",
                description: "Portal Discord bot credentials, validation, and command roles.",
            });
        }
        if (secondSegment === "kavita") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "kavita",
                tab: "portal",
                portalSubtab: "kavita",
                title: "External Kavita",
                description: "Kavita account defaults and Portal bridge settings.",
            });
        }
        if (secondSegment === "komf") {
            return buildSelection({
                section: "ecosystem",
                navSection: "external",
                view: "komf",
                tab: "portal",
                portalSubtab: "komf",
                title: "External Komf",
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
