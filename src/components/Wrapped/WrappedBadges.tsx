import { Component, For, Show } from "solid-js";
import type { WrappedStats } from "../../server/db/wrapped";

interface WrappedBadgesProps {
    badges: WrappedStats["badges"];
}

export const WrappedBadges: Component<WrappedBadgesProps> = (props) => {
    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Your Badges</h2>
            <p class="wrapped-subtitle wrapped-animate-in wrapped-animate-in--delay-1">
                Achievements unlocked this year
            </p>

            <Show
                when={props.badges.length > 0}
                fallback={
                    <div class="wrapped-fun-fact wrapped-animate-in wrapped-animate-in--delay-2">
                        🎯 Keep working to unlock badges next year!
                    </div>
                }
            >
                <div class="wrapped-badges-grid">
                    <For each={props.badges}>
                        {(badge, index) => (
                            <div
                                class="wrapped-badge wrapped-animate-in"
                                style={{ "animation-delay": `${0.2 + index() * 0.1}s`, opacity: 0 }}
                            >
                                <span class="wrapped-badge-emoji">{badge.emoji}</span>
                                <span class="wrapped-badge-name">{badge.name}</span>
                                <span class="wrapped-badge-desc">{badge.description}</span>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </>
    );
};
