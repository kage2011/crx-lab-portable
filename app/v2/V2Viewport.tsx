'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { buildRobot, setAngles, solveIk, type IkResult } from './kinematics';
import type { CadSettings, Pose, RobotPreset, TeachPoint, ToolSettings } from './types';

type Props = {
  model: RobotPreset;
  tool: ToolSettings;
  cad: CadSettings | null;
  workHeightMm: number;
  basePosition: [number, number, number];
  mode: 'translate' | 'rotate';
  poseCommand: (Pose & { nonce: number }) | null;
  teachPoints: TeachPoint[];
  onJoints: (angles: number[]) => void;
  onPose: (pose: Pose) => void;
  onIk: (result: IkResult) => void;
  onCollision: (labels: string[]) => void;
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

export default function V2Viewport(props: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  const runtime = useRef<{ target: THREE.Object3D; controls: TransformControls; solve: () => void } | null>(null);
  latest.current = props;

  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#08131a');
    scene.fog = new THREE.Fog('#08131a', 4, 10);
    const camera = new THREE.PerspectiveCamera(42, mount.clientWidth / mount.clientHeight, .01, 30);
    const reachMeters = parseInt(latest.current.model.reach.replace(/\D/g, ''), 10) / 1000;
    const viewScale = reachMeters / 1.418;
    camera.position.set(3.2 * viewScale, 2.35 * viewScale, -4.2 * viewScale);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight('#d7f7ff', '#18262d', 2.2));
    const key = new THREE.DirectionalLight('#ffffff', 4.5);
    key.position.set(-3, -2, 6);
    key.castShadow = true;
    scene.add(key);

    const grid = new THREE.GridHelper(8, 40, '#2f7180', '#163841');
    scene.add(grid);
    const floor = new THREE.Mesh(new THREE.BoxGeometry(8, .04, 8), new THREE.MeshStandardMaterial({ color: '#101f26', roughness: .9 }));
    floor.position.y = -.04;
    floor.receiveShadow = true;
    scene.add(floor);

    const base = new THREE.Group();
    base.rotation.x = -Math.PI / 2;
    scene.add(base);
    const robot = buildRobot(base, latest.current.model);
    const initial = [0, -18, 72, 0, 38, 0];
    let angles = initial.map((v, i) => THREE.MathUtils.clamp(v, latest.current.model.lower[i], latest.current.model.upper[i]));
    setAngles(robot.joints, angles);

    const loader = new ColladaLoader();
    const attachMesh = (file: string, parent: THREE.Group) => loader.load(`${basePath}/models/${latest.current.model.assetDir}/${file}.dae`, result => {
      if (!result) return;
      const object = result.scene;
      object.rotation.set(0, 0, 0);
      object.updateMatrix();
      object.traverse((child: THREE.Object3D) => { if ((child as THREE.Mesh).isMesh) { const mesh = child as THREE.Mesh; mesh.castShadow = true; mesh.receiveShadow = true; } });
      parent.add(object);
    });
    attachMesh('base', base);
    for (let i = 0; i < 6; i++) attachMesh(`j${i + 1}`, robot.meshHolders[i]);

    const toolFrame = new THREE.Group();
    toolFrame.rotation.set(THREE.MathUtils.degToRad(latest.current.tool.rx), THREE.MathUtils.degToRad(latest.current.tool.ry), THREE.MathUtils.degToRad(latest.current.tool.rz), 'XYZ');
    robot.flange.add(toolFrame);
    const rodLength = Math.max(.02, latest.current.tool.lengthMm / 1000);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, rodLength, 20), new THREE.MeshStandardMaterial({ color: '#ffd449', metalness: .35, roughness: .35 }));
    rod.rotation.z = -Math.PI / 2;
    rod.position.x = rodLength / 2;
    toolFrame.add(rod);
    const endpoint = new THREE.Group();
    endpoint.position.x = rodLength;
    toolFrame.add(endpoint);

    const target = new THREE.Mesh(new THREE.SphereGeometry(.055, 24, 16), new THREE.MeshStandardMaterial({ color: '#36e0c1', emissive: '#0a574d', emissiveIntensity: 1.2 }));
    scene.add(target);
    setAngles(robot.joints, angles);
    endpoint.updateWorldMatrix(true, false);
    endpoint.getWorldPosition(target.position);
    endpoint.getWorldQuaternion(target.quaternion);
    const axes = new THREE.AxesHelper(.22);
    target.add(axes);

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.target.set(.35 * viewScale, reachMeters * .55, 0);
    orbit.enableDamping = true;
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setSize(.8);
    transform.attach(target);
    scene.add(transform.getHelper());
    transform.addEventListener('dragging-changed', event => { orbit.enabled = event.value !== true; });

    const work = new THREE.Mesh(new THREE.BoxGeometry(.6, .6, .22), new THREE.MeshStandardMaterial({ color: '#e7ece9', roughness: .75 }));
    work.geometry.dispose();
    work.geometry = new THREE.BoxGeometry(.6, .22, .6);
    work.position.set(.75, latest.current.workHeightMm / 1000 + .11, .35);
    work.castShadow = true;
    scene.add(work);

    let cadObject: THREE.Object3D | null = null;
    if (latest.current.cad) {
      const cad = latest.current.cad;
      const material = new THREE.MeshStandardMaterial({ color: '#f08e55', transparent: true, opacity: .72, roughness: .5 });
      if (cad.kind === 'stl') new STLLoader().load(cad.url, geometry => {
        geometry.computeBoundingBox();
        cadObject = new THREE.Mesh(geometry, material);
        scene.add(cadObject);
      });
      else new OBJLoader().load(cad.url, object => {
        object.traverse(child => { if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = material; });
        cadObject = object;
        scene.add(object);
      });
    }

    const envelope = new THREE.Mesh(new THREE.SphereGeometry(reachMeters, 28, 14), new THREE.MeshBasicMaterial({ color: '#2ca5bb', wireframe: true, transparent: true, opacity: .08 }));
    envelope.position.z = latest.current.model.lengths[0];
    base.add(envelope);

    const pathGeometry = new THREE.BufferGeometry();
    const path = new THREE.Line(pathGeometry, new THREE.LineBasicMaterial({ color: '#ffd449' }));
    scene.add(path);

    const readPose = (): Pose => ({ position: target.position.toArray() as [number, number, number], quaternion: target.quaternion.toArray() as [number, number, number, number] });
    const runIk = () => {
      const result = solveIk(robot.joints, endpoint, target.position, target.quaternion, angles, latest.current.model);
      if (result.reachable) angles = result.angles;
      else setAngles(robot.joints, angles);
      latest.current.onJoints([...angles]);
      latest.current.onIk(result);
      latest.current.onPose(readPose());
    };
    transform.addEventListener('objectChange', runIk);
    runtime.current = { target, controls: transform, solve: runIk };
    runIk();

    let frame = 0;
    let animation = 0;
    const animate = () => {
      animation = requestAnimationFrame(animate);
      transform.setMode(latest.current.mode);
      base.position.set(latest.current.basePosition[0], latest.current.basePosition[2], latest.current.basePosition[1]);
      work.position.y = latest.current.workHeightMm / 1000 + .11;
      if (cadObject && latest.current.cad) {
        const c = latest.current.cad;
        cadObject.position.set(c.position[0], c.position[2], c.position[1]);
        cadObject.rotation.set(...c.rotation.map(THREE.MathUtils.degToRad) as [number, number, number]);
        cadObject.scale.setScalar(c.scale);
      }
      const points = latest.current.teachPoints.map(point => new THREE.Vector3(...point.position));
      pathGeometry.setFromPoints(points);
      if (++frame % 12 === 0) {
        const collisions: string[] = [];
        const workBox = new THREE.Box3().setFromObject(work);
        const cadBox = cadObject ? new THREE.Box3().setFromObject(cadObject) : null;
        const boxes = robot.meshHolders.map(holder => new THREE.Box3().setFromObject(holder));
        boxes.forEach((box, i) => {
          if (box.min.y < -.006) collisions.push(`J${i + 1} / 床`);
          if (box.intersectsBox(workBox)) collisions.push(`J${i + 1} / ワーク`);
          if (cadBox && box.intersectsBox(cadBox)) collisions.push(`J${i + 1} / CAD`);
          for (let j = i + 3; j < boxes.length; j++) if (box.intersectsBox(boxes[j])) collisions.push(`J${i + 1} / J${j + 1}`);
        });
        latest.current.onCollision([...new Set(collisions)]);
      }
      orbit.update();
      renderer.render(scene, camera);
    };
    animate();
    const resize = () => { camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(mount.clientWidth, mount.clientHeight); };
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(animation);
      window.removeEventListener('resize', resize);
      runtime.current = null;
      transform.dispose();
      orbit.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, [props.model.id, props.tool.lengthMm, props.tool.rx, props.tool.ry, props.tool.rz, props.cad?.url]);

  useEffect(() => {
    const command = props.poseCommand;
    if (!command || !runtime.current) return;
    runtime.current.target.position.set(...command.position);
    runtime.current.target.quaternion.set(...command.quaternion);
    runtime.current.solve();
  }, [props.poseCommand]);

  return <div className="v2-viewport" ref={mountRef} />;
}
