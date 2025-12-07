import { Component, Show } from "solid-js";
import type { WrappedStats } from "../../server/db/wrapped";

interface WrappedBreaksProps {
    patterns: WrappedStats["breakPatterns"];
}

export const WrappedBreaks: Component<WrappedBreaksProps> = (props) => {
    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Break Patterns</h2>
            <p class="wrapped-subtitle wrapped-animate-in wrapped-animate-in--delay-1">
                Because rest is important too
            </p>

            <div class="wrapped-stats-grid">
                <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-2">
                    <div class="wrapped-stat-value wrapped-highlight" style={{ "font-size": "3rem" }}>
                        {props.patterns.totalBreaks}
                    </div>
                    <div class="wrapped-stat-label">Total Breaks</div>
                </div>
                <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-3">
                    <div class="wrapped-stat-value wrapped-highlight--purple" style={{ "font-size": "3rem" }}>
                        {props.patterns.averageBreakMins}
                    </div>
                    <div class="wrapped-stat-label">Avg. Minutes</div>
                </div>
            </div>

            <Show when={props.patterns.longestBreak}>
                <div class="wrapped-fun-fact wrapped-animate-in wrapped-animate-in--delay-3" style={{ "margin-top": "1.5rem" }}>
                    😴 Your longest break was{" "}
                    <span class="wrapped-highlight--pink">
                        {Math.floor(props.patterns.longestBreak!.durationMins / 60)}h {props.patterns.longestBreak!.durationMins % 60}m
                    </span>
                    <br />
                    <span style={{ "font-size": "0.875rem", opacity: 0.7 }}>
                        on {props.patterns.longestBreak!.date}
                    </span>
                </div>
            </Show>

            <Show when={props.patterns.mostBreaksInDay}>
                <div class="wrapped-fun-fact wrapped-animate-in wrapped-animate-in--delay-4" style={{ "margin-top": "0.5rem" }}>
                    ☕ Most breaks in one day:{" "}
                    <span class="wrapped-highlight">{props.patterns.mostBreaksInDay!.count}</span>
                    <br />
                    <span style={{ "font-size": "0.875rem", opacity: 0.7 }}>
                        on {props.patterns.mostBreaksInDay!.date}
                    </span>
                </div>
            </Show>
        </>
    );
};
