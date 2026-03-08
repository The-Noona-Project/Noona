"use client";

import {usePathname, useRouter} from "next/navigation";
import {type CSSProperties, useEffect, useMemo, useState} from "react";
import {FiMenu, FiX} from "react-icons/fi";
import {Badge, Button, Card, Column, MegaMenu, MobileMegaMenu, Row, Spinner, Text,} from "@once-ui-system/core";
import {moonShell} from "@/resources";
import {hasMoonPermission} from "@/utils/moonPermissions";
import {SETTINGS_NAV_SECTIONS, SETTINGS_USER_MANAGEMENT_HREF} from "@/components/noona/settings";
import {Footer} from "./Footer";
import {type MoonViewMode, MoonViewModeToggle} from "./MoonViewModeToggle";
import {ThemeToggle} from "./ThemeToggle";
import styles from "./AppShell.module.scss";

type ShellAuthUser = {
    username?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    avatarUrl?: string | null;
    permissions?: string[] | null;
};

type ShellAuthStatus = {
    user?: ShellAuthUser | null;
};

type ViewModeConfig = {
    shellPadding: "12" | "20" | "24";
    shellGap: "16" | "20" | "24";
    contentMaxWidth: string;
    drawerWidth: string;
    pageMaxWidth: string;
    pageMaxWidthNarrow: string;
    pageMaxWidthWide: string;
    cardPadding: "m" | "l";
    headerTopOffset: "12" | "20" | "24";
};

const MOON_VIEW_MODE_STORAGE_KEY = "moon-view-mode";
const DEFAULT_MOON_VIEW_MODE: MoonViewMode = "desktop";
const SHELLLESS_ROUTES = new Set(["/login", "/signup", "/discord/callback", "/rebooting"]);
const VIEW_MODE_CONFIG: Record<MoonViewMode, ViewModeConfig> = {
    desktop: {
        shellPadding: "20",
        shellGap: "20",
        contentMaxWidth: "124rem",
        drawerWidth: "22rem",
        pageMaxWidth: "132rem",
        pageMaxWidthNarrow: "92rem",
        pageMaxWidthWide: "132rem",
        cardPadding: "l",
        headerTopOffset: "20",
    },
    ultrawide: {
        shellPadding: "24",
        shellGap: "24",
        contentMaxWidth: "148rem",
        drawerWidth: "24rem",
        pageMaxWidth: "152rem",
        pageMaxWidthNarrow: "112rem",
        pageMaxWidthWide: "152rem",
        cardPadding: "l",
        headerTopOffset: "24",
    },
    mobile: {
        shellPadding: "12",
        shellGap: "16",
        contentMaxWidth: "40rem",
        drawerWidth: "min(22rem, calc(100vw - 1rem))",
        pageMaxWidth: "34rem",
        pageMaxWidthNarrow: "30rem",
        pageMaxWidthWide: "36rem",
        cardPadding: "m",
        headerTopOffset: "12",
    },
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");
const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;

type MegaMenuLink = {
    label: string;
    href: string;
    icon?: string;
    description?: string;
    selected?: boolean;
};

type MegaMenuSection = {
    title?: string;
    links: MegaMenuLink[];
};

type MegaMenuGroup = {
    id: string;
    label: string;
    suffixIcon?: string;
    href?: string;
    selected?: boolean;
    sections?: MegaMenuSection[];
};

const isMoonViewMode = (value: unknown): value is MoonViewMode =>
    value === "desktop" || value === "ultrawide" || value === "mobile";

const getViewModeFromDocument = (): MoonViewMode => {
    if (typeof document === "undefined") {
        return DEFAULT_MOON_VIEW_MODE;
    }

    const attributeValue = document.documentElement.getAttribute("data-moon-view-mode");
    return isMoonViewMode(attributeValue) ? attributeValue : DEFAULT_MOON_VIEW_MODE;
};

const buildPageWidthVariables = (viewMode: MoonViewMode): Record<string, string> => {
    const config = VIEW_MODE_CONFIG[viewMode];
    return {
        "--moon-page-max-width": config.pageMaxWidth,
        "--moon-page-max-width-narrow": config.pageMaxWidthNarrow,
        "--moon-page-max-width-wide": config.pageMaxWidthWide,
    };
};

const isRecommendationsPath = (pathname: string) =>
    pathname.startsWith("/recommendations")
    || pathname.startsWith("/myrecommendations")
    || pathname.startsWith("/recommendation");

const getSettingsItemIcon = (href: string) => {
    if (href.startsWith("/settings/storage")) return "document";
    if (href.startsWith("/settings/downloads")) return "document";
    if (href.startsWith("/settings/external")) return "settings";
    if (href.startsWith("/settings/users")) return "settings";
    return "settings";
};

const TimeDisplay = () => {
    const [currentTime, setCurrentTime] = useState("");

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                hour: "numeric",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            };
            setCurrentTime(new Intl.DateTimeFormat(undefined, options).format(now));
        };

        updateTime();
        const timer = window.setInterval(updateTime, 1000);
        return () => window.clearInterval(timer);
    }, []);

    return <>{currentTime}</>;
};

