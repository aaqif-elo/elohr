import { Component, Show } from "solid-js";
import type { WrappedStats } from "../../server/db/wrapped";

interface WrappedTimePersonalityProps {
    timePersonality: WrappedStats["timePersonality"];
}

export const WrappedTimePersonality: Component<WrappedTimePersonalityProps> = (
    props
) => {
    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Your Work Style</h2>

            <div
                class="wrapped-animate-in wrapped-animate-in--delay-1"
                style={{
                    "font-size": "4rem",
                    "text-align": "center",
                    "margin-bottom": "1rem",
                }}
            >
                {props.timePersonality.personalityType.split(" ")[0]}
            </div>
            <div
                class="wrapped-animate-in wrapped-animate-in--delay-2"
                style={{
                    "font-size": "1.5rem",
                    color: "white",
                    "font-weight": "700",
                    "text-align": "center",
                    "margin-bottom": "2rem",
                }}
            >
                {props.timePersonality.personalityType.split(" ").slice(1).join(" ")}
            </div>

            <div class="wrapped-stats-grid">
                <Show when={props.timePersonality.averageLoginTime}>
                    <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-2">
                        <div
                            class="wrapped-stat-value wrapped-highlight"
                            style={{ "font-size": "1.5rem" }}
                        >
                            {props.timePersonality.averageLoginTime}
                        </div>
                        <div class="wrapped-stat-label">Avg Login</div>
                    </div>
                </Show>
                <Show when={props.timePersonality.averageLogoutTime}>
                    <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-3">
                        <div
                            class="wrapped-stat-value wrapped-highlight--purple"
                            style={{ "font-size": "1.5rem" }}
                        >
                            {props.timePersonality.averageLogoutTime}
                        </div>
                        <div class="wrapped-stat-label">Avg Logout</div>
                    </div>
                </Show>
            </div>

            <div
                class="wrapped-stats-grid"
                style={{ "margin-top": "1rem" }}
            >
                <Show when={props.timePersonality.longestWorkday}>
                    <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-3">
                        <div
                            class="wrapped-stat-value wrapped-highlight--pink"
                            style={{ "font-size": "2rem" }}
                        >
                            {props.timePersonality.longestWorkday!.hours}h
                        </div>
                        <div class="wrapped-stat-label">Longest Day</div>
                        <div
                            style={{
                                "font-size": "0.75rem",
                                color: "rgba(255,255,255,0.5)",
                                "margin-top": "0.25rem",
                            }}
                        >
                            {props.timePersonality.longestWorkday!.date}
                        </div>
                    </div>
                </Show>
                <Show when={props.timePersonality.shortestWorkday}>
                    <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-4">
                        <div
                            class="wrapped-stat-value"
                            style={{ "font-size": "2rem", color: "#4ade80" }}
                        >
                            {props.timePersonality.shortestWorkday!.hours}h
                        </div>
                        <div class="wrapped-stat-label">Shortest Day</div>
                        <div
                            style={{
                                "font-size": "0.75rem",
                                color: "rgba(255,255,255,0.5)",
                                "margin-top": "0.25rem",
                            }}
                        >
                            {props.timePersonality.shortestWorkday!.date}
                        </div>
                    </div>
                </Show>
            </div>
        </>
    );
};
