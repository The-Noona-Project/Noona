"use client";

import {Button, Card, Column, Text} from "@once-ui-system/core";
import {
    getSettingsHrefForPortalSubtab,
    getSettingsHrefForTab,
    PORTAL_SETTINGS_SUBTABS,
    type PortalSettingsSubtabId,
    SETTINGS_USER_MANAGEMENT_HREF,
    type SettingsMainSectionId,
    type SettingsTabId,
    TAB_LABELS,
    TAB_ORDER,
} from "./settingsRoutes";

type SettingsNavigationProps = {
    activeSection: SettingsMainSectionId;
    activeTab: SettingsTabId;
    portalSubtab: PortalSettingsSubtabId;
    canAccessEcosystem: boolean;
    canManageUsers: boolean;
    onNavigate: (href: string) => void;
};

type NavButtonProps = {
    active: boolean;
    label: string;
    href: string;
    onNavigate: (href: string) => void;
};

const NAV_COLUMN_STYLE = {
    flex: "0 1 15rem",
    minWidth: "min(15rem, 100%)",
};

const NavButton = ({active, label, href, onNavigate}: NavButtonProps) => (
    <Button
        fillWidth
        variant={active ? "primary" : "secondary"}
        style={{justifyContent: "flex-start", textAlign: "left"}}
        onClick={() => onNavigate(href)}
    >
        {label}
    </Button>
);

export function SettingsNavigation({
                                       activeSection,
                                       activeTab,
                                       portalSubtab,
                                       canAccessEcosystem,
                                       canManageUsers,
                                       onNavigate,
                                   }: SettingsNavigationProps) {
    return (
        <Column gap="12" fillWidth position="sticky" top="16" style={NAV_COLUMN_STYLE} s={{position: "static"}}>
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                <Column gap="12">
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Settings Sections
                        </Text>
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            Use this nested menu for settings-only pages. The main Moon navigation lives in the
                            sitewide sidebar.
                        </Text>
                    </Column>

                    {canAccessEcosystem && (
                        <Column gap="8">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                Overview
                            </Text>
                            <NavButton
                                active={activeSection === "ecosystem" && activeTab === "general"}
                                label="General"
                                href={getSettingsHrefForTab("general")}
                                onNavigate={onNavigate}
                            />
                        </Column>
                    )}

                    {canManageUsers && (
                        <Column gap="8">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                Accounts
                            </Text>
                            <NavButton
                                active={activeSection === "users"}
                                label="User Management"
                                href={SETTINGS_USER_MANAGEMENT_HREF}
                                onNavigate={onNavigate}
                            />
                        </Column>
                    )}

                    {canAccessEcosystem && (
                        <Column gap="8">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                Services
                            </Text>
                            {TAB_ORDER.filter((tab) => tab !== "general" && tab !== "portal").map((tab) => (
                                <NavButton
                                    key={tab}
                                    active={activeSection === "ecosystem" && activeTab === tab}
                                    label={TAB_LABELS[tab]}
                                    href={getSettingsHrefForTab(tab)}
                                    onNavigate={onNavigate}
                                />
                            ))}
                        </Column>
                    )}

                    {canAccessEcosystem && (
                        <Column gap="8">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                Portal
                            </Text>
                            {PORTAL_SETTINGS_SUBTABS.map((entry) => (
                                <NavButton
                                    key={entry.id}
                                    active={activeSection === "ecosystem" && activeTab === "portal" && portalSubtab === entry.id}
                                    label={entry.label}
                                    href={getSettingsHrefForPortalSubtab(entry.id)}
                                    onNavigate={onNavigate}
                                />
                            ))}
                        </Column>
                    )}

                    {!canAccessEcosystem && !canManageUsers && (
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            No settings sections are available for this account.
                        </Text>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
