import { useEffect, useState } from "react";
import { Dashboard } from "./Dashboard";
import { Editor } from "./Editor";

export default function App() {
  const [route, setRoute] = useState(() => window.location.hash);

  useEffect(() => {
    const onChange = () => setRoute(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const projectId = /^#\/p\/([a-z0-9][a-z0-9-]*)$/.exec(route)?.[1] ?? null;

  return projectId ? <Editor projectId={projectId} /> : <Dashboard />;
}
