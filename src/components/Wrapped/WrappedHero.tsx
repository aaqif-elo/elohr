import { Component } from "solid-js";

interface WrappedHeroProps {
    year: number;
}

export const WrappedHero: Component<WrappedHeroProps> = (props) => {
    return (
        <>
            <div class="wrapped-animate-in">
                <p class="wrapped-subtitle">Your Year in Review</p>
            </div>
            <div class="wrapped-year wrapped-animate-in wrapped-animate-in--delay-1 wrapped-pulse">
                {props.year}
            </div>
            <div class="wrapped-animate-in wrapped-animate-in--delay-2">
                <h1 class="wrapped-title">Wrapped</h1>
            </div>
            <div class="wrapped-scroll-hint wrapped-animate-in wrapped-animate-in--delay-3">
                <span>Scroll to explore</span>
                <span class="wrapped-scroll-hint-arrow">↓</span>
            </div>
        </>
    );
};