export function AppShell({children}: { children: React.ReactNode }) {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
    const [accountUser, setAccountUser] = useState<ShellAuthUser | null>(null);
    const [viewMode, setViewMode] = useState<MoonViewMode>(DEFAULT_MOON_VIEW_MODE);
    const [menuOpen, setMenuOpen] = useState(false);

    const shellSuppressed = SHELLLESS_ROUTES.has(pathname);
    const setupLoading = setupCompleted == null;
    const permissions = accountUser?.permissions ?? null;
    const canAccessLibrary = hasMoonPermission(permissions, "library_management");
    const canAccessDownloads = hasMoonPermission(permissions, "download_management");
    const canAccessEcosystemSettings = hasMoonPermission(permissions, "admin");
    const canManageUsers = hasMoonPermission(permissions, "user_management");
    const canManageRecommendations = hasMoonPermission(permissions, "manageRecommendations");
    const canAccessMyRecommendations = hasMoonPermission(permissions, "myRecommendations");
    const canAccessRecommendations = canManageRecommendations || canAccessMyRecommendations;
    const recommendationsNavHref = canManageRecommendations ? "/recommendations" : "/myrecommendations";
    const canAccessSettings = canAccessEcosystemSettings || canManageUsers;
    const showSetupNav = !shellSuppressed && setupCompleted === false;
    const showMainNav = !shellSuppressed && setupCompleted === true;
    const showShellChrome = !shellSuppressed;

    const displayName =
        normalizeString(accountUser?.discordGlobalName).trim()
        || normalizeString(accountUser?.username).trim()
        || normalizeString(accountUser?.discordUsername).trim();
    const handleLabel = normalizeString(accountUser?.discordUsername).trim()
        ? `@${normalizeString(accountUser?.discordUsername).trim()}`
        : normalizeString(accountUser?.username).trim();
    const avatarUrl = normalizeString(accountUser?.avatarUrl).trim();
    const avatarFallback = (displayName || handleLabel || "N").trim().charAt(0).toUpperCase() || "N";
    const viewModeConfig = VIEW_MODE_CONFIG[viewMode];

    useEffect(() => {
        let cancelled = false;

        const loadSetup = async () => {
            try {
                const response = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as { completed?: unknown } | null;
                if (cancelled) return;

                if (payload && typeof payload.completed === "boolean") {
                    setSetupCompleted(payload.completed);
                    return;
                }

                setSetupCompleted(false);
            } catch {
                if (!cancelled) {
                    setSetupCompleted(false);
                }
            }
        };

        void loadSetup();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadAuth = async () => {
            if (setupCompleted !== true || shellSuppressed) {
                setAccountUser(null);
                return;
            }

            try {
                const response = await fetch("/api/noona/auth/status", {cache: "no-store"});
                const payload = (await response.json().catch(() => null)) as ShellAuthStatus | null;
                if (cancelled) return;

                if (!response.ok) {
                    setAccountUser(null);
                    return;
                }

                setAccountUser(payload?.user ?? null);
            } catch {
                if (!cancelled) {
                    setAccountUser(null);
                }
            }
        };

        void loadAuth();
        return () => {
            cancelled = true;
        };
    }, [pathname, setupCompleted, shellSuppressed]);

    useEffect(() => {
        setViewMode(getViewModeFromDocument());
    }, []);

    useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!menuOpen) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setMenuOpen(false);
            }
        };

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [menuOpen]);

    const applyViewMode = (nextViewMode: MoonViewMode) => {
        setViewMode(nextViewMode);
        if (typeof document !== "undefined") {
            document.documentElement.setAttribute("data-moon-view-mode", nextViewMode);
        }
        if (typeof window !== "undefined") {
            window.localStorage.setItem(MOON_VIEW_MODE_STORAGE_KEY, nextViewMode);
        }
    };

    const handleLogout = async () => {
        try {
            await fetch("/api/noona/auth/logout", {method: "POST"});
        } catch {
            // Best effort; a failed logout request should not trap the local shell state.
        } finally {
            setAccountUser(null);
            setMenuOpen(false);
            router.push("/login");
        }
    };

    const menuGroups = useMemo<MegaMenuGroup[]>(() => {
        const groups: MegaMenuGroup[] = [];

        if (showMainNav) {
            const browseSections: MegaMenuSection[] = [
                {
                    title: "Launch",
                    links: [
                        {
                            label: "Home",
                            href: "/",
                            icon: "home",
                            description: "Landing view, recent titles, and quick shortcuts.",
                            selected: pathname === "/",
                        },
                    ],
                },
            ];

            if (canAccessLibrary) {
                browseSections.push({
                    title: "Library",
                    links: [
                        {
                            label: "Library",
                            href: "/libraries",
                            icon: "book",
                            description: "Browse Raven titles and open series detail pages.",
                            selected: pathname.startsWith("/libraries"),
                        },
                    ],
                });
            }

            groups.push({
                id: "browse",
                label: "Browse",
                href: "/",
                suffixIcon: "chevronDown",
                selected: pathname === "/" || pathname.startsWith("/libraries"),
                sections: browseSections,
            });

            const activitySections: MegaMenuSection[] = [];

            if (canAccessDownloads) {
                activitySections.push({
                    title: "Downloads",
                    links: [
                        {
                            label: "Queue overview",
                            href: "/downloads",
                            icon: "document",
                            description: "Monitor active Raven downloads, workers, and history.",
                            selected: pathname.startsWith("/downloads") && !pathname.startsWith("/downloads/add"),
                        },
                        {
                            label: "Add download",
                            href: "/downloads/add",
                            icon: "document",
                            description: "Search sources and queue a new title without leaving Moon.",
                            selected: pathname.startsWith("/downloads/add"),
                        },
                    ],
                });
            }

            if (canAccessRecommendations) {
                const recommendationLinks: MegaMenuLink[] = [];

                if (canManageRecommendations) {
                    recommendationLinks.push({
                        label: "Manager queue",
                        href: "/recommendations",
                        icon: "document",
                        description: "Approve, deny, and review user-submitted title requests.",
                        selected: pathname.startsWith("/recommendations"),
                    });
                }

                if (canAccessMyRecommendations) {
                    recommendationLinks.push({
                        label: "My recommendations",
                        href: "/myrecommendations",
                        icon: "document",
                        description: "Track your own submissions and timeline updates.",
                        selected: pathname.startsWith("/myrecommendations") || pathname.startsWith("/recommendation"),
                    });
                }

                if (recommendationLinks.length > 0) {
                    activitySections.push({
                        title: "Recommendations",
                        links: recommendationLinks,
                    });
                }
            }

            if (activitySections.length > 0) {
                groups.push({
                    id: "activity",
                    label: "Activity",
                    href: canAccessDownloads ? "/downloads" : recommendationsNavHref,
                    suffixIcon: "chevronDown",
                    selected: pathname.startsWith("/downloads") || isRecommendationsPath(pathname),
                    sections: activitySections,
                });
            }

            if (canAccessSettings) {
                const controlSections = SETTINGS_NAV_SECTIONS.flatMap<MegaMenuSection>((section) => {
                    if (section.id === "users") {
                        if (!canManageUsers) {
                            return [];
                        }
                    } else if (!canAccessEcosystemSettings) {
                        return [];
                    }

                    return [
                        {
                            title: section.label,
                            links: section.items.map((item) => ({
                                label: item.label,
                                href: item.href,
                                icon: getSettingsItemIcon(item.href),
                                description: item.description,
                                selected: pathname === item.href || pathname.startsWith(`${item.href}/`),
                            })),
                        },
                    ];
                });

                if (controlSections.length > 0) {
                    groups.push({
                        id: "control",
                        label: "Control",
                        href: canAccessEcosystemSettings ? "/settings/general" : SETTINGS_USER_MANAGEMENT_HREF,
                        suffixIcon: "chevronDown",
                        selected: pathname.startsWith("/settings"),
                        sections: controlSections,
                    });
                }
            }
        }

        if (showSetupNav) {
            groups.push({
                id: "setup",
                label: "Setup",
                href: "/setupwizard",
                suffixIcon: "chevronDown",
                selected: pathname.startsWith("/setupwizard"),
                sections: [
                    {
                        title: "Install",
                        links: [
                            {
                                label: "Setup wizard",
                                href: "/setupwizard",
                                icon: "rocket",
                                description: "Configure storage, integrations, and managed services.",
                                selected: pathname === "/setupwizard",
                            },
                            {
                                label: "Setup summary",
                                href: "/setupwizard/summary",
                                icon: "document",
                                description: "Review completed setup steps and installed services.",
                                selected: pathname.startsWith("/setupwizard/summary"),
                            },
                        ],
                    },
                ],
            });
        }

        return groups;
    }, [
        canAccessDownloads,
        canAccessEcosystemSettings,
        canAccessLibrary,
        canAccessRecommendations,
        canAccessMyRecommendations,
        canAccessSettings,
        canManageRecommendations,
        canManageUsers,
        pathname,
        recommendationsNavHref,
        showMainNav,
        showSetupNav,
    ]);

    const contentStyle = useMemo(
        () =>
            ({
                minWidth: 0,
                ...buildPageWidthVariables(viewMode),
            }) as CSSProperties,
        [viewMode],
    );

    const shellContent = (
        <Column fillWidth gap="24" style={{width: "100%", flex: "1 1 auto", minWidth: 0, minHeight: "100%"}}>
            <Row
                as="header"
                fillWidth
                horizontal="center"
                className={styles.shellHeader}
                style={{top: `var(--static-space-${viewModeConfig.headerTopOffset})`}}
            >
                <Column style={{width: `min(100%, ${viewModeConfig.contentMaxWidth})`, minWidth: 0}}>
                    <Card
                        fillWidth
                        background={BG_SURFACE}
                        border={BG_NEUTRAL_ALPHA_WEAK}
                        padding={viewModeConfig.cardPadding}
                        radius="l"
                    >
                        <Row
                            fillWidth
                            vertical="center"
                            gap="12"
                            style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1fr) auto",
                                alignItems: "center",
                            }}
                        >
                            <Row horizontal="start" style={{minWidth: 0, position: "relative"}}>
                                {!setupLoading && menuGroups.length > 0 && (
                                    <MegaMenu
                                        menuGroups={menuGroups}
                                        m={{hide: true}}
                                        style={{minHeight: "2.5rem", justifySelf: "start"}}
                                    />
                                )}
                            </Row>

                            <Row horizontal="end" vertical="center" gap="12" style={{minWidth: 0}}>
                                {moonShell.showTime && (
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        <TimeDisplay/>
                                    </Badge>
                                )}
                                <Button
                                    size="s"
                                    variant="secondary"
                                    onClick={() => setMenuOpen(true)}
                                    aria-expanded={menuOpen}
                                    aria-controls="moon-shell-drawer"
                                    aria-label="Open navigation menu"
                                >
                                    <Row gap="8" vertical="center">
                                        <FiMenu aria-hidden="true"/>
                                        <Text variant="label-default-s">Menu</Text>
                                    </Row>
                                </Button>
                            </Row>
                        </Row>
                    </Card>
                </Column>
            </Row>

            <Column fillWidth horizontal="center" style={{flex: "1 1 auto", minWidth: 0}}>
                <Column
                    fillWidth
                    gap="24"
                    style={{
                        width: `min(100%, ${viewModeConfig.contentMaxWidth})`,
                        flex: "1 1 auto",
                        minWidth: 0,
                        minHeight: "100%",
                        ...contentStyle,
                    }}
                >
                    <Column fillWidth gap="24" style={{flex: "1 1 auto", minHeight: 0}}>
                        {children}
                    </Column>
                    <Footer/>
                </Column>
            </Column>
        </Column>
    );

    if (!showShellChrome) {
        return (
            <Column fillWidth flex={1} gap="24" padding="16" style={{minHeight: "100vh", minWidth: 0}}>
                <Column fillWidth gap="24" style={{flex: "1 1 auto", minHeight: 0}}>
                    {children}
                </Column>
                <Footer/>
            </Column>
        );
    }

    return (
        <>
            <div
                className={`${styles.drawerBackdrop} ${menuOpen ? styles.drawerBackdropVisible : ""}`}
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
            />

            <aside
                id="moon-shell-drawer"
                className={`${styles.drawerPane} ${menuOpen ? styles.drawerPaneOpen : ""}`}
                style={{width: viewModeConfig.drawerWidth}}
                role="dialog"
                aria-modal="true"
                aria-hidden={!menuOpen}
            >
                <Column className={styles.drawerContent} gap="16">
                    {showMainNav && accountUser && (
                        <Card
                            fillWidth
                            background={BG_SURFACE}
                            border={BG_NEUTRAL_ALPHA_WEAK}
                            padding={viewModeConfig.cardPadding}
                            radius="l"
                        >
                            <Column gap="12">
                                <Row horizontal="between" vertical="center" gap="12">
                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                        Account
                                    </Text>
                                    <Button
                                        size="s"
                                        variant="secondary"
                                        onClick={() => setMenuOpen(false)}
                                        aria-label="Close navigation menu"
                                    >
                                        <Row gap="8" vertical="center">
                                            <FiX aria-hidden="true"/>
                                            <Text variant="label-default-s">Close</Text>
                                        </Row>
                                    </Button>
                                </Row>
                                <Row gap="12" vertical="center">
                                    {avatarUrl ? (
                                        <img
                                            src={avatarUrl}
                                            alt={displayName || handleLabel || "Noona account"}
                                            className={styles.avatar}
                                        />
                                    ) : (
                                        <span className={styles.avatarFallback}>{avatarFallback}</span>
                                    )}
                                    <Column gap="4" style={{minWidth: 0}}>
                                        <Text weight="strong" truncate>
                                            {displayName || "Noona user"}
                                        </Text>
                                        <Text onBackground="neutral-weak" variant="body-default-xs" truncate>
                                            {handleLabel || "Discord account"}
                                        </Text>
                                    </Column>
                                </Row>
                                <Button fillWidth variant="secondary" onClick={() => void handleLogout()}>
                                    Logout
                                </Button>
                            </Column>
                        </Card>
                    )}

                    <Card
                        fillWidth
                        background={BG_SURFACE}
                        border={BG_NEUTRAL_ALPHA_WEAK}
                        padding={viewModeConfig.cardPadding}
                        radius="l"
                    >
                        <Column gap="12">
                            <Row horizontal="between" vertical="center" gap="12">
                                <Text variant="label-default-s" onBackground="neutral-weak">
                                    Navigation
                                </Text>
                                {(!showMainNav || !accountUser) && (
                                    <Button
                                        size="s"
                                        variant="secondary"
                                        onClick={() => setMenuOpen(false)}
                                        aria-label="Close navigation menu"
                                    >
                                        <Row gap="8" vertical="center">
                                            <FiX aria-hidden="true"/>
                                            <Text variant="label-default-s">Close</Text>
                                        </Row>
                                    </Button>
                                )}
                            </Row>
                            {setupLoading && (
                                <Row fillWidth horizontal="center" paddingY="12">
                                    <Spinner/>
                                </Row>
                            )}
                            {!setupLoading && menuGroups.length > 0 && (
                                <MobileMegaMenu
                                    fillWidth
                                    menuGroups={menuGroups}
                                    onClose={() => setMenuOpen(false)}
                                />
                            )}
                            {!setupLoading && menuGroups.length === 0 && (
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Navigation becomes available after setup and sign-in status resolve.
                                </Text>
                            )}
                        </Column>
                    </Card>

                    <Card
                        fillWidth
                        background={BG_SURFACE}
                        border={BG_NEUTRAL_ALPHA_WEAK}
                        padding={viewModeConfig.cardPadding}
                        radius="l"
                    >
                        <Column gap="12">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                Display
                            </Text>
                            <Row gap="8" vertical="center" style={{flexWrap: "wrap"}}>
                                <ThemeToggle/>
                                <MoonViewModeToggle value={viewMode} onChange={applyViewMode}/>
                            </Row>
                            <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                Switch between balanced desktop, wider ultrawide, and constrained mobile framing
                                without leaving the current page.
                            </Text>
                        </Column>
                    </Card>
                </Column>
            </aside>

            <Column
                fillWidth
                gap={viewModeConfig.shellGap}
                padding={viewModeConfig.shellPadding}
                style={{minHeight: "100vh", minWidth: 0}}
            >
                {shellContent}
            </Column>
        </>
    );
}
