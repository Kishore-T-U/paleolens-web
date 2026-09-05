'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';

interface FossilViewerProps {
  activePart: string;
}

function BelemniteAnatomy({ activePart }: { activePart: string }) {
  // In a production app, you load a real 3D file here:
  // const { nodes, materials } = useGLTF('/models/belemnite.glb');

  return (
    <group dispose={null}>
      {/* The Phragmocone (Upper Body) */}
      <mesh position={[0, 1, 0]}>
        <cylinderGeometry args={[0.5, 0.2, 2, 32]} />
        <meshStandardMaterial
          color={activePart === 'belemnite_phragmocone' ? '#2dd4bf' : '#334155'}
          emissive={activePart === 'belemnite_phragmocone' ? '#14b8a6' : '#000000'}
          transparent
          opacity={activePart === 'belemnite_phragmocone' ? 1 : 0.3}
        />
      </mesh>

      {/* The Rostrum (The pointed tip from your photo) */}
      <mesh position={[0, -0.5, 0]}>
        <coneGeometry args={[0.2, 1, 32]} />
        <meshStandardMaterial
          color={activePart === 'belemnite_rostrum' ? '#2dd4bf' : '#334155'}
          emissive={activePart === 'belemnite_rostrum' ? '#14b8a6' : '#000000'}
          transparent
          opacity={activePart === 'belemnite_rostrum' ? 1 : 0.3}
        />
      </mesh>
    </group>
  );
}

export default function FossilViewer({ activePart }: FossilViewerProps) {
  return (
    <div className="w-full h-64 bg-slate-950 rounded-xl border border-slate-700 overflow-hidden">
      <Canvas camera={{ position: [0, 0, 5], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1} />
        <Environment preset="city" />
        
        <BelemniteAnatomy activePart={activePart} />
        
        {/* Allows the user to spin the 3D model with their finger/mouse */}
        <OrbitControls autoRotate autoRotateSpeed={2} enableZoom={true} />
      </Canvas>
    </div>
  );
}