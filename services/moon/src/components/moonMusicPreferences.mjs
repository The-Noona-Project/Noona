export const MOON_MUSIC_ENABLED_STORAGE_KEY = "moon-music-enabled";
export const MOON_MUSIC_VOLUME_STORAGE_KEY = "moon-music-volume";
export const DEFAULT_MOON_MUSIC_ENABLED = true;
export const DEFAULT_MOON_MUSIC_VOLUME = 0.35;

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

export const clampMoonMusicVolume = (value, fallback = DEFAULT_MOON_MUSIC_VOLUME) => {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(1, Math.max(0, parsed));
};

export const parseMoonMusicEnabled = (value, fallback = DEFAULT_MOON_MUSIC_ENABLED) => {
    if (typeof value === "boolean") {
        return value;
    }

    const normalized = normalizeString(value).toLowerCase();
    if (normalized === "true") {
        return true;
    }
    if (normalized === "false") {
        return false;
    }

    return fallback;
};

export const readMoonMusicPreferences = (storage) => ({
    enabled: parseMoonMusicEnabled(storage?.getItem?.(MOON_MUSIC_ENABLED_STORAGE_KEY), DEFAULT_MOON_MUSIC_ENABLED),
    volume: clampMoonMusicVolume(storage?.getItem?.(MOON_MUSIC_VOLUME_STORAGE_KEY), DEFAULT_MOON_MUSIC_VOLUME),
});

export const toMoonMusicVolumePercent = (value) => Math.round(clampMoonMusicVolume(value) * 100);

export const fromMoonMusicVolumePercent = (value) => clampMoonMusicVolume(Number(value) / 100);
