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

export type IkResult = { angles: number[]; positionErrorMm: number; rotationErrorDeg: number; positionReachable: boolean; orientationReachable: boolean; reachable: boolean };

function solveLinear6(matrix: number[][], vector: number[]) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < 6; column++) {
    let pivot = column;
    for (let row = column + 1; row < 6; row++) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    if (Math.abs(augmented[column][column]) < 1e-10) continue;
    const divisor = augmented[column][column];
    for (let value = column; value <= 6; value++) augmented[column][value] /= divisor;
    for (let row = 0; row < 6; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let value = column; value <= 6; value++) augmented[row][value] -= factor * augmented[column][value];
    }
  }
  return augmented.map(row => row[6]);
}

export function solveIk(joints: THREE.Group[], endpoint: THREE.Object3D, targetPosition: THREE.Vector3, targetQuaternion: THREE.Quaternion, start: number[], model: RobotPreset): IkResult {
  const angles = start.map(THREE.MathUtils.degToRad);
  const lower = model.lower.map(THREE.MathUtils.degToRad);
  const upper = model.upper.map(THREE.MathUtils.degToRad);
  const eps = .001;
  const apply = () => joints.forEach((joint, index) => joint.quaternion.setFromAxisAngle(AXES[index], angles[index]));
  const rotationError = (from: THREE.Quaternion, to: THREE.Quaternion) => {
    const delta = to.clone().multiply(from.clone().invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    return new THREE.Vector3(delta.x, delta.y, delta.z).multiplyScalar(2);
  };
  const positionScale = 3.5;
  for (let pass = 0; pass < 55; pass++) {
    apply(); endpoint.updateWorldMatrix(true, false);
    const p0 = new THREE.Vector3(); const q0 = new THREE.Quaternion();
    endpoint.getWorldPosition(p0); endpoint.getWorldQuaternion(q0);
    const positionError = targetPosition.clone().sub(p0);
    const orientationError = rotationError(q0, targetQuaternion);
    if (positionError.length() < .001 && orientationError.length() < .018) break;
    const error = [positionError.x * positionScale, positionError.y * positionScale, positionError.z * positionScale, orientationError.x, orientationError.y, orientationError.z];
    const jacobian = Array.from({ length: 6 }, () => Array(6).fill(0));
    for (let joint = 0; joint < 6; joint++) {
      angles[joint] += eps; apply(); endpoint.updateWorldMatrix(true, false);
      const p1 = new THREE.Vector3(); const q1 = new THREE.Quaternion();
      endpoint.getWorldPosition(p1); endpoint.getWorldQuaternion(q1);
      angles[joint] -= eps;
      const dp = p1.sub(p0).multiplyScalar(positionScale / eps);
      const dr = rotationError(q0, q1).multiplyScalar(1 / eps);
      jacobian[0][joint] = dp.x; jacobian[1][joint] = dp.y; jacobian[2][joint] = dp.z;
      jacobian[3][joint] = dr.x; jacobian[4][joint] = dr.y; jacobian[5][joint] = dr.z;
    }
    const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
    const right = Array(6).fill(0);
    const damping = pass < 12 ? .045 : .018;
    for (let row = 0; row < 6; row++) {
      for (let column = 0; column < 6; column++) {
        for (let sample = 0; sample < 6; sample++) normal[row][column] += jacobian[sample][row] * jacobian[sample][column];
      }
      normal[row][row] += damping * damping;
      for (let sample = 0; sample < 6; sample++) right[row] += jacobian[sample][row] * error[sample];
    }
    const delta = solveLinear6(normal, right);
    for (let joint = 0; joint < 6; joint++) angles[joint] = THREE.MathUtils.clamp(angles[joint] + THREE.MathUtils.clamp(delta[joint] * .8, -.18, .18), lower[joint], upper[joint]);
  }
  apply(); endpoint.updateWorldMatrix(true, false);
  const p = new THREE.Vector3(); const q = new THREE.Quaternion();
  endpoint.getWorldPosition(p); endpoint.getWorldQuaternion(q);
  const positionErrorMm = p.distanceTo(targetPosition) * 1000;
  const rotationErrorDeg = THREE.MathUtils.radToDeg(q.angleTo(targetQuaternion));
  const positionReachable = positionErrorMm < 8;
  const orientationReachable = rotationErrorDeg < 4;
  return { angles: angles.map(THREE.MathUtils.radToDeg), positionErrorMm, rotationErrorDeg, positionReachable, orientationReachable, reachable: positionReachable && orientationReachable };
}
