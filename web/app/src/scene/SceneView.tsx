// Scene_View: Canvas with a perspective camera and OrbitControls (Requirement 4.9),
// the scene content, and the visibility and space overlays. Z is up
// (Object3D.DEFAULT_UP is set in main.tsx). The camera starts over the bed;
// CameraFit (inside SceneContent) frames each newly loaded Project. A click that
// hits no item clears the selection.
import { OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { uiStore } from '../store/uiStore'
import SceneContent from './SceneContent'
import SpaceToggle from './SpaceToggle'
import VisibilityToggles from './VisibilityToggles'

export default function SceneView() {
  return (
    <>
      <Canvas
        camera={{ position: [135, -200, 220], fov: 45, near: 1, far: 5000 }}
        onPointerMissed={() => uiStore.getState().setSelection(null)}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[200, -200, 400]} intensity={0.8} />
        <SceneContent />
        <OrbitControls makeDefault />
      </Canvas>
      <VisibilityToggles />
      <SpaceToggle />
    </>
  )
}
