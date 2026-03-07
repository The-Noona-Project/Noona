const LEGACY_MOON_PERMISSION_ALIASES = {
    lookup_new_title: "library_management",
    download_new_title: "download_management",
    check_download_missing_titles: "download_management",
    myrecommendations: "myRecommendations",
    managerecommendations: "manageRecommendations",
    my_recommendations: "myRecommendations",
    manage_recommendations: "manageRecommendations",
} as const;

export const MOON_PERMISSION_ORDER = [
    "moon_login",
    "library_management",
    "download_management",
    "myRecommendations",
    "manageRecommendations",
    "user_management",
    "admin",
] as const;

export type MoonPermission = (typeof MOON_PERMISSION_ORDER)[number];

export const MOON_PERMISSION_LABELS: Record<MoonPermission, string> = {
    moon_login: "Moon login",
    library_management: "Library management",
    download_management: "Download management",
    myRecommendations: "My recommendations",
    manageRecommendations: "Manage recommendations",
    user_management: "User management",
    admin: "Admin",
};

export const MOON_PERMISSION_DESCRIPTIONS: Record<MoonPermission, string> = {
    moon_login: "Allows the Discord-linked account to sign in to Moon.",
    library_management: "Lets the user open the Library tab and manage Raven library titles and files.",
    download_management: "Lets the user open the Downloads tab and manage Raven searches, queues, and sync checks.",
    myRecommendations: "Lets the user open Recommendations and view only their own submitted recommendation entries.",
    manageRecommendations: "Lets the user view all recommendation entries and close/delete recommendations.",
    user_management: "Lets the user create, edit, and delete Discord-linked Moon accounts.",
    admin: "Grants full Moon settings and service-management access.",
};

const MOON_PERMISSION_SET = new Set<string>([
    ...MOON_PERMISSION_ORDER,
    ...Object.keys(LEGACY_MOON_PERMISSION_ALIASES),
]);

export const normalizeMoonPermissionKey = (value: unknown): MoonPermission | null => {
    const key = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!key || !MOON_PERMISSION_SET.has(key)) {
        return null;
    }

    return (LEGACY_MOON_PERMISSION_ALIASES[key as keyof typeof LEGACY_MOON_PERMISSION_ALIASES] ?? key) as MoonPermission;
};

export const normalizeMoonPermissions = (value: unknown): MoonPermission[] => {
    if (!Array.isArray(value)) {
        return [];
    }

    const unique = new Set<MoonPermission>();
    for (const entry of value) {
        const key = normalizeMoonPermissionKey(entry);
        if (key) {
            unique.add(key);
        }
    }

    if (unique.has("manageRecommendations")) {
        unique.add("myRecommendations");
    }

    return MOON_PERMISSION_ORDER.filter((entry) => unique.has(entry));
};

export const hasMoonPermission = (
    permissions: string[] | readonly string[] | null | undefined,
    permission: MoonPermission,
): boolean => {
    const normalized = normalizeMoonPermissions(permissions);
    return normalized.includes("admin") || normalized.includes(permission);
};
