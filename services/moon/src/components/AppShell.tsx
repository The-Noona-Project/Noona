"use client";

import {usePathname, useRouter} from "next/navigation";
import {type CSSProperties, useEffect, useMemo, useRef, useState} from "react";
import {FiMenu, FiPlus, FiX} from "react-icons/fi";
import {Accordion, Badge, Button, Card, Column, MegaMenu, Option, Row, Spinner, Text,} from "@once-ui-system/core";
import {moonShell} from "@/resources";
import {hasMoonPermission} from "@/utils/moonPermissions";
import {
    getSettingsHrefForView,
    SETTINGS_LANDING_HREF,
    SETTINGS_USER_MANAGEMENT_HREF
} from "@/components/noona/settings";
import {Footer} from "./Footer";
import {MoonMusicCard} from "./MoonMusicCard";
import {isMoonShellSuppressedPath} from "./noona/moonShellRoutes.mjs";
import {NOONA_OPEN_MUSIC_CONTROLS_EVENT} from "./noona/siteNotificationLive.mjs";
import {type MoonViewMode, MoonViewModeToggle} from "./MoonViewModeToggle";
import {ThemeToggle} from "./ThemeToggle";
import styles from "./AppShell.module.scss";

type ShellAuthUser = {
    username?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    discordUserId?: string | null;
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
const DEFAULT_MOON_VIEW_MODE: MoonViewMode = "ultrawide";
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

const isAdminPath = (pathname: string) =>
    pathname.startsWith("/settings") || pathname.startsWith("/setupwizard");

const isLinkSelected = (pathname: string, href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

const MobileNavigationMenu = ({
                                  menuGroups,
                                  onClose,
                              }: {
    menuGroups: MegaMenuGroup[];
    onClose: () => void;
}) => (
    <Column fillWidth gap="8">
        {menuGroups.map((group) => {
            if (group.href && !group.sections) {
                return (
                    <Button
                        key={group.id}
                        fillWidth
                        horizontal="start"
                        variant={group.selected ? "primary" : "secondary"}
                        href={group.href}
                        onClick={onClose}
                    >
                        {group.label}
                    </Button>
                );
            }

            return (
                <Accordion
                    key={group.id}
                    title={group.label}
                    icon={group.suffixIcon || "chevronDown"}
                    size="m"
                    radius="l"
                    open={group.selected === true}
                >
                    <Column fillWidth gap="12" paddingX="8" paddingY="8">
                        {group.sections?.map((section, sectionIndex) => (
                            <Column key={`${group.id}-${section.title ?? sectionIndex}`} gap="4" fillWidth>
                                {section.title && (
                                    <Text variant="label-default-s" onBackground="neutral-weak">
                                        {section.title}
                                    </Text>
                                )}
                                {section.links.map((link) => (
                                    <Option
                                        key={`${group.id}-${section.title ?? sectionIndex}-${link.href}`}
                                        href={link.href}
                                        value={link.href}
                                        selected={link.selected}
                                        label={link.label}
                                        description={link.description}
                                        onClick={onClose}
                                    />
                                ))}
                            </Column>
                        ))}
                    </Column>
                </Accordion>
            );
        })}
    </Column>
);

const isRequestsPath = (pathname: string) =>
    pathname.startsWith("/recommendations")
    || pathname.startsWith("/myrecommendations")
    || pathname.startsWith("/mysubscriptions")
    || pathname.startsWith("/recommendation");

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
    const menuOpenRef = useRef(false);
    const musicControlsRef = useRef<HTMLDivElement | null>(null);
    const pendingMusicFocusRef = useRef(false);

    const shellSuppressed = isMoonShellSuppressedPath(pathname);
    const setupLoading = setupCompleted == null;
    const permissions = accountUser?.permissions ?? null;
    const canAccessLibrary = hasMoonPermission(permissions, "library_management");
    const canAccessDownloads = hasMoonPermission(permissions, "download_management");
    const canAccessEcosystemSettings = hasMoonPermission(permissions, "admin");
    const canManageUsers = hasMoonPermission(permissions, "user_management");
    const canManageRecommendations = hasMoonPermission(permissions, "manageRecommendations");
    const canAccessMyRecommendations = hasMoonPermission(permissions, "myRecommendations");
    const canAccessMySubscriptions = hasMoonPermission(permissions, "mySubscriptions");
    const canAccessRecommendations = canManageRecommendations || canAccessMyRecommendations;
    const requestsNavHref = canManageRecommendations
        ? "/recommendations"
        : canAccessRecommendations
            ? "/myrecommendations"
            : canAccessMySubscriptions
                ? "/mysubscriptions"
                : "/";
    const canAccessSettings = canAccessEcosystemSettings || canManageUsers;
    const showSetupNav = !shellSuppressed && setupCompleted === false;
    const showMainNav = !shellSuppressed && setupCompleted === true;
    const showShellChrome = !shellSuppressed;
    const setupNavHref = pathname.startsWith("/setupwizard/summary") ? "/setupwizard/summary" : "/setupwizard";
    const showSetupSummaryLink = pathname.startsWith("/setupwizard");

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
        menuOpenRef.current = menuOpen;
    }, [menuOpen]);

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

    useEffect(() => {
        if (showMainNav) {
            return;
        }

        pendingMusicFocusRef.current = false;
    }, [showMainNav]);

    useEffect(() => {
        if (!showMainNav) {
            return;
        }

        const focusMusicControls = () => {
            const node = musicControlsRef.current;
            if (!node) {
                return false;
            }

            node.scrollIntoView({behavior: "smooth", block: "nearest"});
            node.focus({preventScroll: true});
            return true;
        };

        const handleOpenMusicControls = () => {
            pendingMusicFocusRef.current = true;
            setMenuOpen(true);

            if (menuOpenRef.current && focusMusicControls()) {
                pendingMusicFocusRef.current = false;
            }
        };

        window.addEventListener(NOONA_OPEN_MUSIC_CONTROLS_EVENT, handleOpenMusicControls);
        return () => {
            window.removeEventListener(NOONA_OPEN_MUSIC_CONTROLS_EVENT, handleOpenMusicControls);
        };
    }, [showMainNav]);

    useEffect(() => {
        if (!showMainNav || !menuOpen || !pendingMusicFocusRef.current) {
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            const node = musicControlsRef.current;
            pendingMusicFocusRef.current = false;
            if (!node) {
                return;
            }

            node.scrollIntoView({behavior: "smooth", block: "nearest"});
            node.focus({preventScroll: true});
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [menuOpen, showMainNav]);

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
            groups.push({
                id: "home",
                label: "Home",
                href: "/",
                selected: pathname === "/",
            });

            if (canAccessLibrary) {
                groups.push({
                    id: "library",
                    label: "Library",
                    href: "/libraries",
                    selected: pathname.startsWith("/libraries"),
                });
            }

            if (canAccessDownloads) {
                groups.push({
                    id: "downloads",
                    label: "Downloads",
                    href: "/downloads",
                    selected: pathname.startsWith("/downloads"),
                });
            }

            const requestLinks: MegaMenuLink[] = [];

            if (canAccessRecommendations) {
                if (canManageRecommendations) {
                    requestLinks.push({
                        label: "Review requests",
                        href: "/recommendations",
                        icon: "document",
                        description: "Approve, deny, and comment on user download requests.",
                        selected: pathname.startsWith("/recommendations"),
                    });
                }

                if (canAccessMyRecommendations) {
                    requestLinks.push({
                        label: "My requests",
                        href: "/myrecommendations",
                        icon: "document",
                        description: "Check the status and updates on your submitted requests.",
                        selected: pathname.startsWith("/myrecommendations") || pathname.startsWith("/recommendation"),
                    });
                }
            }

            if (canAccessMySubscriptions) {
                requestLinks.push({
                    label: "Following",
                    href: "/mysubscriptions",
                    icon: "document",
                    description: "Manage followed titles and chapter notifications.",
                    selected: pathname.startsWith("/mysubscriptions"),
                });
            }

            if (requestLinks.length > 0) {
                groups.push({
                    id: "requests",
                    label: "Requests",
                    href: requestsNavHref,
                    suffixIcon: "chevronDown",
                    selected: isRequestsPath(pathname),
                    sections: [{links: requestLinks}],
                });
            }

            if (canAccessSettings) {
                const adminSections: MegaMenuSection[] = [];

                if (canAccessEcosystemSettings) {
                    adminSections.push({
                        title: "System",
                        links: [
                            {
                                label: "Overview",
                                href: getSettingsHrefForView("overview"),
                                icon: "settings",
                                description: "Check service status, links, and core system actions.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("overview")),
                            },
                            {
                                label: "Storage folders",
                                href: getSettingsHrefForView("filesystem"),
                                icon: "document",
                                description: "Review storage paths, shared mounts, and folder layout.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("filesystem")),
                            },
                            {
                                label: "Database",
                                href: getSettingsHrefForView("database"),
                                icon: "document",
                                description: "Inspect database access, collections, and reset tools.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("database")),
                            },
                            {
                                label: "Updates",
                                href: getSettingsHrefForView("updater"),
                                icon: "settings",
                                description: "Check for service updates and apply managed image changes.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("updater")),
                            },
                        ],
                    });

                    adminSections.push({
                        title: "Downloads",
                        links: [
                            {
                                label: "Download rules, workers & VPN",
                                href: getSettingsHrefForView("downloader"),
                                icon: "document",
                                description: "Adjust naming, worker limits, and VPN behavior for downloads.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("downloader")),
                            },
                        ],
                    });

                    adminSections.push({
                        title: "Integrations",
                        links: [
                            {
                                label: "Discord",
                                href: getSettingsHrefForView("discord"),
                                icon: "settings",
                                description: "Change Discord bot credentials, onboarding, and command access.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("discord")),
                            },
                            {
                                label: "Kavita",
                                href: getSettingsHrefForView("kavita"),
                                icon: "settings",
                                description: "Manage Kavita defaults and Portal integration settings.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("kavita")),
                            },
                            {
                                label: "Komf",
                                href: getSettingsHrefForView("komf"),
                                icon: "settings",
                                description: "Edit Komf metadata settings and the managed application.yml.",
                                selected: isLinkSelected(pathname, getSettingsHrefForView("komf")),
                            },
                        ],
                    });
                }

                if (canManageUsers) {
                    adminSections.push({
                        title: "People",
                        links: [
                            {
                                label: "Users & roles",
                                href: SETTINGS_USER_MANAGEMENT_HREF,
                                icon: "settings",
                                description: "Manage Moon accounts, roles, and default permissions.",
                                selected: isLinkSelected(pathname, SETTINGS_USER_MANAGEMENT_HREF),
                            },
                        ],
                    });
                }

                if (canAccessEcosystemSettings) {
                    const setupLinks: MegaMenuLink[] = [
                        {
                            label: "Resume setup",
                            href: "/setupwizard",
                            icon: "rocket",
                            description: "Reopen the guided setup flow to review or change the stack profile.",
                            selected: pathname === "/setupwizard",
                        },
                    ];

                    if (showSetupSummaryLink) {
                        setupLinks.push({
                            label: "Setup summary",
                            href: "/setupwizard/summary",
                            icon: "document",
                            description: "Review the setup summary and final stack details.",
                            selected: pathname.startsWith("/setupwizard/summary"),
                        });
                    }

                    adminSections.push({
                        title: "Setup",
                        links: setupLinks,
                    });
                }

                if (adminSections.length > 0) {
                    groups.push({
                        id: "admin",
                        label: "Admin",
                        href: canAccessEcosystemSettings ? SETTINGS_LANDING_HREF : SETTINGS_USER_MANAGEMENT_HREF,
                        suffixIcon: "chevronDown",
                        selected: isAdminPath(pathname),
                        sections: adminSections,
                    });
                }
            }
        }

        if (showSetupNav) {
            groups.push({
                id: "setup",
                label: "Setup",
                href: setupNavHref,
                selected: pathname.startsWith("/setupwizard"),
            });
        }

        return groups;
    }, [
        canAccessDownloads,
        canAccessEcosystemSettings,
        canAccessLibrary,
        canAccessMySubscriptions,
        canAccessRecommendations,
        canAccessMyRecommendations,
        canAccessSettings,
        canManageRecommendations,
        canManageUsers,
        pathname,
        requestsNavHref,
        showMainNav,
        showSetupSummaryLink,
        showSetupNav,
        setupNavHref,
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
                                {showMainNav && canAccessDownloads && (
                                    <Button
                                        size="s"
                                        variant="primary"
                                        href="/downloads/add"
                                        onClick={() => setMenuOpen(false)}
                                        aria-label="Add download"
                                    >
                                        <Row gap="8" vertical="center">
                                            <FiPlus aria-hidden="true"/>
                                            <Row s={{hide: true}}>
                                                <Text variant="label-default-s">Add download</Text>
                                            </Row>
                                        </Row>
                                    </Button>
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
                                <MobileNavigationMenu menuGroups={menuGroups} onClose={() => setMenuOpen(false)}/>
                            )}
                            {!setupLoading && menuGroups.length === 0 && (
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Navigation becomes available after setup and sign-in status resolve.
                                </Text>
                            )}
                        </Column>
                    </Card>

                    {showMainNav && (
                        <div ref={musicControlsRef} tabIndex={-1} aria-label="Music controls" style={{outline: "none"}}>
                            <MoonMusicCard cardPadding={viewModeConfig.cardPadding}/>
                        </div>
                    )}

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
