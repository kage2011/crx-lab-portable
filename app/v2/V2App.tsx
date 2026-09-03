'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import V2Viewport from './V2Viewport';
import type { IkResult } from './kinematics';
import { ROBOTS, type CadSettings, type Pose, type TeachPoint, type ToolSettings, type Vec3Tuple, type WorkSettings } from './types';
import './v2.css';
import './work.css';

type CadPlacement = Pick<CadSettings, 'position' | 'rotation' | 'scale'>;
type SavedLayout = { modelId: string; tool: ToolSettings; work?: WorkSettings; workHeightMm: number; basePosition: Vec3Tuple; teachPoints: TeachPoint[]; angles?: number[]; cadPlacement?: CadPlacement };
const defaultPose: Pose = { position: [.7, 0, .8], quaternion: [0, 0, 0, 1] };
const defaultIk: IkResult = { angles: [0, 0, 0, 0, 0, 0], positionErrorMm: 0, rotationErrorDeg: 0, positionReachable: true, orientationReachable: true, reachable: true };
const defaultAngles = [0, -18, 72, 0, 38, 0];
const defaultCadPlacement: CadPlacement = { position: [.65, -.3, 0], rotation: [0, 0, 0], scale: .001 };

function encodeLayout(value: SavedLayout) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let raw = '';
  bytes.forEach(byte => { raw += String.fromCharCode(byte); });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeLayout(value: string): SavedLayout | null {
  try {
    const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0)))) as SavedLayout;
  } catch { return null; }
}

function NumberField({ label, value, unit = 'mm', step = 1, onChange }: { label: string; value: number; unit?: string; step?: number; onChange: (value: number) => void }) {
  return <label className="v2-number"><span>{label}</span><div><input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={event => onChange(Number(event.target.value))} /><small>{unit}</small></div></label>;
}

