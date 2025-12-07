import { Component, JSX } from "solid-js";

interface WrappedSlideProps {
    variant?:
    | "hero"
    | "stats"
    | "projects"
    | "breaks"
    | "time"
    | "badges"
    | "summary";
    children: JSX.Element;
    id?: string;
}

export const WrappedSlide: Component<WrappedSlideProps> = (props) => {
    return (
        <section
            id={props.id}
            class={`wrapped-slide wrapped-slide--${props.variant || "hero"}`}
        >
            {props.children}
        </section>
    );
};
