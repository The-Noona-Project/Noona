"use client";

import {usePathname, useRouter} from "next/navigation";
import {type CSSProperties, useEffect, useMemo, useState} from "react";
import {FiMenu, FiX} from "react-icons/fi";
import {Badge, Button, Card, Column, Heading, Row, Spinner, Text, ToggleButton} from "@once-ui-system/core";
import {moonShell} from "@/resources";
import {hasMoonPermission} from "@/utils/moonPermissions";
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

type NavItem = {
    href: string;
    label: string;
    icon: string;
    selected: boolean;
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

type TimeDisplayProps = {
    locale?: string;
};

const TimeDisplay = ({locale}: TimeDisplayProps) => {
    const [currentTime, setCurrentTime] = useState("");

    useEffect(() => {
        const updateTime = () => {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: false,
            };
            setCurrentTime(new Intl.DateTimeFormat(locale, options).format(now));
        };

        updateTime();
        const timer = window.setInterval(updateTime, 1000);
        return () => window.clearInterval(timer);
    }, [locale]);

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
    const canAccessSettings =
        hasMoonPermission(permissions, "admin") || hasMoonPermission(permissions, "user_management");
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

    const navItems = useMemo<NavItem[]>(() => {
        const items: NavItem[] = [];

        if (showMainNav) {
            items.push({
                href: "/",
                label: "Home",
                icon: "home",
                selected: pathname === "/",
            });

            if (canAccessLibrary) {
                items.push({
                    href: "/libraries",
                    label: "Library",
                    icon: "book",
                    selected: pathname.startsWith("/libraries"),
                });
            }

            if (canAccessDownloads) {
                items.push({
                    href: "/downloads",
                    label: "Downloads",
                    icon: "document",
                    selected: pathname.startsWith("/downloads"),
                });
            }

            if (canAccessSettings) {
                items.push({
                    href: "/settings/general",
                    label: "Settings",
                    icon: "settings",
                    selected: pathname.startsWith("/settings"),
                });
            }
        }

        if (showSetupNav) {
            items.push({
                href: "/setupwizard",
                label: "Setup",
                icon: "rocket",
                selected: pathname.startsWith("/setupwizard"),
            });
        }

        return items;
    }, [canAccessDownloads, canAccessLibrary, canAccessSettings, pathname, showMainNav, showSetupNav]);

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
                        background="surface"
                        border="neutral-alpha-weak"
                        padding={viewModeConfig.cardPadding}
                        radius="l"
                    >
                        <Row
                            fillWidth
                            vertical="center"
                            gap="12"
                            style={{
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
                                alignItems: "center",
                            }}
                        >
                            <Row style={{minWidth: 0}}>
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

                            <Row horizontal="center" style={{minWidth: 0}}>
                                <Row gap="12" vertical="center" style={{minWidth: 0}}>
                                    <span className={styles.brandMark} aria-hidden="true">NM</span>
                                    <Column gap="2" style={{minWidth: 0}}>
                                        <Text variant="label-default-s" onBackground="neutral-weak">
                                            {showSetupNav ? "Setup mode" : "Noona Stack"}
                                        </Text>
                                        <Heading as="h1" variant="heading-strong-l">
                                            {moonShell.mastheadLabel}
                                        </Heading>
                                    </Column>
                                </Row>
                            </Row>

                            <Row horizontal="end" style={{minWidth: 0}}>
                                {moonShell.showTime && (
                                    <Badge background="neutral-alpha-weak" onBackground="neutral-strong">
                                        <TimeDisplay/>
                                    </Badge>
                                )}
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
                            background="surface"
                            border="neutral-alpha-weak"
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
                        background="surface"
                        border="neutral-alpha-weak"
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
                            {!setupLoading && navItems.map((item) => (
                                <ToggleButton
                                    key={item.href}
                                    fillWidth
                                    prefixIcon={item.icon}
                                    label={item.label}
                                    href={item.href}
                                    selected={item.selected}
                                    onClick={() => setMenuOpen(false)}
                                />
                            ))}
                            {!setupLoading && navItems.length === 0 && (
                                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                                    Navigation becomes available after setup and sign-in status resolve.
                                </Text>
                            )}
                        </Column>
                    </Card>

                    <Card
                        fillWidth
                        background="surface"
                        border="neutral-alpha-weak"
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
