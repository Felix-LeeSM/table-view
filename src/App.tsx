import { useEffect } from "react";
import Sidebar from "./components/Sidebar";
import MainArea from "./components/MainArea";
import { useConnectionStore } from "./stores/connectionStore";
import { useTabStore } from "./stores/tabStore";

export default function App() {
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const loadGroups = useConnectionStore((s) => s.loadGroups);
  const initEventListeners = useConnectionStore((s) => s.initEventListeners);

  useEffect(() => {
    loadConnections();
    loadGroups();
    initEventListeners();
  }, [loadConnections, loadGroups, initEventListeners]);

  // Cmd+W / Ctrl+W closes the active tab (does NOT close the app)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        const activeTabId = useTabStore.getState().activeTabId;
        if (activeTabId) {
          useTabStore.getState().removeTab(activeTabId);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-(--color-bg-primary)">
      <Sidebar />
      <MainArea />
    </div>
  );
}
