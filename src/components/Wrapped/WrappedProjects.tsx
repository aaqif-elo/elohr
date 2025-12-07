import { Component, For, Show } from "solid-js";
import type { WrappedStats } from "../../server/db/wrapped";

interface WrappedProjectsProps {
    insights: WrappedStats["projectInsights"];
}

export const WrappedProjects: Component<WrappedProjectsProps> = (props) => {
    // Get top 5 projects for display
    const topProjects = () => props.insights.projectBreakdown.slice(0, 5);
    const maxHours = () => topProjects()[0]?.hours || 1;

    return (
        <>
            <h2 class="wrapped-title wrapped-animate-in">Project Time</h2>
            <Show when={props.insights.topProject}>
                <div class="wrapped-animate-in wrapped-animate-in--delay-1" style={{ "text-align": "center", "margin-bottom": "2rem" }}>
                    <p class="wrapped-subtitle" style={{ "margin-bottom": "0.5rem" }}>
                        Your #1 Project
                    </p>
                    <div style={{ "font-size": "2.5rem", color: "white", "font-weight": "800" }}>
                        {props.insights.topProject!.name}
                    </div>
                    <div style={{ "font-size": "1.25rem", color: "#00d9ff" }}>
                        {props.insights.topProject!.hours} hours
                    </div>
                </div>
            </Show>

            <div class="wrapped-animate-in wrapped-animate-in--delay-2" style={{ width: "100%", "max-width": "360px" }}>
                <For each={topProjects()}>
                    {(project, index) => (
                        <div class="wrapped-project-bar" style={{ "animation-delay": `${0.2 + index() * 0.1}s` }}>
                            <span class="wrapped-project-name">{project.name}</span>
                            <div class="wrapped-project-bar-track">
                                <div
                                    class="wrapped-project-bar-fill"
                                    style={{ width: `${(project.hours / maxHours()) * 100}%` }}
                                />
                            </div>
                            <span class="wrapped-project-hours">{project.hours}h</span>
                        </div>
                    )}
                </For>
            </div>

            <Show when={props.insights.projectSwitchCount > 0}>
                <div class="wrapped-fun-fact wrapped-animate-in wrapped-animate-in--delay-3" style={{ "margin-top": "1.5rem" }}>
                    🔄 You switched projects <span class="wrapped-highlight">{props.insights.projectSwitchCount.toLocaleString()}</span> times
                </div>
            </Show>
        </>
    );
};
