"use client";

import {Row, ToggleButton} from "@once-ui-system/core";

export type MoonViewMode = "desktop" | "ultrawide" | "mobile";

type MoonViewModeToggleProps = {
    value: MoonViewMode;
    onChange: (value: MoonViewMode) => void;
};

const VIEW_MODES: Array<{ id: MoonViewMode; icon: string; label: string }> = [
    {
        id: "desktop",
        icon: "desktop",
        label: "Desktop view",
    },
    {
        id: "ultrawide",
        icon: "ultrawide",
        label: "Ultrawide view",
    },
    {
        id: "mobile",
        icon: "mobile",
        label: "Mobile view",
    },
];

export function MoonViewModeToggle({value, onChange}: MoonViewModeToggleProps) {
    return (
        <Row background="surface" border="neutral-alpha-weak" padding="4" radius="full" gap="4">
            {VIEW_MODES.map((entry) => (
                <ToggleButton
                    key={entry.id}
                    prefixIcon={entry.icon}
                    selected={value === entry.id}
                    aria-label={entry.label}
                    onClick={() => onChange(entry.id)}
                />
            ))}
        </Row>
    );
}
