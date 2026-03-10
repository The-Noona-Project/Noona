"use client";

import {Button, Card, Column, Text} from "@once-ui-system/core";
import {SETTINGS_NAV_SECTIONS, type SettingsNavSectionId, type SettingsViewId,} from "./settingsRoutes";

type SettingsNavigationProps = {
    activeSection: SettingsNavSectionId;
    activeView: SettingsViewId;
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
    flex: "0 1 18rem",
    minWidth: "min(18rem, 100%)",
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
                                       activeView,
                                       canAccessEcosystem,
                                       canManageUsers,
                                       onNavigate,
                                   }: SettingsNavigationProps) {
    const visibleSections = SETTINGS_NAV_SECTIONS.filter((section) => {
        if (section.id === "users") {
            return canManageUsers;
        }

        return canAccessEcosystem;
    });

    return (
        <Column gap="12" fillWidth position="sticky" top="16" style={NAV_COLUMN_STYLE} s={{position: "static"}}>
            <Card fillWidth background="surface" border="neutral-alpha-weak" padding="m" radius="l">
                <Column gap="12">
                    <Column gap="4">
                        <Text variant="label-default-s" onBackground="neutral-weak">
                            Settings
                        </Text>
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            Grouped by what the user is trying to do instead of by internal service names.
                        </Text>
                    </Column>

                    {visibleSections.map((section) => (
                        <Column key={section.id} gap="8">
                            <Text variant="label-default-s" onBackground="neutral-weak">
                                {section.label}
                            </Text>
                            {section.items.map((item) => (
                                <NavButton
                                    key={item.id}
                                    active={activeSection === section.id && activeView === item.id}
                                    label={item.label}
                                    href={item.href}
                                    onNavigate={onNavigate}
                                />
                            ))}
                        </Column>
                    ))}

                    {visibleSections.length === 0 && (
                        <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                            No settings sections are available for this account.
                        </Text>
                    )}
                </Column>
            </Card>
        </Column>
    );
}
