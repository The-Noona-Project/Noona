"use client";

import {
    BorderStyle,
    ChartMode,
    ChartVariant,
    DataThemeProvider,
    IconProvider,
    LayoutProvider,
    NeutralColor,
    ScalingSize,
    Schemes,
    SolidStyle,
    SolidType,
    SurfaceStyle,
    ThemeProvider,
    ToastProvider,
    TransitionStyle,
} from "@once-ui-system/core";
import {moonDataStyle, moonTheme} from "../resources";
import {iconLibrary} from "../resources/icons";
import {NoonaSiteNotificationsProvider} from "./noona/SiteNotifications";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <LayoutProvider>
      <ThemeProvider
          brand={moonTheme.brand as Schemes}
          accent={moonTheme.accent as Schemes}
          neutral={moonTheme.neutral as NeutralColor}
          solid={moonTheme.solid as SolidType}
          solidStyle={moonTheme.solidStyle as SolidStyle}
          border={moonTheme.border as BorderStyle}
          surface={moonTheme.surface as SurfaceStyle}
          transition={moonTheme.transition as TransitionStyle}
          scaling={moonTheme.scaling as ScalingSize}
      >
        <DataThemeProvider
            variant={moonDataStyle.variant as ChartVariant}
            mode={moonDataStyle.mode as ChartMode}
            height={moonDataStyle.height}
          axis={{
              stroke: moonDataStyle.axis.stroke,
          }}
          tick={{
              fill: moonDataStyle.tick.fill,
              fontSize: moonDataStyle.tick.fontSize,
              line: moonDataStyle.tick.line,
          }}
        >
          <ToastProvider>
              <NoonaSiteNotificationsProvider>
                  <IconProvider icons={iconLibrary}>{children}</IconProvider>
              </NoonaSiteNotificationsProvider>
          </ToastProvider>
        </DataThemeProvider>
      </ThemeProvider>
    </LayoutProvider>
  );
}
