import {Geist, Geist_Mono} from "next/font/google";

export const moonSite = {
    title: "Noona Moon",
    shortTitle: "Moon",
    description: "Noona web console for libraries, downloads, setup, and service operations.",
    image: "/favicon.ico",
    organization: "The Noona Project",
    maintainer: "Pax-kun",
    repositoryUrl: "https://github.com/The-Noona-Project/Noona",
    discordUrl: "https://discord.gg/ukhtZrgJ9e",
} as const;

export const moonRoutes = {
    "/": true,
    "/discord/callback": true,
    "/login": true,
    "/signup": true,
    "/setupwizard": true,
    "/setupwizard/summary": true,
    "/libraries": true,
    "/downloads": true,
    "/settings": true,
} as const;

export const moonDynamicRoutePrefixes = ["/libraries"] as const;

export const moonShell = {
    showTime: true,
    showThemeSwitcher: true,
    mastheadLabel: "Noona Moon",
} as const;

const heading = Geist({
    variable: "--font-heading",
    subsets: ["latin"],
    display: "swap",
});

const body = Geist({
    variable: "--font-body",
    subsets: ["latin"],
    display: "swap",
});

const label = Geist({
    variable: "--font-label",
    subsets: ["latin"],
    display: "swap",
});

const code = Geist_Mono({
    variable: "--font-code",
    subsets: ["latin"],
    display: "swap",
});

export const moonFonts = {
    heading,
    body,
    label,
    code,
} as const;

export const moonTheme = {
    theme: "system",
    neutral: "gray",
    brand: "cyan",
    accent: "red",
    solid: "contrast",
    solidStyle: "flat",
    border: "playful",
    surface: "translucent",
    transition: "all",
    scaling: "100",
} as const;

export const moonDataStyle = {
    variant: "gradient",
    mode: "categorical",
    height: 24,
    axis: {
        stroke: "var(--neutral-alpha-weak)",
    },
    tick: {
        fill: "var(--neutral-on-background-weak)",
        fontSize: 11,
        line: false,
    },
} as const;

export const moonEffects = {
    mask: {
        cursor: false,
        x: 50,
        y: 0,
        radius: 100,
    },
    gradient: {
        display: false,
        opacity: 100,
        x: 50,
        y: 60,
        width: 100,
        height: 50,
        tilt: 0,
        colorStart: "accent-background-strong",
        colorEnd: "page-background",
    },
    dots: {
        display: true,
        opacity: 40,
        size: "2",
        color: "brand-background-strong",
    },
    grid: {
        display: false,
        opacity: 100,
        color: "neutral-alpha-medium",
        width: "0.25rem",
        height: "0.25rem",
    },
    lines: {
        display: false,
        opacity: 100,
        color: "neutral-alpha-weak",
        size: "16",
        thickness: 1,
        angle: 45,
    },
} as const;
