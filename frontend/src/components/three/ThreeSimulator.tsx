import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Target } from '../../model/target';

interface ThreeSimulatorProps {
  targets: Target[];
  width?: number;
  height?: number;
  selectedTargetId?: string | null;
  onTargetSelect?: (id: string | null) => void;
  onTargetUpdate?: (id: string, updates: Partial<Target>) => void;
}

const ThreeSimulator: React.FC<ThreeSimulatorProps> = ({
  targets,
  width = 800,
  height = 600,
  selectedTargetId,
  onTargetSelect,
  onTargetUpdate
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.Camera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const raycasterRef = useRef<THREE.Raycaster>(new THREE.Raycaster());
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2());

  const [isInitialized, setIsInitialized] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedMesh, setSelectedMesh] = useState<THREE.Mesh | null>(null);
  const [viewMode, setViewMode] = useState<'top' | 'firstPerson'>('top');
  const dragOffsetRef = useRef<THREE.Vector3>(new THREE.Vector3());

  const targetMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const carMeshRef = useRef<THREE.Mesh | null>(null);

  const keysRef = useRef<Record<string, boolean>>({});
  const carStateRef = useRef({
    x: 400,
    y: 300,
    angle: -Math.PI / 2,
    speed: 0,
    rotationSpeed: 0,
  });

  const viewModeRef = useRef(viewMode);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  const handleKeyDown = (e: KeyboardEvent) => {
    keysRef.current[e.code] = true;
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    keysRef.current[e.code] = false;
  };

  const updatePhysics = () => {
    const state = carStateRef.current;
    const keys = keysRef.current;

    const acceleration = 0.5;
    const friction = 0.9;
    const rotationSpeed = 0.05;

    if (keys['KeyW'] || keys['ArrowUp']) {
      state.speed += acceleration;
    }
    if (keys['KeyS'] || keys['ArrowDown']) {
      state.speed -= acceleration;
    }
    if (keys['KeyA'] || keys['ArrowLeft']) {
      state.rotationSpeed += rotationSpeed;
    }
    if (keys['KeyD'] || keys['ArrowRight']) {
      state.rotationSpeed -= rotationSpeed;
    }

    state.speed *= friction;
    state.rotationSpeed *= friction;

    state.angle += state.rotationSpeed;
    state.x += Math.cos(state.angle) * state.speed;
    state.y += Math.sin(state.angle) * state.speed;

    const bounds = 800;
    state.x = Math.max(0, Math.min(bounds, state.x));
    state.y = Math.max(0, Math.min(bounds, state.y));
  };

  useEffect(() => {
    if (!canvasRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000);
    camera.position.set(0, 100, 100);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2;
    controls.minDistance = 5;
    controls.maxDistance = 500;
    controlsRef.current = controls;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(200, 20, 0x000000, 0x000000);
    (gridHelper.material as THREE.Material).opacity = 0.2;
    (gridHelper.material as THREE.Material).transparent = true;
    scene.add(gridHelper);

    const groundGeometry = new THREE.PlaneGeometry(200, 200);
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x808080 });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    setTimeout(() => setIsInitialized(true), 0);

    const handleMouseDown = (event: MouseEvent) => {
      if (!cameraRef.current || !sceneRef.current) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      mouseRef.current.x = ((event.clientX - rect.left) / width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const intersects = raycasterRef.current.intersectObjects(scene.children, true);

      const targetIntersect = intersects.find(intersect => intersect.object.userData.isTarget);
      if (targetIntersect) {
        const mesh = targetIntersect.object as THREE.Mesh;
        setSelectedMesh(mesh);
        onTargetSelect?.(mesh.userData.targetId);
        
        if (viewMode === 'top' && onTargetUpdate) {
          const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
          const intersectPoint = new THREE.Vector3();
          raycasterRef.current.ray.intersectPlane(plane, intersectPoint);
          dragOffsetRef.current.copy(intersectPoint).sub(mesh.position);
          setDragging(true);
        }
      } else {
        onTargetSelect?.(null);
        setSelectedMesh(null);
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (!dragging || !selectedMesh || !cameraRef.current || !onTargetUpdate) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      mouseRef.current.x = ((event.clientX - rect.left) / width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersectPoint = new THREE.Vector3();
      if (raycasterRef.current.ray.intersectPlane(plane, intersectPoint)) {
        intersectPoint.sub(dragOffsetRef.current);
        selectedMesh.position.copy(intersectPoint);

        const targetId = selectedMesh.userData.targetId;
        const x = intersectPoint.x + 400;
        const y = 300 - intersectPoint.z;
        onTargetUpdate(targetId, { x, y });
      }
    };

    const handleMouseUp = () => {
      setDragging(false);
    };

    const canvas = canvasRef.current;
    
    // 只在canvas上监听键盘事件
    canvas.addEventListener('keydown', handleKeyDown);
    canvas.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    
    // 让canvas可以获得焦点
    canvas.tabIndex = 0;
    canvas.style.outline = 'none';

    let lastTime = 0;
    const frameInterval = 1000 / 60;

    const animate = (currentTime: number) => {
      animationFrameRef.current = requestAnimationFrame(animate);

      const delta = currentTime - lastTime;
      if (delta < frameInterval) return;
      lastTime = currentTime - (delta % frameInterval);

      updatePhysics();

      if (carMeshRef.current) {
        carMeshRef.current.position.set(
          carStateRef.current.x - 400,
          5,
          300 - carStateRef.current.y
        );
        carMeshRef.current.rotation.y = carStateRef.current.angle;
      }
      
      // === 修复点：正确的第一人称视角 ===
      if (viewModeRef.current === 'firstPerson' && cameraRef.current) {
        const camera = cameraRef.current;
        const carX = carStateRef.current.x - 400;
        const carZ = 300 - carStateRef.current.y;
        const carAngle = carStateRef.current.angle;
        
        // 驾驶员眼睛位置：车顶前部
        const eyeHeight = 8;      // 眼睛高度
        const eyeForward = 5;     // 眼睛在车前部的偏移
        
        // 相机放在驾驶员眼睛位置
        camera.position.set(
          carX + Math.cos(carAngle) * eyeForward,
          eyeHeight,
          carZ - Math.sin(carAngle) * eyeForward
        );
        
        // 看向车头前方远处
        const lookDistance = 50;
        camera.lookAt(
          carX + Math.cos(carAngle) * lookDistance,
          eyeHeight,
          carZ - Math.sin(carAngle) * lookDistance
        );
        
        // 完全禁用OrbitControls
        if (controlsRef.current) {
          controlsRef.current.enabled = false;
        }
      }
      // 俯视图模式
      else if (viewModeRef.current === 'top' && controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      
      // === 重要：只在俯视图时调用controls.update ===
      if (viewModeRef.current === 'top' && controlsRef.current) {
        controls.update();
      }
      
      renderer.render(scene, camera);
    };
    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      canvas.removeEventListener('keydown', handleKeyDown);
      canvas.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      controls.dispose();
      renderer.dispose();
      scene.clear();
    };
  }, []);

  useEffect(() => {
    if (!isInitialized || !sceneRef.current) return;

    const scene = sceneRef.current;
    targetMeshesRef.current.clear();

    const existingTargets = scene.children.filter(child => child.userData.isTarget);
    existingTargets.forEach(obj => scene.remove(obj));

    targets.forEach(target => {
      let mesh: THREE.Mesh;
      
      if (target.type === 'CIRCLE') {
        const radius = target.r || 1;
        const geometry = new THREE.SphereGeometry(radius, 32, 32);
        const material = new THREE.MeshLambertMaterial({ color: target.color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(target.x - 400, radius, 300 - target.y);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      } else {
        const width = target.w || 10;
        const height = target.h || 10;
        const depth = 5;
        const geometry = new THREE.BoxGeometry(width, depth, height);
        const material = new THREE.MeshLambertMaterial({ color: target.color });
        mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(
          target.x + width / 2 - 400,
          depth / 2,
          300 - (target.y + height / 2)
        );
        if (target.angle) {
          mesh.rotation.y = target.angle;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }

      mesh.userData.isTarget = true;
      mesh.userData.targetId = target.id;
      scene.add(mesh);
      targetMeshesRef.current.set(target.id, mesh);

      if (selectedTargetId === target.id) {
        const edges = new THREE.EdgesGeometry(mesh.geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xff0000 }));
        mesh.add(line);
        mesh.userData.highlight = line;
      } else if (mesh.userData.highlight) {
        mesh.remove(mesh.userData.highlight);
        delete mesh.userData.highlight;
      }
    });

    if (!carMeshRef.current) {
      const carGeometry = new THREE.BoxGeometry(20, 10, 10);
      const carMaterial = new THREE.MeshLambertMaterial({ color: 0x0000ff });
      const car = new THREE.Mesh(carGeometry, carMaterial);
      car.position.set(carStateRef.current.x - 400, 5, 300 - carStateRef.current.y);
      car.rotation.y = carStateRef.current.angle;
      car.castShadow = true;
      car.receiveShadow = true;
      car.userData.isCar = true;
      scene.add(car);
      carMeshRef.current = car;
    }
  }, [targets, isInitialized, selectedTargetId]);

  useEffect(() => {
    if (!cameraRef.current || !controlsRef.current) return;

    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (viewMode === 'top') {
      // 俯视图：固定俯视角度
      camera.position.set(0, 200, 0);
      camera.lookAt(0, 0, 0);
      controls.enabled = true;
      controls.enableDamping = true;
      controls.maxPolarAngle = Math.PI / 2;
      controls.minDistance = 10;
      controls.maxDistance = 500;
    } else {
      // 第一人称：立即切换到驾驶员视角
      const carX = carStateRef.current.x - 400;
      const carZ = 300 - carStateRef.current.y;
      const carAngle = carStateRef.current.angle;
      
      // 设置相机到驾驶员位置
      const eyeHeight = 8;
      const eyeForward = 5;
      
      camera.position.set(
        carX + Math.cos(carAngle) * eyeForward,
        eyeHeight,
        carZ - Math.sin(carAngle) * eyeForward
      );
      
      camera.lookAt(
        carX + Math.cos(carAngle) * 50,
        eyeHeight,
        carZ - Math.sin(carAngle) * 50
      );
      
      // 完全禁用controls
      controls.enabled = false;
      controls.enableDamping = false;
    }
  }, [viewMode]);

  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.setSize(width, height);
    if (cameraRef.current instanceof THREE.PerspectiveCamera) {
      cameraRef.current.aspect = width / height;
      cameraRef.current.updateProjectionMatrix();
    }
  }, [width, height]);

  const resetCar = () => {
    carStateRef.current = {
      x: 400,
      y: 300,
      angle: -Math.PI / 2,
      speed: 0,
      rotationSpeed: 0,
    };
  };

  return (
    <div style={{ position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', background: '#f9f9f9' }} />
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        background: 'rgba(255, 255, 255, 0.8)',
        padding: '10px',
        borderRadius: '5px'
      }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={() => setViewMode('top')}
            style={{
              background: viewMode === 'top' ? '#007bff' : '#6c757d',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            俯视图
          </button>
          <button
            onClick={() => setViewMode('firstPerson')}
            style={{
              background: viewMode === 'firstPerson' ? '#007bff' : '#6c757d',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            第一人称
          </button>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={resetCar}
            style={{
              background: '#28a745',
              color: 'white',
              border: 'none',
              padding: '5px 10px',
              borderRadius: '3px',
              cursor: 'pointer'
            }}
          >
            重置位置
          </button>
        </div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
          使用 WASD 或方向键控制小车
        </div>
      </div>
      {dragging && (
        <div style={{
          position: 'absolute',
          top: 50,
          left: 10,
          background: 'rgba(255, 255, 255, 0.9)',
          padding: '5px',
          borderRadius: '5px',
          fontSize: '12px'
        }}>
          拖拽中 - 释放鼠标以放置
        </div>
      )}
    </div>
  );
};

export default ThreeSimulator;