export default function V2App() {
  const restored = useMemo(() => decodeLayout(location.hash.replace(/^#layout=/, '')) || (() => { try { return JSON.parse(localStorage.getItem('crx-v2-layout') || 'null') as SavedLayout | null; } catch { return null; } })(), []);
  const restoredAngles = restored?.angles?.length === 6 ? restored.angles : defaultAngles;
  const [modelId, setModelId] = useState(restored?.modelId || 'crx20ia_l');
  const [tool, setTool] = useState<ToolSettings>(restored?.tool || { lengthMm: 100, rx: 0, ry: 0, rz: 0 });
  const [workHeightMm, setWorkHeightMm] = useState(restored?.workHeightMm ?? 0);
  const [work, setWork] = useState<WorkSettings>(restored?.work || { shape: 'cylinder', diameterMm: 30, lengthMm: 300, axis: 'y', widthMm: 300, depthMm: 300, heightMm: 220 });
  const [basePosition, setBasePosition] = useState<Vec3Tuple>(restored?.basePosition || [0, 0, 0]);
  const [teachPoints, setTeachPoints] = useState<TeachPoint[]>(restored?.teachPoints || []);
  const [pose, setPose] = useState<Pose>(defaultPose);
  const [poseCommand, setPoseCommand] = useState<(Pose & { nonce: number }) | null>(null);
  const [jointCommand, setJointCommand] = useState<{ angles: number[]; nonce: number } | null>(null);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
  const [angles, setAngles] = useState([...restoredAngles]);
  const [ik, setIk] = useState<IkResult>({ ...defaultIk, angles: [...restoredAngles] });
  const [collisions, setCollisions] = useState<string[]>([]);
  const [cad, setCad] = useState<CadSettings | null>(null);
  const [cadPlacement, setCadPlacement] = useState<CadPlacement>(restored?.cadPlacement || defaultCadPlacement);
  const [toast, setToast] = useState('');
  const [overridePercent, setOverridePercent] = useState(25);
  const [playing, setPlaying] = useState(false);
  const [playStep, setPlayStep] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [plannedSec, setPlannedSec] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLInputElement>(null);
  const animationRef = useRef<number | null>(null);
  const overrideRef = useRef(overridePercent);
  overrideRef.current = overridePercent;
  const model = ROBOTS.find(item => item.id === modelId) || ROBOTS[1];
  const layout: SavedLayout = { modelId, tool, work, workHeightMm, basePosition, teachPoints, angles, cadPlacement };
  const jointLimits = angles.map((angle, index) => {
    const lower = model.lower[index];
    const upper = model.upper[index];
    const range = upper - lower;
    const lowerMargin = Math.max(0, angle - lower);
    const upperMargin = Math.max(0, upper - angle);
    const margin = Math.min(lowerMargin, upperMargin);
    const usage = Math.min(100, Math.max(0, (1 - margin / (range / 2)) * 100));
    const side = lowerMargin <= upperMargin ? '下限' : '上限';
    const level = margin <= .2 ? 'limit' : usage >= 85 ? 'warning' : 'normal';
    return { angle, lower, upper, margin, usage, side, level };
  });
  const tightestJoint = jointLimits.reduce((tightest, item, index) => item.margin < tightest.item.margin ? { item, index } : tightest, { item: jointLimits[0], index: 0 });

  useEffect(() => {
    const timer = setTimeout(() => localStorage.setItem('crx-v2-layout', JSON.stringify(layout)), 160);
    return () => clearTimeout(timer);
  }, [modelId, tool, work, workHeightMm, basePosition, teachPoints, angles, cadPlacement]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2400); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => () => { if (animationRef.current !== null) cancelAnimationFrame(animationRef.current); }, []);

  const setToolValue = (key: keyof ToolSettings, value: number) => setTool(current => ({ ...current, [key]: value }));
  const setWorkValue = <K extends keyof WorkSettings>(key: K, value: WorkSettings[K]) => setWork(current => ({ ...current, [key]: value }));
  const setBase = (index: number, valueMm: number) => setBasePosition(current => current.map((value, i) => i === index ? valueMm / 1000 : value) as Vec3Tuple);
  const sceneIndex = (worldIndex: number) => [0, 2, 1][worldIndex];
  const worldValue = (position: Vec3Tuple, worldIndex: number) => position[sceneIndex(worldIndex)];
  const setTcp = (index: number, valueMm: number) => {
    const mappedIndex = sceneIndex(index);
    const next: Pose & { nonce: number } = { ...pose, position: pose.position.map((value, i) => i === mappedIndex ? valueMm / 1000 : value) as Vec3Tuple, nonce: Date.now() };
    setPoseCommand(next);
  };
  const addPoint = () => setTeachPoints(points => [...points, { ...pose, angles: [...angles], modelId, id: crypto.randomUUID(), name: `P${String(points.length + 1).padStart(2, '0')}` }]);
  const moveJoint = (index: number, value: number) => {
    const next = angles.map((angle, i) => i === index ? Math.min(model.upper[i], Math.max(model.lower[i], value)) : angle);
    setAngles(next);
    setJointCommand({ angles: next, nonce: Date.now() + Math.random() });
  };
  const recall = (point: TeachPoint) => {
    if (point.angles?.length === 6 && (!point.modelId || point.modelId === modelId)) {
      setJointCommand({ angles: [...point.angles], nonce: Date.now() });
      return;
    }
    setPoseCommand({ position: point.position, quaternion: point.quaternion, nonce: Date.now() });
  };
  const segmentBaseSeconds = (from: number[], to: number[]) => Math.max(.12, Math.max(...to.map((value, index) => Math.abs(value - from[index]) / model.velocity[index])) * 1.5);
  const playablePoints = teachPoints.filter(point => point.angles?.length === 6 && (!point.modelId || point.modelId === modelId));
  const estimateProgramSeconds = (startAngles: number[], speedPercent: number) => {
    let previous = startAngles;
    let total = 0;
    for (const point of playablePoints) {
      total += segmentBaseSeconds(previous, point.angles!) / (speedPercent / 100);
      previous = point.angles!;
    }
    return total;
  };
  const pointEstimatedSeconds = (point: TeachPoint) => {
    const index = playablePoints.indexOf(point);
    if (index < 0 || !point.angles) return null;
    const previous = index === 0 ? angles : playablePoints[index - 1].angles!;
    return segmentBaseSeconds(previous, point.angles) / (overridePercent / 100);
  };
  const stopProgram = () => {
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    setPlaying(false);
  };
  const updatePoint = (point: TeachPoint) => {
    stopProgram();
    setTeachPoints(items => items.map(item => item.id === point.id ? { ...pose, id: item.id, name: item.name, angles: [...angles], modelId } : item));
    setToast(`${point.name}を現在姿勢で更新しました`);
  };
  const movePoint = (index: number, offset: -1 | 1) => {
    stopProgram();
    setTeachPoints(items => {
      const destination = index + offset;
      if (destination < 0 || destination >= items.length) return items;
      const next = [...items];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };
  const playProgram = () => {
    stopProgram();
    if (playablePoints.length === 0) { setToast('軸角度を保存した教示点がありません'); return; }
    const points = playablePoints.map(point => ({ ...point, angles: [...point.angles!] }));
    let from = [...angles];
    let segmentIndex = 0;
    let progress = 0;
    let lastTime = performance.now();
    const programStart = lastTime;
    setPlannedSec(estimateProgramSeconds(from, overrideRef.current));
    setElapsedSec(0); setPlayStep(1); setPlaying(true);
    const frame = (now: number) => {
      const targetAngles = points[segmentIndex].angles;
      const baseSeconds = segmentBaseSeconds(from, targetAngles);
      progress = Math.min(1, progress + ((now - lastTime) / 1000) * (overrideRef.current / 100) / baseSeconds);
      lastTime = now;
      const eased = progress * progress * (3 - 2 * progress);
      const next = from.map((value, index) => value + (targetAngles[index] - value) * eased);
      setAngles(next);
      setJointCommand({ angles: next, nonce: now + Math.random() });
      setElapsedSec((now - programStart) / 1000);
      if (progress < 1) { animationRef.current = requestAnimationFrame(frame); return; }
      from = [...targetAngles];
      segmentIndex += 1;
      if (segmentIndex >= points.length) {
        animationRef.current = null; setPlaying(false); setPlayStep(points.length); return;
      }
      progress = 0; setPlayStep(segmentIndex + 1);
      animationRef.current = requestAnimationFrame(frame);
    };
    animationRef.current = requestAnimationFrame(frame);
  };
  const share = async () => {
    const url = `${location.origin}${location.pathname}#layout=${encodeLayout(layout)}`;
    await navigator.clipboard.writeText(url);
    history.replaceState(null, '', url);
    setToast('共有URLをコピーしました');
  };
  const download = () => {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }));
    anchor.download = `crx-layout-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  };
  const importLayout = async (file: File) => {
    try {
      const next = JSON.parse(await file.text()) as SavedLayout;
      if (!ROBOTS.some(item => item.id === next.modelId) || !Array.isArray(next.teachPoints)) throw new Error();
      setModelId(next.modelId); setTool(next.tool); if (next.work) setWork(next.work); setWorkHeightMm(next.workHeightMm); setBasePosition(next.basePosition); setTeachPoints(next.teachPoints);
      if (next.angles?.length === 6) { setAngles([...next.angles]); setJointCommand({ angles: [...next.angles], nonce: Date.now() }); }
      if (next.cadPlacement) {
        setCadPlacement(next.cadPlacement);
        setCad(current => current ? { ...current, ...next.cadPlacement } : current);
      }
      setToast('レイアウトを読み込みました');
    } catch { setToast('レイアウトファイルを読めません'); }
  };
  const importCad = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'stl' && ext !== 'obj') { setToast('STLまたはOBJを選択してください'); return; }
    if (cad) URL.revokeObjectURL(cad.url);
    const placement = { ...cadPlacement, scale: cadPlacement.scale || (ext === 'stl' ? .001 : 1) };
    setCad({ url: URL.createObjectURL(file), name: file.name, kind: ext, ...placement });
  };
  const updateCadPlacement = (patch: Partial<CadPlacement>) => {
    setCadPlacement(current => ({ ...current, ...patch }));
    setCad(current => current ? { ...current, ...patch } : current);
  };

  return <main className="v2-shell">
    <header className="v2-header">
      <div className="v2-brand"><b>CRX LAB</b><span>PLANNING STUDIO</span><em>V2 PROTOTYPE</em></div>
      <div className="v2-header-status"><span className={ik.reachable ? 'ok' : ik.positionReachable ? 'warn' : 'ng'}>{ik.reachable ? '位置・姿勢 到達' : ik.positionReachable ? '位置到達 / 姿勢未収束' : '位置 到達不可'}</span><span className={collisions.length ? 'ng' : 'ok'}>{collisions.length ? `干渉 ${collisions.length}` : '干渉なし'}</span></div>
      <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}>現行版へ戻る</a>
    </header>
    <section className="v2-workspace">
      <div className="v2-stage">
        <V2Viewport model={model} tool={tool} cad={cad} workHeightMm={workHeightMm} workSettings={work} basePosition={basePosition} mode={mode} poseCommand={poseCommand} jointCommand={jointCommand} initialAngles={angles} teachPoints={teachPoints} onJoints={setAngles} onPose={setPose} onIk={setIk} onCollision={setCollisions} />
        <div className="v2-stage-copy"><span>DIGITAL MOCK-UP / {model.name}</span><strong>セル構想を、届く形に。</strong><small>球を選び、軸をドラッグ。移動は姿勢固定、回転はTCP中心です。</small></div>
        <div className="v2-stage-tools"><button className={mode === 'translate' ? 'active' : ''} onClick={() => setMode('translate')}>↔ 位置移動</button><button className={mode === 'rotate' ? 'active' : ''} onClick={() => setMode('rotate')}>⟳ 向き移動</button></div>
        <div className="v2-readout"><b>TCP</b> X {(worldValue(pose.position, 0) * 1000).toFixed(0)} / Y {(worldValue(pose.position, 1) * 1000).toFixed(0)} / Z {(worldValue(pose.position, 2) * 1000).toFixed(0)} mm<br />誤差 {ik.positionErrorMm.toFixed(1)} mm / {ik.rotationErrorDeg.toFixed(1)}°</div>
      </div>
      <aside className="v2-panel">
        <section className="v2-primary">
          <label>ROBOT MODEL<select value={modelId} onChange={event => setModelId(event.target.value)}>{ROBOTS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div><span><small>可搬質量</small><b>{model.payload}</b></span><span><small>最大リーチ</small><b>{model.reach}</b></span></div>
        </section>
        <details open><summary>TCP位置 / ロボット設置</summary>
          <h3>TCP ワールド座標</h3><div className="v2-grid3">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={axis} value={Math.round(worldValue(pose.position, i) * 1000)} onChange={value => setTcp(i, value)} />)}</div>
          <h3>ロボット取付面中心</h3><div className="v2-grid3">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={axis} value={Math.round(basePosition[i] * 1000)} onChange={value => setBase(i, value)} />)}</div>
          <NumberField label="ワーク床上高さ" value={workHeightMm} onChange={setWorkHeightMm} />
        </details>
        <details open><summary>ワーク形状 / サイズ</summary>
          <div className="v2-select-row"><label>形状<select value={work.shape} onChange={event => setWorkValue('shape', event.target.value as WorkSettings['shape'])}><option value="cylinder">横置き円筒</option><option value="box">直方体</option></select></label></div>
          {work.shape === 'cylinder' ? <>
            <div className="v2-grid3"><NumberField label="直径 φ" value={work.diameterMm} onChange={value => setWorkValue('diameterMm', Math.max(1, value))} /><NumberField label="長さ" value={work.lengthMm} onChange={value => setWorkValue('lengthMm', Math.max(1, value))} /><label className="v2-select-field"><span>長手方向</span><select value={work.axis} onChange={event => setWorkValue('axis', event.target.value as WorkSettings['axis'])}><option value="x">X方向</option><option value="y">Y方向</option></select></label></div>
            <p>初期値は、ご指定の横置き円筒 φ30 × 300 mmです。</p>
          </> : <div className="v2-grid3"><NumberField label="X幅" value={work.widthMm} onChange={value => setWorkValue('widthMm', Math.max(1, value))} /><NumberField label="Y奥行" value={work.depthMm} onChange={value => setWorkValue('depthMm', Math.max(1, value))} /><NumberField label="Z高さ" value={work.heightMm} onChange={value => setWorkValue('heightMm', Math.max(1, value))} /></div>}
        </details>
        <details open><summary>ツール設定</summary>
          <NumberField label="ツール長" value={tool.lengthMm} onChange={value => setToolValue('lengthMm', Math.max(1, value))} />
          <div className="v2-grid3">{(['rx', 'ry', 'rz'] as const).map(key => <NumberField key={key} label={key.toUpperCase()} unit="°" value={tool[key]} onChange={value => setToolValue(key, value)} />)}</div>
          <p>フランジ先端から+X方向。姿勢変更時もTCP中心点は固定します。</p>
        </details>
        <details open><summary>到達性 / 干渉</summary>
          <div className={`v2-alert ${ik.positionReachable ? 'safe' : 'danger'}`}><b>{ik.positionReachable ? '位置：到達' : '位置：到達不可'}</b><span>位置誤差 {ik.positionErrorMm.toFixed(1)} mm（判定基準 8 mm未満）</span></div>
          <div className={`v2-alert ${ik.orientationReachable ? 'safe' : ik.positionReachable ? 'warning' : 'danger'}`}><b>{ik.orientationReachable ? '姿勢：収束' : '姿勢：未収束'}</b><span>姿勢誤差 {ik.rotationErrorDeg.toFixed(1)}°（判定基準 4°未満）</span></div>
          <div className={`v2-alert ${collisions.length ? 'danger' : 'safe'}`}><b>{collisions.length ? collisions.join('、') : '簡易干渉なし'}</b><span>床・ワーク・CAD・自己干渉のメッシュ別OBB概算</span></div>
          <div className={`v2-limit-summary ${tightestJoint.item.level}`}><b>軸制限：最小余裕 J{tightestJoint.index + 1}</b><span>{tightestJoint.item.side}まで {tightestJoint.item.margin.toFixed(1)}°　制限使用率 {tightestJoint.item.usage.toFixed(0)}%</span></div>
          <div className="v2-limit-grid">{jointLimits.map((item, index) => <span key={index} className={item.level}><b>J{index + 1}</b><small>{item.angle.toFixed(1)}°</small><em>{item.side}まで {item.margin.toFixed(1)}°</em><i>{item.usage.toFixed(0)}%</i></span>)}</div>
        </details>
        <details><summary>CAD配置（STL / OBJ）</summary>
          <input ref={fileRef} hidden type="file" accept=".stl,.obj" onChange={event => event.target.files?.[0] && importCad(event.target.files[0])} />
          <button className="v2-action" onClick={() => fileRef.current?.click()}>CADファイルを選択</button>
          {cad && <><p className="v2-file">{cad.name}</p><h3>位置</h3><div className="v2-grid3">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={axis} value={Math.round(cad.position[i] * 1000)} onChange={value => updateCadPlacement({ position: cad.position.map((old, j) => i === j ? value / 1000 : old) as Vec3Tuple })} />)}</div><h3>角度</h3><div className="v2-grid3">{(['RX', 'RY', 'RZ'] as const).map((axis, i) => <NumberField key={axis} label={axis} unit="°" value={cad.rotation[i]} onChange={value => updateCadPlacement({ rotation: cad.rotation.map((old, j) => i === j ? value : old) as Vec3Tuple })} />)}</div><NumberField label="スケール" value={cad.scale} unit="倍" step={.001} onChange={value => updateCadPlacement({ scale: Math.max(.000001, value) })} /></>}
        </details>
        <details open><summary>教示点 / 軌跡</summary>
          <button className="v2-action accent" onClick={addPoint}>＋ 現在位置を教示</button>
          <div className="v2-program">
            <label><span>速度オーバーライド</span><input aria-label="速度オーバーライド" type="range" min="1" max="100" step="1" value={overridePercent} onChange={event => setOverridePercent(Number(event.target.value))} /><span className="v2-override-number"><input aria-label="速度オーバーライド数値" type="number" min="1" max="100" value={overridePercent} onChange={event => setOverridePercent(Math.min(100, Math.max(1, Number(event.target.value))))} /><small>%</small></span></label>
            <div className="v2-program-time"><span><small>推定所要時間</small><b>{estimateProgramSeconds(angles, overridePercent).toFixed(2)} 秒</b></span><span><small>{playing ? `動作中 P${playStep}` : '経過時間'}</small><b>{elapsedSec.toFixed(2)} 秒</b></span>{playing && <span><small>開始時予定</small><b>{plannedSec.toFixed(2)} 秒</b></span>}</div>
            <div className="v2-program-buttons"><button className="play" disabled={playing || playablePoints.length === 0} onClick={playProgram}>▶ 連続動作</button><button className="stop" disabled={!playing} onClick={stopProgram}>■ 停止</button></div>
            <p>公式軸速度上限とオーバーライドから算出したシミュレーション値です。加減速を含む実機時間とは異なります。</p>
          </div>
          <div className="v2-points">{teachPoints.length === 0 && <p>教示点はまだありません。</p>}{teachPoints.map((point, index) => { const seconds = pointEstimatedSeconds(point); return <div key={point.id} className={`v2-point ${point.angles ? '' : 'legacy'}`}><div className="v2-point-head"><input aria-label={`${point.name}の名前`} value={point.name} onChange={event => setTeachPoints(items => items.map(item => item.id === point.id ? { ...item, name: event.target.value } : item))} /><span className="v2-point-order"><button aria-label={`${point.name}を上へ`} disabled={index === 0} onClick={() => movePoint(index, -1)}>↑</button><button aria-label={`${point.name}を下へ`} disabled={index === teachPoints.length - 1} onClick={() => movePoint(index, 1)}>↓</button><button aria-label={`${point.name}を削除`} onClick={() => { stopProgram(); setTeachPoints(items => items.filter(item => item.id !== point.id)); }}>×</button></span></div><button className="v2-point-recall" onClick={() => recall(point)}><span>X {Math.round(worldValue(point.position, 0) * 1000)} Y {Math.round(worldValue(point.position, 1) * 1000)} Z {Math.round(worldValue(point.position, 2) * 1000)}</span>{point.angles && <small>J: {point.angles.map(value => value.toFixed(1)).join(' / ')}°{seconds !== null ? `　区間 ${seconds.toFixed(2)}秒` : ''}</small>}{!point.angles && <small>旧形式：位置から復元</small>}</button><button className="v2-point-update" onClick={() => updatePoint(point)}>現在姿勢で更新</button></div>; })}</div>
        </details>
        <details><summary>共有 / 保存</summary>
          <div className="v2-actions"><button onClick={share}>共有URLをコピー</button><button onClick={download}>JSON保存</button><button onClick={() => layoutRef.current?.click()}>JSON読込</button></div>
          <input ref={layoutRef} hidden type="file" accept="application/json,.json" onChange={event => event.target.files?.[0] && importLayout(event.target.files[0])} />
          <p>現在の軸姿勢、ロボット、ツール、CAD配置、教示点を共有します。CAD本体は含みません。</p>
        </details>
        <details open><summary>軸角度 / 個別移動</summary><div className="v2-joint-controls">{angles.map((angle, i) => <label key={i} className={jointLimits[i].level}><span><b>J{i + 1}<em>{jointLimits[i].level === 'limit' ? '制限到達' : jointLimits[i].level === 'warning' ? '制限注意' : '正常'}</em></b><small>可動 {model.lower[i].toFixed(1)}° ～ {model.upper[i].toFixed(1)}°</small><small>{jointLimits[i].side}まで残り {jointLimits[i].margin.toFixed(1)}° / 使用率 {jointLimits[i].usage.toFixed(0)}%</small></span><input type="range" min={model.lower[i]} max={model.upper[i]} step="0.1" value={angle} onChange={event => moveJoint(i, Number(event.target.value))} /><span className="v2-joint-number"><input aria-label={`J${i + 1}角度`} type="number" min={model.lower[i]} max={model.upper[i]} step="0.1" value={Number(angle.toFixed(1))} onChange={event => moveJoint(i, Number(event.target.value))} /><small>°</small></span></label>)}</div></details>
        <p className="v2-disclaimer">構想検討用プロトタイプ。到達性・干渉結果は参考値であり、実機の安全検証には使用できません。</p>
      </aside>
    </section>
    {toast && <div className="v2-toast">{toast}</div>}
  </main>;
}
