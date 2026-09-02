'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { OBB } from 'three/examples/jsm/math/OBB.js';
import { buildRobot, setAngles, solveIk, type IkResult } from './kinematics';
import type { CadSettings, Pose, RobotPreset, TeachPoint, ToolSettings, WorkSettings } from './types';

type Props = {
  model: RobotPreset;
  tool: ToolSettings;
  cad: CadSettings | null;
  workHeightMm: number;
  workSettings: WorkSettings;
  basePosition: [number, number, number];
  mode: 'translate' | 'rotate';
  poseCommand: (Pose & { nonce: number }) | null;
  jointCommand: { angles: number[]; nonce: number } | null;
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
  const runtime = useRef<{ target: THREE.Object3D; controls: TransformControls; solve: () => void; setJoints: (angles: number[]) => void } | null>(null);
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

    const ws = latest.current.workSettings;
    const workGeometry = ws.shape === 'cylinder'
      ? new THREE.CylinderGeometry(ws.diameterMm / 2000, ws.diameterMm / 2000, ws.lengthMm / 1000, 32)
      : new THREE.BoxGeometry(ws.widthMm / 1000, ws.heightMm / 1000, ws.depthMm / 1000);
    const work = new THREE.Mesh(workGeometry, new THREE.MeshStandardMaterial({ color: '#e7ece9', roughness: .75 }));
    if (ws.shape === 'cylinder') work.rotation[ws.axis === 'x' ? 'z' : 'x'] = Math.PI / 2;
    const workHalfHeight = (ws.shape === 'cylinder' ? ws.diameterMm : ws.heightMm) / 2000;
    work.position.set(0, latest.current.workHeightMm / 1000 + workHalfHeight, 0);
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
      angles = result.angles;
      latest.current.onJoints([...angles]);
      latest.current.onIk(result);
      latest.current.onPose(readPose());
    };
    const setJointAngles = (nextAngles: number[]) => {
      angles = nextAngles.map((value, index) => THREE.MathUtils.clamp(value, latest.current.model.lower[index], latest.current.model.upper[index]));
      setAngles(robot.joints, angles);
      endpoint.updateWorldMatrix(true, false);
      endpoint.getWorldPosition(target.position);
      endpoint.getWorldQuaternion(target.quaternion);
      latest.current.onJoints([...angles]);
      latest.current.onPose(readPose());
      latest.current.onIk({ angles: [...angles], positionErrorMm: 0, rotationErrorDeg: 0, positionReachable: true, orientationReachable: true, reachable: true });
    };
    transform.addEventListener('objectChange', runIk);
    runtime.current = { target, controls: transform, solve: runIk, setJoints: setJointAngles };
    runIk();

    let frame = 0;
    let animation = 0;
    const objectObbs = (object: THREE.Object3D | null) => {
      const result: OBB[] = [];
      if (!object) return result;
      object.updateWorldMatrix(true, true);
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        if (!box || box.isEmpty()) return;
        result.push(new OBB().fromBox3(box).applyMatrix4(mesh.matrixWorld));
      });
      return result;
    };
    const obbSetsIntersect = (first: OBB[], second: OBB[]) => first.some(a => second.some(b => a.intersectsOBB(b, 1e-5)));
    const objectMinVertexY = (object: THREE.Object3D) => {
      let minimum = Infinity;
      const vertex = new THREE.Vector3();
      object.updateWorldMatrix(true, true);
      object.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const positions = mesh.geometry.getAttribute('position');
        if (!positions) return;
        for (let index = 0; index < positions.count; index++) {
          vertex.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
          if (vertex.y < minimum) minimum = vertex.y;
        }
      });
      return minimum;
    };
    const animate = () => {
      animation = requestAnimationFrame(animate);
      transform.setMode(latest.current.mode);
      base.position.set(latest.current.basePosition[0], latest.current.basePosition[2], latest.current.basePosition[1]);
      work.position.y = latest.current.workHeightMm / 1000 + workHalfHeight;
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
        const workObbs = objectObbs(work);
        const cadObbs = objectObbs(cadObject);
        const linkObbs = robot.meshHolders.map(holder => objectObbs(holder));
        linkObbs.forEach((obbs, i) => {
          if (objectMinVertexY(robot.meshHolders[i]) < -.003) collisions.push(`J${i + 1} ↔ 床`);
          if (obbSetsIntersect(obbs, workObbs)) collisions.push(`J${i + 1} ↔ ワーク`);
          if (cadObbs.length && obbSetsIntersect(obbs, cadObbs)) collisions.push(`J${i + 1} ↔ CAD`);
          for (let j = i + 3; j < linkObbs.length; j++) if (obbSetsIntersect(obbs, linkObbs[j])) collisions.push(`J${i + 1} ↔ J${j + 1}`);
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
  }, [props.model.id, props.tool.lengthMm, props.tool.rx, props.tool.ry, props.tool.rz, props.cad?.url, props.workSettings.shape, props.workSettings.diameterMm, props.workSettings.lengthMm, props.workSettings.axis, props.workSettings.widthMm, props.workSettings.depthMm, props.workSettings.heightMm]);

  useEffect(() => {
    const command = props.poseCommand;
    if (!command || !runtime.current) return;
    runtime.current.target.position.set(...command.position);
    runtime.current.target.quaternion.set(...command.quaternion);
    runtime.current.solve();
  }, [props.poseCommand]);

  useEffect(() => {
    if (!props.jointCommand || !runtime.current) return;
    runtime.current.setJoints(props.jointCommand.angles);
  }, [props.jointCommand]);

  return <div className="v2-viewport" ref={mountRef} />;
}
