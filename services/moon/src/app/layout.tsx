import "@once-ui-system/core/css/styles.css";
import "@once-ui-system/core/css/tokens.css";
import "@/resources/custom.css";

import classNames from "classnames";

import {Background, Column, Flex, Meta, opacity, RevealFx, SpacingToken,} from "@once-ui-system/core";
import {AppShell, Providers, RouteGuard, SiteWeatherFx} from "@/components";
import {moonDataStyle, moonEffects, moonFonts, moonSite, moonTheme} from "@/resources";
import {resolveMoonBaseUrl} from "@/utils/webGui";

const BG_PAGE = "page" as const;

export async function generateMetadata() {
    return Meta.generate({
        title: moonSite.title,
        description: moonSite.description,
        baseURL: resolveMoonBaseUrl(),
        path: "/",
        image: moonSite.image,
    });
}

export default async function RootLayout({
                                             children,
                                         }: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <Flex
            suppressHydrationWarning
            as="html"
            lang="en"
            fillWidth
            className={classNames(
                moonFonts.heading.variable,
                moonFonts.body.variable,
                moonFonts.label.variable,
                moonFonts.code.variable,
            )}
        >
            <head>
                <title>{moonSite.title}</title>
                <script
                    id="theme-init"
                    dangerouslySetInnerHTML={{
                        __html: `
              (function() {
                try {
                  const root = document.documentElement;
                  const defaultTheme = 'system';
                  
                  // Set defaults from config
                  const config = ${JSON.stringify({
                            brand: moonTheme.brand,
                            accent: moonTheme.accent,
                            neutral: moonTheme.neutral,
                            solid: moonTheme.solid,
                            "solid-style": moonTheme.solidStyle,
                            border: moonTheme.border,
                            surface: moonTheme.surface,
                            transition: moonTheme.transition,
                            scaling: moonTheme.scaling,
                            "viz-style": moonDataStyle.variant,
                        })};
                  
                  // Apply default values
                  Object.entries(config).forEach(([key, value]) => {
                    root.setAttribute('data-' + key, value);
                  });
                  
                  // Resolve theme
                  const resolveTheme = (themeValue) => {
                    if (!themeValue || themeValue === 'system') {
                      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
                    }
                    return themeValue;
                  };
                  
                  // Apply saved theme
                  const savedTheme = localStorage.getItem('data-theme');
                  const resolvedTheme = resolveTheme(savedTheme);
                  root.setAttribute('data-theme', resolvedTheme);
                  
                  // Apply any saved style overrides
                  const styleKeys = Object.keys(config);
                  styleKeys.forEach(key => {
                    const value = localStorage.getItem('data-' + key);
                    if (value) {
                      root.setAttribute('data-' + key, value);
                    }
                  });

                  const savedViewMode = localStorage.getItem('moon-view-mode');
                  const resolvedViewMode =
                    savedViewMode === 'desktop' || savedViewMode === 'mobile' ? savedViewMode : 'ultrawide';
                  root.setAttribute('data-moon-view-mode', resolvedViewMode);
                } catch (e) {
                  console.error('Failed to initialize theme:', e);
                  document.documentElement.setAttribute('data-theme', 'dark');
                  document.documentElement.setAttribute('data-moon-view-mode', 'ultrawide');
                }
              })();
            `,
                    }}
                />
            </head>
            <Providers>
                <Column
                    as="body"
                    background={BG_PAGE}
                    fillWidth
                    style={{minHeight: "100vh"}}
                    position="relative"
                    margin="0"
                    padding="0"
                    horizontal="center"
                >
                    <div className="moon-site-background" aria-hidden="true"/>
                    <RevealFx fill position="absolute" zIndex={1} style={{pointerEvents: "none"}}>
                        <Background
                            mask={{
                                x: moonEffects.mask.x,
                                y: moonEffects.mask.y,
                                radius: moonEffects.mask.radius,
                                cursor: moonEffects.mask.cursor,
                            }}
                            gradient={{
                                display: moonEffects.gradient.display,
                                opacity: moonEffects.gradient.opacity as opacity,
                                x: moonEffects.gradient.x,
                                y: moonEffects.gradient.y,
                                width: moonEffects.gradient.width,
                                height: moonEffects.gradient.height,
                                tilt: moonEffects.gradient.tilt,
                                colorStart: moonEffects.gradient.colorStart,
                                colorEnd: moonEffects.gradient.colorEnd,
                            }}
                            dots={{
                                display: moonEffects.dots.display,
                                opacity: moonEffects.dots.opacity as opacity,
                                size: moonEffects.dots.size as SpacingToken,
                                color: moonEffects.dots.color,
                            }}
                            grid={{
                                display: moonEffects.grid.display,
                                opacity: moonEffects.grid.opacity as opacity,
                                color: moonEffects.grid.color,
                                width: moonEffects.grid.width,
                                height: moonEffects.grid.height,
                            }}
                            lines={{
                                display: moonEffects.lines.display,
                                opacity: moonEffects.lines.opacity as opacity,
                                size: moonEffects.lines.size as SpacingToken,
                                thickness: moonEffects.lines.thickness,
                                angle: moonEffects.lines.angle,
                                color: moonEffects.lines.color,
                            }}
                        />
                    </RevealFx>
                    <SiteWeatherFx/>
                    <Flex zIndex={3} fillWidth flex={1} minHeight="0">
                        <AppShell>
                            <RouteGuard>{children}</RouteGuard>
                        </AppShell>
                    </Flex>
                </Column>
            </Providers>
        </Flex>
    );
}
