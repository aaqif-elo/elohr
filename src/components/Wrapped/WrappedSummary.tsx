import { Component, For } from "solid-js";
import type { WrappedStats } from "../../server/db/wrapped";

interface WrappedSummaryProps {
    stats: WrappedStats;
}

export const WrappedSummary: Component<WrappedSummaryProps> = (props) => {
    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Your Summary</h2>

            <div class="wrapped-summary-card wrapped-animate-in wrapped-animate-in--delay-1">
                <div class="wrapped-summary-card-header">ELO HR Wrapped</div>
                <div class="wrapped-summary-card-year">{props.stats.year}</div>

                <div class="wrapped-summary-stat">
                    <div class="wrapped-summary-stat-value">
                        {props.stats.coreStats.totalDaysWorked}
                    </div>
                    <div class="wrapped-summary-stat-label">Days Worked</div>
                </div>

                <div class="wrapped-summary-stat">
                    <div class="wrapped-summary-stat-value">
                        {props.stats.coreStats.totalHoursWorked.toLocaleString()}h
                    </div>
                    <div class="wrapped-summary-stat-label">Hours Logged</div>
                </div>

                <div class="wrapped-summary-stat">
                    <div class="wrapped-summary-stat-value">
                        {props.stats.projectInsights.topProject?.name || "—"}
                    </div>
                    <div class="wrapped-summary-stat-label">#1 Project</div>
                </div>

                <div class="wrapped-summary-personality">
                    {props.stats.timePersonality.personalityType}
                </div>
            </div>

            <div
                class="wrapped-animate-in wrapped-animate-in--delay-2"
                style={{ "margin-top": "2rem", width: "100%", "max-width": "340px" }}
            >
                <For each={props.stats.funFacts}>
                    {(fact, index) => (
                        <div
                            class="wrapped-fun-fact wrapped-animate-in"
                            style={{ "animation-delay": `${0.3 + index() * 0.1}s`, opacity: 0 }}
                        >
                            {fact}
                        </div>
                    )}
                </For>
            </div>
        </>
    );
};
