"use client";

import {Card, Column, Row, Slider, Switch, Text} from "@once-ui-system/core";
import {useEffect, useRef, useState} from "react";
import {
    DEFAULT_MOON_MUSIC_ENABLED,
    DEFAULT_MOON_MUSIC_VOLUME,
    fromMoonMusicVolumePercent,
    MOON_MUSIC_ENABLED_STORAGE_KEY,
    MOON_MUSIC_VOLUME_STORAGE_KEY,
    readMoonMusicPreferences,
    toMoonMusicVolumePercent,
} from "./moonMusicPreferences.mjs";
import {emitNoonaSiteNotification} from "./noona/SiteNotifications";
import {buildMoonMusicNotification} from "./noona/siteNotificationLive.mjs";

const BG_SURFACE = "surface" as const;
const BG_NEUTRAL_ALPHA_WEAK = "neutral-alpha-weak" as const;
const MUSIC_TRACK_URL = "/api/noona/media/background-track";

type MoonMusicCardProps = {
    cardPadding: "m" | "l";
};

export function MoonMusicCard({cardPadding}: MoonMusicCardProps) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const retryCleanupRef = useRef<(() => void) | null>(null);
    const musicEnabledRef = useRef(DEFAULT_MOON_MUSIC_ENABLED);
    const playSessionIdRef = useRef<string | null>(null);
    const announcedPlaySessionIdRef = useRef<string | null>(null);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const [musicEnabled, setMusicEnabled] = useState(DEFAULT_MOON_MUSIC_ENABLED);
    const [musicVolume, setMusicVolume] = useState(DEFAULT_MOON_MUSIC_VOLUME);

    const clearRetryListener = () => {
        retryCleanupRef.current?.();
        retryCleanupRef.current = null;
    };

    const resetPlaybackAnnouncement = () => {
        playSessionIdRef.current = null;
        announcedPlaySessionIdRef.current = null;
    };

    const ensurePlaySessionId = () => {
        if (!playSessionIdRef.current) {
            if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
                playSessionIdRef.current = crypto.randomUUID();
            } else {
                playSessionIdRef.current = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
        }

        return playSessionIdRef.current;
    };

    const announcePlaybackStart = () => {
        const audio = audioRef.current;
        if (!audio || audio.paused) {
            return;
        }

        const playSessionId = ensurePlaySessionId();
        if (announcedPlaySessionIdRef.current === playSessionId) {
            return;
        }

        const notification = buildMoonMusicNotification(playSessionId) as Parameters<typeof emitNoonaSiteNotification>[0] | null;
        if (!notification) {
            return;
        }

        emitNoonaSiteNotification(notification);
        announcedPlaySessionIdRef.current = playSessionId;
    };

    const scheduleRetryAfterInteraction = () => {
        if (typeof window === "undefined" || retryCleanupRef.current) {
            return;
        }

        // Retry once after the first user gesture when autoplay is blocked.
        const retryPlayback = () => {
            clearRetryListener();
            const audio = audioRef.current;
            if (!audio || !musicEnabledRef.current) {
                return;
            }

            ensurePlaySessionId();
            void audio.play()
                .then(() => {
                    announcePlaybackStart();
                })
                .catch(() => {
                    // If the user interaction still does not satisfy playback, keep the preference enabled and stay idle.
                });
        };

        window.addEventListener("pointerdown", retryPlayback, true);
        window.addEventListener("keydown", retryPlayback, true);
        retryCleanupRef.current = () => {
            window.removeEventListener("pointerdown", retryPlayback, true);
            window.removeEventListener("keydown", retryPlayback, true);
        };
    };

    useEffect(() => {
        try {
            const {enabled, volume} = readMoonMusicPreferences(window.localStorage);
            setMusicEnabled(enabled);
            setMusicVolume(volume);
            musicEnabledRef.current = enabled;
        } catch {
            setMusicEnabled(DEFAULT_MOON_MUSIC_ENABLED);
            setMusicVolume(DEFAULT_MOON_MUSIC_VOLUME);
            musicEnabledRef.current = DEFAULT_MOON_MUSIC_ENABLED;
        } finally {
            setPreferencesReady(true);
        }

        return () => {
            clearRetryListener();
            resetPlaybackAnnouncement();
            audioRef.current?.pause();
        };
    }, []);

    useEffect(() => {
        musicEnabledRef.current = musicEnabled;
    }, [musicEnabled]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        const audio = audioRef.current;
        if (!audio) {
            return;
        }

        audio.volume = musicVolume;
        if (musicVolume <= 0) {
            resetPlaybackAnnouncement();
        }
    }, [musicVolume, preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        const audio = audioRef.current;
        if (!audio) {
            return;
        }

        const handlePause = () => {
            resetPlaybackAnnouncement();
        };

        audio.addEventListener("pause", handlePause);
        return () => {
            audio.removeEventListener("pause", handlePause);
        };
    }, [preferencesReady]);

    useEffect(() => {
        if (!preferencesReady) {
            return;
        }

        const audio = audioRef.current;
        if (!audio) {
            return;
        }

        if (!musicEnabled) {
            clearRetryListener();
            resetPlaybackAnnouncement();
            audio.pause();
            return;
        }

        ensurePlaySessionId();
        const playPromise = audio.play();
        if (playPromise && typeof playPromise.catch === "function") {
            void playPromise
                .then(() => {
                    clearRetryListener();
                    announcePlaybackStart();
                })
                .catch(() => {
                    scheduleRetryAfterInteraction();
                });
        }
    }, [musicEnabled, preferencesReady]);

    const persistEnabled = (nextValue: boolean) => {
        setMusicEnabled(nextValue);
        try {
            window.localStorage.setItem(MOON_MUSIC_ENABLED_STORAGE_KEY, String(nextValue));
        } catch {
            // Ignore local persistence failures and keep the in-memory shell preference.
        }
    };

    const persistVolume = (nextValue: number) => {
        const normalized = Math.min(1, Math.max(0, nextValue));
        setMusicVolume(normalized);
        try {
            window.localStorage.setItem(MOON_MUSIC_VOLUME_STORAGE_KEY, String(normalized));
        } catch {
            // Ignore local persistence failures and keep the in-memory shell preference.
        }
    };

    return (
        <Card
            fillWidth
            background={BG_SURFACE}
            border={BG_NEUTRAL_ALPHA_WEAK}
            padding={cardPadding}
            radius="l"
        >
            <Column gap="12">
                <Text variant="label-default-s" onBackground="neutral-weak">
                    Music
                </Text>
                <Row gap="12" vertical="center" style={{flexWrap: "wrap"}}>
                    <Row gap="8" vertical="center" style={{flex: "0 0 auto"}}>
                        <Switch
                            isChecked={musicEnabled}
                            disabled={!preferencesReady}
                            ariaLabel="Toggle background music"
                            onToggle={() => persistEnabled(!musicEnabled)}
                        />
                        <Text variant="body-default-xs">{musicEnabled ? "Playing" : "Muted"}</Text>
                    </Row>
                    <div style={{flex: "1 1 14rem", minWidth: "14rem"}}>
                        <Slider
                            value={toMoonMusicVolumePercent(musicVolume)}
                            onChange={(value) => persistVolume(fromMoonMusicVolumePercent(value))}
                            min={0}
                            max={100}
                            step={1}
                            label="Volume"
                            showValue
                            disabled={!preferencesReady || !musicEnabled}
                        />
                    </div>
                </Row>
                <Text onBackground="neutral-weak" variant="body-default-xs" wrap="balance">
                    Loop the background track while you browse the signed-in Moon app. Music stays off on setup,
                    login, callback, and reboot flows.
                </Text>
                {preferencesReady && (
                    <audio
                        ref={audioRef}
                        src={MUSIC_TRACK_URL}
                        loop
                        preload="auto"
                        style={{display: "none"}}
                    />
                )}
            </Column>
        </Card>
    );
}
