import { useEffect, type DragEvent } from 'react';
import { useStore } from 'zustand';
import DiffView from './editor/DiffView';
import SceneView from './scene/SceneView';
import { startHealthPolling } from './store/backendStore';
import { projectStore } from './store/projectStore';
import { BackendBanner, RegenerateFailurePanel, RegenerateOverlay } from './ui/BackendPanels';
import { uiStore } from './store/uiStore';
import SidePanel from './ui/SidePanel';
import StatusPanel from './ui/StatusPanel';
import Toolbar from './ui/Toolbar';
import GcodePane from './viewer/GcodePane';
import Legend from './viewer/Legend';
import Timeline from './viewer/Timeline';

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

// Layout shell: toolbar on top, 3D viewport in the centre, side panel on the
// right (status, selection, and the collapsible gcode text pane below them) and the
// timeline along the bottom.
// The whole window accepts a dropped .pnp.zip or Rhino output folder.
export default function App() {
  const dragActive = useStore(uiStore, (s) => s.dragActive);
  useEffect(() => startHealthPolling(), []);

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!uiStore.getState().dragActive) uiStore.getState().setDragActive(true);
  };
  const onDragLeave = (e: DragEvent) => {
    // Only when the pointer leaves the window, not when it crosses child elements.
    if (e.relatedTarget === null) uiStore.getState().setDragActive(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    uiStore.getState().setDragActive(false);
    void projectStore.getState().openDrop(e.dataTransfer.items);
  };

  return (
    <div className="app" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <Toolbar />
      <main className="app-viewport">
        <SceneView />
        <Legend />
      </main>
      <aside className="app-side-panel">
        <div className="app-side-top">
          <BackendBanner />
          <RegenerateFailurePanel />
          <DiffView />
          <StatusPanel />
          <SidePanel />
        </div>
        <GcodePane />
      </aside>
      <footer className="app-timeline">
        <Timeline />
      </footer>
      <RegenerateOverlay />
      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-overlay-box">Drop a .pnp.zip bundle or a Rhino output folder</div>
        </div>
      )}
    </div>
  );
}
