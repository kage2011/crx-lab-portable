export type Vec3Tuple = [number, number, number];
export type JointTuple = [number, number, number, number, number, number];

export type RobotPreset = {
  id: string;
  name: string;
  assetDir: string;
  payload: string;
  reach: string;
  lengths: [number, number, number, number, number, number, number];
  lower: JointTuple;
  upper: JointTuple;
};

export type Pose = { position: Vec3Tuple; quaternion: [number, number, number, number] };
export type TeachPoint = Pose & { id: string; name: string };
export type ToolSettings = { lengthMm: number; rx: number; ry: number; rz: number };
export type WorkSettings = {
  shape: 'cylinder' | 'box';
  diameterMm: number;
  lengthMm: number;
  axis: 'x' | 'y';
  widthMm: number;
  depthMm: number;
  heightMm: number;
};
export type CadSettings = { url: string; name: string; kind: 'stl' | 'obj'; position: Vec3Tuple; rotation: Vec3Tuple; scale: number };

export const ROBOTS: RobotPreset[] = [
  { id: 'crx10ia', name: 'CRX-10iA', assetDir: 'crx10ia', payload: '10 kg', reach: '1,249 mm', lengths: [.245, 0, .54, 0, .54, .15, .16], lower: [-190, -179.9, -71, -190, -179.9, -225], upper: [190, 179.9, 251, 190, 179.9, 225] },
  { id: 'crx20ia_l', name: 'CRX-20iA/L', assetDir: 'crx20ia_l', payload: '20 kg', reach: '1,418 mm', lengths: [.245, 0, .71, 0, .54, .15, .16], lower: [-179.9, -179.9, -270, -190, -179.9, -225], upper: [179.9, 179.9, 270, 190, 179.9, 225] },
  { id: 'crx30ia', name: 'CRX-30iA', assetDir: 'crx30ia', payload: '30 kg', reach: '1,889 mm', lengths: [.37, 0, .95, 0, .75, .185, .18], lower: [-179.9, -179.9, -270, -190, -179.9, -225], upper: [179.9, 179.9, 270, 190, 179.9, 225] },
];
