import { MetaProvider, Title } from "@solidjs/meta";
import { Route, Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { lazy, Suspense } from "solid-js";
import "./app.css";
import { AuthGuard } from "./components/AuthGuard";
import { Toaster } from "solid-toast";

export default function App() {
  return (
    <>
      <Router
        root={(props) => (
          <MetaProvider>
            <Title>ELO HR</Title>
            <Suspense>{props.children}</Suspense>
          </MetaProvider>
        )}
      >
        <Route path="/" component={AuthGuard}>
          <Route path="/home" component={lazy(() => import("./routes/home"))} />
        </Route>
        <FileRoutes />
      </Router>
      <Toaster position="bottom-left" gutter={8} />
    </>
  );
}
