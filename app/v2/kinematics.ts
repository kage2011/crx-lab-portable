import * as THREE from 'three';
import type { RobotPreset } from './types';

const AXES = [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)];

export function buildRobot(root: THREE.Group, model: RobotPreset) {
  const [lb, l1, l2, l3, l4, l5, l6] = model.lengths;
  const origins = [[0, 0, lb], [l1, 0, 0], [0, 0, l2], [0, 0, l3], [l4, 0, 0], [0, -l5, 0]];
  const offsets = [[0, 0, -lb], [-l1, 0, -lb], [-l1, 0, -lb - l2], [-l1, 0, -lb - l2 - l3], [-l1 - l4, 0, -lb - l2 - l3], [-l1 - l4, l5, -lb - l2 - l3]];
  const joints: THREE.Group[] = [];
  const meshHolders: THREE.Group[] = [];
  let parent: THREE.Group = root;
  for (let i = 0; i < 6; i++) {
    const joint = new THREE.Group();
    joint.position.set(...origins[i] as [number, number, number]);
    parent.add(joint);
    const holder = new THREE.Group();
    holder.position.set(...offsets[i] as [number, number, number]);
    joint.add(holder);
    joints.push(joint);
    meshHolders.push(holder);
    parent = joint;
  }
  const flange = new THREE.Group();
  flange.position.set(l6, 0, 0);
  parent.add(flange);
  return { joints, meshHolders, flange };
}

export function setAngles(joints: THREE.Group[], degrees: number[]) {
  joints.forEach((joint, index) => joint.quaternion.setFromAxisAngle(AXES[index], THREE.MathUtils.degToRad(degrees[index])));
}

export type IkResult = { angles: number[]; positionErrorMm: number; rotationErrorDeg: number; reachable: boolean };

export function solveIk(joints: THREE.Group[], endpoint: THREE.Object3D, targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion, start: number[], model: RobotPreset): IkResult {
  const angles = [...start];
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const eps = .12;
  const sample = () => { setAngles(joints, angles); endpoint.updateWorldMatrix(true, false); endpoint.getWorldPosition(p); endpoint.getWorldQuaternion(q); };
  for (let pass = 0; pass < 34; pass++) {
    for (let i = 5; i >= 0; i--) {
      sample();
      const baseP = p.clone();
      const baseQ = q.clone();
      angles[i] += eps;
      sample();
      const dp = p.clone().sub(baseP).multiplyScalar(1 / eps);
      const dq = baseQ.clone().invert().multiply(q);
      const axis = new THREE.Vector3(dq.x, dq.y, dq.z);
      if (axis.lengthSq() > 1e-12) axis.normalize().multiplyScalar(2 * Math.acos(THREE.MathUtils.clamp(dq.w, -1, 1)) / eps);
      const posError = targetPosition.clone().sub(baseP);
      const rotQ = baseQ.clone().invert().multiply(targetQuaternion);
      const rotAxis = new THREE.Vector3(rotQ.x, rotQ.y, rotQ.z);
      if (rotAxis.lengthSq() > 1e-12) rotAxis.normalize().multiplyScalar(2 * Math.acos(THREE.MathUtils.clamp(rotQ.w, -1, 1)));
      const denom = dp.lengthSq() * 24 + axis.lengthSq() * .45 + 1e-7;
      const delta = (dp.dot(posError) * 24 + axis.dot(rotAxis) * .45) / denom;
      angles[i] = THREE.MathUtils.clamp(angles[i] - eps + THREE.MathUtils.clamp(delta, -7, 7), model.lower[i], model.upper[i]);
    }
  }
  sample();
  const positionErrorMm = p.distanceTo(targetPosition) * 1000;
  const rotationErrorDeg = THREE.MathUtils.radToDeg(q.angleTo(targetQuaternion));
  return { angles, positionErrorMm, rotationErrorDeg, reachable: positionErrorMm < 8 && rotationErrorDeg < 4 };
}
