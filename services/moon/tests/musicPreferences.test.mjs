import test from "node:test";
import assert from "node:assert/strict";

import {
    clampMoonMusicVolume,
    DEFAULT_MOON_MUSIC_ENABLED,
    DEFAULT_MOON_MUSIC_VOLUME,
    fromMoonMusicVolumePercent,
    parseMoonMusicEnabled,
    readMoonMusicPreferences,
    toMoonMusicVolumePercent,
} from "../src/components/moonMusicPreferences.mjs";

test("readMoonMusicPreferences falls back to the default enabled state and volume", () => {
    assert.deepEqual(readMoonMusicPreferences(undefined), {
        enabled: DEFAULT_MOON_MUSIC_ENABLED,
        volume: DEFAULT_MOON_MUSIC_VOLUME,
    });
});

test("readMoonMusicPreferences clamps stored volume and restores explicit mute state", () => {
    const storage = {
        getItem(key) {
            if (key === "moon-music-enabled") {
                return "false";
            }
            if (key === "moon-music-volume") {
                return "4.2";
            }
            return null;
        },
    };

    assert.deepEqual(readMoonMusicPreferences(storage), {
        enabled: false,
        volume: 1,
    });
});

test("music preference helpers normalize booleans and volume percentages", () => {
    assert.equal(parseMoonMusicEnabled("true"), true);
    assert.equal(parseMoonMusicEnabled("false"), false);
    assert.equal(parseMoonMusicEnabled(""), DEFAULT_MOON_MUSIC_ENABLED);
    assert.equal(clampMoonMusicVolume("-2"), 0);
    assert.equal(clampMoonMusicVolume("nope"), DEFAULT_MOON_MUSIC_VOLUME);
    assert.equal(fromMoonMusicVolumePercent(35), 0.35);
    assert.equal(toMoonMusicVolumePercent(0.35), 35);
});
