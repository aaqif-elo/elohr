import type { Component} from "solid-js";
import { Show } from "solid-js";
import type { WrappedStats as WrappedStatsData } from "../../server/db/wrapped";

interface WrappedStatsProps {
    stats: WrappedStatsData["coreStats"];
}

export const WrappedCoreStats: Component<WrappedStatsProps> = (props) => {
    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Your Numbers</h2>
            <div class="wrapped-stats-grid">
                <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-1">
                    <div class="wrapped-stat-value wrapped-highlight">
                        {props.stats.totalDaysWorked}
                    </div>
                    <div class="wrapped-stat-label">Days Worked</div>
                </div>
                <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-2">
                    <div class="wrapped-stat-value wrapped-highlight--purple">
                        {props.stats.totalHoursWorked.toLocaleString()}
                    </div>
                    <div class="wrapped-stat-label">Hours Worked</div>
                </div>
            </div>
            <Show when={props.stats.earliestWorkStart || props.stats.latestWorkEnd}>
                <div class="wrapped-stats-grid" style={{ "margin-top": "1rem" }}>
                    <Show when={props.stats.earliestWorkStart}>
                        {(earliestWorkStart) => (
                            <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-3">
                                <div class="wrapped-stat-value" style={{ "font-size": "1.75rem" }}>
                                    {earliestWorkStart().time}
                                </div>
                                <div class="wrapped-stat-label">Earliest Start</div>
                                <div style={{ "font-size": "0.75rem", color: "rgba(255,255,255,0.5)", "margin-top": "0.25rem" }}>
                                    {earliestWorkStart().date}
                                </div>
                            </div>
                        )}
                    </Show>
                    <Show when={props.stats.latestWorkEnd}>
                        {(latestWorkEnd) => (
                            <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-4">
                                <div class="wrapped-stat-value" style={{ "font-size": "1.75rem" }}>
                                    {latestWorkEnd().time}
                                </div>
                                <div class="wrapped-stat-label">Latest End</div>
                                <div style={{ "font-size": "0.75rem", color: "rgba(255,255,255,0.5)", "margin-top": "0.25rem" }}>
                                    {latestWorkEnd().date}
                                </div>
                            </div>
                        )}
                    </Show>
                </div>
            </Show>
        </>
    );
};
