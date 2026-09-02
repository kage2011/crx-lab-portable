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
  const angles = start.map(THREE.MathUtils.degToRad);
  const lower = model.lower.map(THREE.MathUtils.degToRad);
  const upper = model.upper.map(THREE.MathUtils.degToRad);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const eps = .001;
  const apply = () => joints.forEach((joint, index) => joint.quaternion.setFromAxisAngle(AXES[index], angles[index]));
  const rotationError = (from: THREE.Quaternion, to: THREE.Quaternion) => {
    const delta = to.clone().multiply(from.clone().invert());
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    return new THREE.Vector3(delta.x, delta.y, delta.z).multiplyScalar(2);
  };
  const correctPosition = (maxStep: number) => {
    apply(); endpoint.updateWorldMatrix(true, false); endpoint.getWorldPosition(p);
    for (let i = 5; i >= 0; i--) {
      apply(); endpoint.updateWorldMatrix(true, false);
      const jointPosition = new THREE.Vector3();
      const endPosition = new THREE.Vector3();
      joints[i].getWorldPosition(jointPosition);
      endpoint.getWorldPosition(endPosition);
      const parentQuaternion = new THREE.Quaternion();
      joints[i].parent?.getWorldQuaternion(parentQuaternion);
      const axisWorld = AXES[i].clone().applyQuaternion(parentQuaternion).normalize();
      const toEnd = endPosition.sub(jointPosition);
      const toTarget = targetPosition.clone().sub(jointPosition);
      toEnd.addScaledVector(axisWorld, -toEnd.dot(axisWorld));
      toTarget.addScaledVector(axisWorld, -toTarget.dot(axisWorld));
      if (toEnd.lengthSq() < 1e-10 || toTarget.lengthSq() < 1e-10) continue;
      toEnd.normalize(); toTarget.normalize();
      const delta = Math.atan2(axisWorld.dot(toEnd.clone().cross(toTarget)), THREE.MathUtils.clamp(toEnd.dot(toTarget), -1, 1));
      angles[i] = THREE.MathUtils.clamp(angles[i] + THREE.MathUtils.clamp(delta, -maxStep, maxStep), lower[i], upper[i]);
    }
  };
  for (let pass = 0; pass < 28; pass++) {
    apply(); endpoint.updateWorldMatrix(true, false); endpoint.getWorldPosition(p); endpoint.getWorldQuaternion(q);
    if (p.distanceTo(targetPosition) < .0015 && rotationError(q, targetQuaternion).length() < .025) break;
    for (let i = 5; i >= 0; i--) {
      apply(); endpoint.updateWorldMatrix(true, false);
      const p0 = new THREE.Vector3(); const q0 = new THREE.Quaternion();
      endpoint.getWorldPosition(p0); endpoint.getWorldQuaternion(q0);
      const positionError = targetPosition.clone().sub(p0);
      const orientationError = rotationError(q0, targetQuaternion);
      angles[i] += eps; apply(); endpoint.updateWorldMatrix(true, false);
      const p1 = new THREE.Vector3(); const q1 = new THREE.Quaternion();
      endpoint.getWorldPosition(p1); endpoint.getWorldQuaternion(q1);
      angles[i] -= eps;
      const dp = p1.sub(p0).divideScalar(eps);
      const dr = rotationError(q0, q1).divideScalar(eps);
      const positionWeight = 22;
      const rotationWeight = .32;
      const delta = (positionWeight * dp.dot(positionError) + rotationWeight * dr.dot(orientationError)) /
        (positionWeight * dp.lengthSq() + rotationWeight * dr.lengthSq() + 1e-6);
      angles[i] = THREE.MathUtils.clamp(angles[i] + THREE.MathUtils.clamp(delta * .72, -.14, .14), lower[i], upper[i]);
    }
    correctPosition(.1);
  }
  correctPosition(.015);
  apply(); endpoint.updateWorldMatrix(true, false); endpoint.getWorldPosition(p); endpoint.getWorldQuaternion(q);
  const positionErrorMm = p.distanceTo(targetPosition) * 1000;
  const rotationErrorDeg = THREE.MathUtils.radToDeg(q.angleTo(targetQuaternion));
  return { angles: angles.map(THREE.MathUtils.radToDeg), positionErrorMm, rotationErrorDeg, reachable: positionErrorMm < 8 && rotationErrorDeg < 4 };
}
