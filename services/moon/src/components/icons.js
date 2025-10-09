import {
  mdiChartBoxOutline,
  mdiCheckCircleOutline,
  mdiCircleOutline,
  mdiCogPlay,
  mdiBird,
  mdiCrystalBall,
  mdiHome,
  mdiMenu,
  mdiMoonWaningCrescent,
  mdiMagnify,
  mdiSafeSquare,
  mdiShieldCrown,
  mdiThemeLightDark,
  mdiTransitConnectionVariant,
} from '@mdi/js';

const ICON_MAP = {
  'mdi-home': mdiHome,
  'mdi-cog-play': mdiCogPlay,
  'mdi-shield-crown': mdiShieldCrown,
  'mdi-safe-square': mdiSafeSquare,
  'mdi-transit-connection-variant': mdiTransitConnectionVariant,
  'mdi-chart-box-outline': mdiChartBoxOutline,
  'mdi-moon-waning-crescent': mdiMoonWaningCrescent,
  'mdi-crow': mdiBird,
  'mdi-crystal-ball': mdiCrystalBall,
  'mdi-check-circle-outline': mdiCheckCircleOutline,
  'mdi-theme-light-dark': mdiThemeLightDark,
  'mdi-menu': mdiMenu,
  'mdi-magnify': mdiMagnify,
};

export function getIconPath(name) {
  return ICON_MAP[name] ?? mdiCircleOutline;
}
