import { createResource, createSignal, Show } from "solid-js";
import { api } from "../lib/api";
import {
    WrappedSlide,
    WrappedHero,
    WrappedStats,
    WrappedProjects,
    WrappedBreaks,
    WrappedTimePersonality,
    WrappedBadges,
    WrappedSummary,
} from "../components/Wrapped";

export default function Wrapped() {
    const currentYear = new Date().getFullYear();
    const [year] = createSignal(currentYear);

    const [wrappedData] = createResource(
        () => year().toString(),
        async (yearStr) => {
            return api.attendance.getWrapped.query({ year: yearStr });
        }
    );

    return (
        <Show
            when={!wrappedData.loading && wrappedData()}
            fallback={
                <div class="wrapped-loading">
                    <div
                        style={{
                            width: "48px",
                            height: "48px",
                            border: "3px solid rgba(255,255,255,0.1)",
                            "border-top-color": "#00d9ff",
                            "border-radius": "50%",
                            animation: "spin 1s linear infinite",
                        }}
                    />
                    <p class="wrapped-loading-text">Loading your wrapped...</p>
                    <style>{`
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
          `}</style>
                </div>
            }
        >
            <div class="wrapped-container">
                {/* Navigation dots */}
                <nav class="wrapped-nav">
                    <button
                        class="wrapped-nav-dot wrapped-nav-dot--active"
                        onClick={() =>
                            document.getElementById("slide-hero")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-stats")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-projects")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-breaks")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-time")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-badges")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                    <button
                        class="wrapped-nav-dot"
                        onClick={() =>
                            document.getElementById("slide-summary")?.scrollIntoView({ behavior: "smooth" })
                        }
                    />
                </nav>

                {/* Slides */}
                <WrappedSlide variant="hero" id="slide-hero">
                    <WrappedHero year={wrappedData()!.year} />
                </WrappedSlide>

                <WrappedSlide variant="stats" id="slide-stats">
                    <WrappedStats stats={wrappedData()!.coreStats} />
                </WrappedSlide>

                <WrappedSlide variant="projects" id="slide-projects">
                    <WrappedProjects insights={wrappedData()!.projectInsights} />
                </WrappedSlide>

                <WrappedSlide variant="breaks" id="slide-breaks">
                    <WrappedBreaks patterns={wrappedData()!.breakPatterns} />
                </WrappedSlide>

                <WrappedSlide variant="time" id="slide-time">
                    <WrappedTimePersonality
                        timePersonality={wrappedData()!.timePersonality}
                    />
                </WrappedSlide>

                <WrappedSlide variant="badges" id="slide-badges">
                    <WrappedBadges badges={wrappedData()!.badges} />
                </WrappedSlide>

                <WrappedSlide variant="summary" id="slide-summary">
                    <WrappedSummary stats={wrappedData()!} />
                </WrappedSlide>
            </div>
        </Show>
    );
}
