"use client";

import {usePathname, useRouter} from "next/navigation";
import {useEffect, useRef, useState} from "react";

import {Fade, Flex, Line, Row, ToggleButton} from "@once-ui-system/core";

import {moonRoutes, moonShell} from "@/resources";
import {hasMoonPermission} from "@/utils/moonPermissions";
import {ThemeToggle} from "./ThemeToggle";
import styles from "./Header.module.scss";

type HeaderAuthUser = {
    username?: string | null;
    discordUsername?: string | null;
    discordGlobalName?: string | null;
    avatarUrl?: string | null;
    permissions?: string[] | null;
};

type HeaderAuthStatus = {
    user?: HeaderAuthUser | null;
};

type TimeDisplayProps = {
    locale?: string;
};

const normalizeString = (value: unknown): string => (typeof value === "string" ? value : "");

const TimeDisplay: React.FC<TimeDisplayProps> = ({locale}) => {
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
            const timeString = new Intl.DateTimeFormat(locale, options).format(now);
            setCurrentTime(timeString);
        };

        updateTime();
        const intervalId = setInterval(updateTime, 1000);

        return () => clearInterval(intervalId);
    }, [locale]);

    return <>{currentTime}</>;
};

export const Header = () => {
    const pathname = usePathname() ?? "";
    const router = useRouter();
    const menuRef = useRef<HTMLDivElement | null>(null);
    const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
    const [accountUser, setAccountUser] = useState<HeaderAuthUser | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);

    const isAuthRoute = pathname === "/login" || pathname === "/signup";
    const isRebootingRoute = pathname === "/rebooting";

    useEffect(() => {
        let cancelled = false;

        const loadSetup = async () => {
            try {
                const res = await fetch("/api/noona/setup/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as { completed?: unknown } | null;
                if (cancelled) return;

                if (json && typeof json.completed === "boolean") {
                    setSetupCompleted(json.completed);
                    return;
                }

                setSetupCompleted(false);
            } catch {
                if (cancelled) return;
                setSetupCompleted(false);
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
            if (setupCompleted !== true || isAuthRoute) {
                setAccountUser(null);
                return;
            }

            try {
                const res = await fetch("/api/noona/auth/status", {cache: "no-store"});
                const json = (await res.json().catch(() => null)) as HeaderAuthStatus | null;
                if (cancelled) return;

                if (!res.ok) {
                    setAccountUser(null);
                    return;
                }

                setAccountUser(json?.user ?? null);
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
    }, [isAuthRoute, setupCompleted, pathname]);

    useEffect(() => {
        setMenuOpen(false);
    }, [pathname]);

    useEffect(() => {
        if (!menuOpen) return;

        const handlePointerDown = (event: MouseEvent | TouchEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (menuRef.current?.contains(target)) return;
            setMenuOpen(false);
        };

        document.addEventListener("mousedown", handlePointerDown);
        document.addEventListener("touchstart", handlePointerDown);
        return () => {
            document.removeEventListener("mousedown", handlePointerDown);
            document.removeEventListener("touchstart", handlePointerDown);
        };
    }, [menuOpen]);

    const handleLogout = async () => {
        try {
            await fetch("/api/noona/auth/logout", {method: "POST"});
        } catch {
            // Best effort; the local session cookie will still be cleared if the route responds.
        } finally {
            setAccountUser(null);
            setMenuOpen(false);
            router.push("/login");
        }
    };

    const setupStatusLoading = setupCompleted == null;
    const setupLocked = setupCompleted === false;
    const showSetup = !setupStatusLoading && setupLocked && !isAuthRoute;
    const showMainNav = setupCompleted === true && !isAuthRoute;
    const showHeaderNav = !setupStatusLoading && (showMainNav || showSetup);
    const canAccessLibrary = hasMoonPermission(accountUser?.permissions, "library_management");
    const canAccessDownloads = hasMoonPermission(accountUser?.permissions, "download_management");
    const displayName =
        normalizeString(accountUser?.discordGlobalName).trim()
        || normalizeString(accountUser?.username).trim()
        || normalizeString(accountUser?.discordUsername).trim();
    const handleLabel = normalizeString(accountUser?.discordUsername).trim()
        ? `@${normalizeString(accountUser?.discordUsername).trim()}`
        : normalizeString(accountUser?.username).trim();
    const avatarUrl = normalizeString(accountUser?.avatarUrl).trim();
    const avatarFallback = (displayName || handleLabel || "N").trim().charAt(0).toUpperCase() || "N";

    if (isRebootingRoute) {
        return null;
    }

    return (
        <>
            <Fade s={{hide: true}} fillWidth position="fixed" height="80" zIndex={9}/>
            <Fade
                hide
                s={{hide: false}}
                fillWidth
                position="fixed"
                bottom="0"
                to="top"
                height="80"
                zIndex={9}
            />
            <Row
                fitHeight
                className={styles.position}
                position="sticky"
                as="header"
                zIndex={9}
                fillWidth
                padding="8"
                horizontal="center"
                data-border="rounded"
                s={{
                    position: "fixed",
                }}
            >
                <Row paddingLeft="12" fillWidth vertical="center" textVariant="body-default-s">
                    <Row s={{hide: true}} onBackground="neutral-weak">
                        {moonShell.mastheadLabel}
                    </Row>
                </Row>
                <Row fillWidth horizontal="center">
                    {showHeaderNav && (
                        <Row
                            background="page"
                            border="neutral-alpha-weak"
                            radius="m-4"
                            shadow="l"
                            padding="4"
                            horizontal="center"
                            zIndex={1}
                        >
                            <Row gap="4" vertical="center" textVariant="body-default-s" suppressHydrationWarning>
                                {showMainNav && moonRoutes["/"] && (
                                    <ToggleButton prefixIcon="home" href="/" selected={pathname === "/"}/>
                                )}
                                {showMainNav && moonRoutes["/libraries"] && canAccessLibrary && (
                                    <>
                                        <Row s={{hide: true}}>
                                            <ToggleButton
                                                prefixIcon="book"
                                                href="/libraries"
                                                label="Library"
                                                selected={pathname.startsWith("/libraries")}
                                            />
                                        </Row>
                                        <Row hide s={{hide: false}}>
                                            <ToggleButton
                                                prefixIcon="book"
                                                href="/libraries"
                                                selected={pathname.startsWith("/libraries")}
                                            />
                                        </Row>
                                    </>
                                )}
                                {showMainNav && moonRoutes["/downloads"] && canAccessDownloads && (
                                    <>
                                        <Row s={{hide: true}}>
                                            <ToggleButton
                                                prefixIcon="document"
                                                href="/downloads"
                                                label="Downloads"
                                                selected={pathname.startsWith("/downloads")}
                                            />
                                        </Row>
                                        <Row hide s={{hide: false}}>
                                            <ToggleButton
                                                prefixIcon="document"
                                                href="/downloads"
                                                selected={pathname.startsWith("/downloads")}
                                            />
                                        </Row>
                                    </>
                                )}
                                {moonRoutes["/setupwizard"] && showSetup && (
                                    <>
                                        <Row s={{hide: true}}>
                                            <ToggleButton
                                                prefixIcon="rocket"
                                                href="/setupwizard"
                                                label="Setup"
                                                selected={pathname === "/setupwizard"}
                                            />
                                        </Row>
                                        <Row hide s={{hide: false}}>
                                            <ToggleButton
                                                prefixIcon="rocket"
                                                href="/setupwizard"
                                                selected={pathname === "/setupwizard"}
                                            />
                                        </Row>
                                    </>
                                )}
                                {moonShell.showThemeSwitcher && (
                                    <>
                                        <Line background="neutral-alpha-medium" vert maxHeight="24"/>
                                        <ThemeToggle/>
                                    </>
                                )}
                            </Row>
                        </Row>
                    )}
                </Row>
                <Flex fillWidth horizontal="end" vertical="center">
                    <Flex
                        paddingRight="12"
                        horizontal="end"
                        vertical="center"
                        textVariant="body-default-s"
                        gap="12"
                    >
                        <Flex s={{hide: true}}>
                            {moonShell.showTime && <TimeDisplay/>}
                        </Flex>
                        {showMainNav && accountUser && (
                            <div className={styles.accountShell} ref={menuRef}>
                                <button
                                    type="button"
                                    className={styles.accountButton}
                                    onClick={() => setMenuOpen((prev) => !prev)}
                                    aria-haspopup="menu"
                                    aria-expanded={menuOpen}
                                    aria-label="Open account menu"
                                >
                                    {avatarUrl ? (
                                        <img src={avatarUrl} alt={displayName || handleLabel || "Noona account"}
                                             className={styles.accountAvatar}/>
                                    ) : (
                                        <span className={styles.accountAvatarFallback}>{avatarFallback}</span>
                                    )}
                                    <span className={styles.accountMeta}>
                                        <span className={styles.accountName}>{displayName || "Noona user"}</span>
                                        <span className={styles.accountHandle}>{handleLabel || "Discord account"}</span>
                                    </span>
                                    <span className={styles.accountChevron}>{menuOpen ? "^" : "v"}</span>
                                </button>
                                {menuOpen && (
                                    <div className={styles.accountMenu} role="menu">
                                        <div className={styles.accountMenuHeader}>
                                            <div className={styles.accountMenuName}>{displayName || "Noona user"}</div>
                                            <div
                                                className={styles.accountMenuHandle}>{handleLabel || "Discord account"}</div>
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.accountMenuAction}
                                            role="menuitem"
                                            onClick={() => {
                                                setMenuOpen(false);
                                                router.push("/settings");
                                            }}
                                        >
                                            <span>Settings</span>
                                            <span>{">"}</span>
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.accountMenuAction}
                                            role="menuitem"
                                            onClick={() => void handleLogout()}
                                        >
                                            <span>Logout</span>
                                            <span>{">"}</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </Flex>
                </Flex>
            </Row>
        </>
    );
};
