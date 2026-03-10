"use client";

import {WeatherFx} from "@once-ui-system/core";

const SITE_LEAF_COLORS = [
    "danger-solid-weak",
    "danger-solid-medium",
    "danger-solid-strong",
];

export function SiteWeatherFx() {
    return (
        <WeatherFx
            fill
            position="absolute"
            top="0"
            left="0"
            zIndex={2}
            type="leaves"
            colors={SITE_LEAF_COLORS}
            intensity={90}
            speed={1.45}
            angle={-28}
            aria-hidden="true"
            style={{pointerEvents: "none"}}
        />
    );
}
