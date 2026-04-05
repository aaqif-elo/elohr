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
                <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-3">
                    <div class="wrapped-stat-value wrapped-highlight--pink">
                        {props.stats.totalBreakHours}
                    </div>
                    <div class="wrapped-stat-label">Hours of Breaks</div>
                </div>
            </div>
            <Show when={props.stats.earliestLogin || props.stats.latestLogout}>
                <div class="wrapped-stats-grid" style={{ "margin-top": "1rem" }}>
                    <Show when={props.stats.earliestLogin}>
                        {(earliestLogin) => (
                            <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-4">
                                <div class="wrapped-stat-value" style={{ "font-size": "1.75rem" }}>
                                    {earliestLogin().time}
                                </div>
                                <div class="wrapped-stat-label">Earliest Login</div>
                                <div style={{ "font-size": "0.75rem", color: "rgba(255,255,255,0.5)", "margin-top": "0.25rem" }}>
                                    {earliestLogin().date}
                                </div>
                            </div>
                        )}
                    </Show>
                    <Show when={props.stats.latestLogout}>
                        {(latestLogout) => (
                            <div class="wrapped-stat-card wrapped-animate-in wrapped-animate-in--delay-4">
                                <div class="wrapped-stat-value" style={{ "font-size": "1.75rem" }}>
                                    {latestLogout().time}
                                </div>
                                <div class="wrapped-stat-label">Latest Logout</div>
                                <div style={{ "font-size": "0.75rem", color: "rgba(255,255,255,0.5)", "margin-top": "0.25rem" }}>
                                    {latestLogout().date}
                                </div>
                            </div>
                        )}
                    </Show>
                </div>
            </Show>
        </>
    );
};
