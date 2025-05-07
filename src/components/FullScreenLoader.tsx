import { SpinningCircles } from "./SpinningCircles";

interface FullScreenLoaderProps {
  loaderText?: string;
}

export default function FullScreenLoader(props: FullScreenLoaderProps) {
  return (
    <div class="absolute left-[47%] top-[47%] flex flex-col items-center text-center text-gray-400">
      <SpinningCircles />
      <p>{props.loaderText}</p>
    </div>
  );
}
