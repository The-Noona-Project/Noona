"use client";

import React from "react";
import {ToggleButton, useTheme} from "@once-ui-system/core";

export const ThemeToggle: React.FC = () => {
    const {theme, setTheme} = useTheme();
    const currentTheme = theme === "dark" ? "dark" : "light";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    return (
        <ToggleButton
            prefixIcon={nextTheme}
            onClick={() => setTheme(nextTheme)}
            aria-label={`Switch to ${nextTheme} mode`}
        />
    );
};
