import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MainArea from "./components/MainArea";
import { useConnectionStore } from "./stores/connectionStore";

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);

  useEffect(() => {
    loadConnections();
    loadGroups();
  }, [loadConnections, loadGroups]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-(--color-bg-primary)">
      <Sidebar />
      <MainArea />
    </div>
  );
}
