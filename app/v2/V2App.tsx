'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import V2Viewport from './V2Viewport';
import type { IkResult } from './kinematics';
import { ROBOTS, type CadSettings, type Pose, type TeachPoint, type ToolSettings, type Vec3Tuple } from './types';
import './v2.css';

type SavedLayout = { modelId: string; tool: ToolSettings; workHeightMm: number; basePosition: Vec3Tuple; teachPoints: TeachPoint[] };
const defaultPose: Pose = { position: [.7, 0, .8], quaternion: [0, 0, 0, 1] };
const defaultIk: IkResult = { angles: [0, 0, 0, 0, 0, 0], positionErrorMm: 0, rotationErrorDeg: 0, reachable: true };

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
  const [modelId, setModelId] = useState(restored?.modelId || 'crx20ia_l');
  const [tool, setTool] = useState<ToolSettings>(restored?.tool || { lengthMm: 100, rx: 0, ry: 0, rz: 0 });
  const [workHeightMm, setWorkHeightMm] = useState(restored?.workHeightMm ?? 0);
  const [basePosition, setBasePosition] = useState<Vec3Tuple>(restored?.basePosition || [0, 0, 0]);
  const [teachPoints, setTeachPoints] = useState<TeachPoint[]>(restored?.teachPoints || []);
  const [pose, setPose] = useState<Pose>(defaultPose);
  const [poseCommand, setPoseCommand] = useState<(Pose & { nonce: number }) | null>(null);
  const [mode, setMode] = useState<'translate' | 'rotate'>('translate');
  const [angles, setAngles] = useState(defaultIk.angles);
  const [ik, setIk] = useState(defaultIk);
  const [collisions, setCollisions] = useState<string[]>([]);
  const [cad, setCad] = useState<CadSettings | null>(null);
  const [toast, setToast] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const layoutRef = useRef<HTMLInputElement>(null);
  const model = ROBOTS.find(item => item.id === modelId) || ROBOTS[1];
  const layout: SavedLayout = { modelId, tool, workHeightMm, basePosition, teachPoints };

  useEffect(() => { localStorage.setItem('crx-v2-layout', JSON.stringify(layout)); }, [modelId, tool, workHeightMm, basePosition, teachPoints]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2400); return () => clearTimeout(timer); }, [toast]);

  const setToolValue = (key: keyof ToolSettings, value: number) => setTool(current => ({ ...current, [key]: value }));
  const setBase = (index: number, valueMm: number) => setBasePosition(current => current.map((value, i) => i === index ? valueMm / 1000 : value) as Vec3Tuple);
  const sceneIndex = (worldIndex: number) => [0, 2, 1][worldIndex];
  const worldValue = (position: Vec3Tuple, worldIndex: number) => position[sceneIndex(worldIndex)];
  const setTcp = (index: number, valueMm: number) => {
    const mappedIndex = sceneIndex(index);
    const next: Pose & { nonce: number } = { ...pose, position: pose.position.map((value, i) => i === mappedIndex ? valueMm / 1000 : value) as Vec3Tuple, nonce: Date.now() };
    setPoseCommand(next);
  };
  const addPoint = () => setTeachPoints(points => [...points, { ...pose, id: crypto.randomUUID(), name: `P${String(points.length + 1).padStart(2, '0')}` }]);
  const recall = (point: TeachPoint) => setPoseCommand({ position: point.position, quaternion: point.quaternion, nonce: Date.now() });
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
      setModelId(next.modelId); setTool(next.tool); setWorkHeightMm(next.workHeightMm); setBasePosition(next.basePosition); setTeachPoints(next.teachPoints);
      setToast('レイアウトを読み込みました');
    } catch { setToast('レイアウトファイルを読めません'); }
  };
  const importCad = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'stl' && ext !== 'obj') { setToast('STLまたはOBJを選択してください'); return; }
    if (cad) URL.revokeObjectURL(cad.url);
    setCad({ url: URL.createObjectURL(file), name: file.name, kind: ext, position: [.65, -.3, 0], rotation: [0, 0, 0], scale: ext === 'stl' ? .001 : 1 });
  };

  return <main className="v2-shell">
    <header className="v2-header">
      <div className="v2-brand"><b>CRX LAB</b><span>PLANNING STUDIO</span><em>V2 PROTOTYPE</em></div>
      <div className="v2-header-status"><span className={ik.reachable ? 'ok' : 'ng'}>{ik.reachable ? '到達可能' : '到達不可'}</span><span className={collisions.length ? 'ng' : 'ok'}>{collisions.length ? `干渉 ${collisions.length}` : '干渉なし'}</span></div>
      <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`}>現行版へ戻る</a>
    </header>
    <section className="v2-workspace">
      <div className="v2-stage">
        <V2Viewport model={model} tool={tool} cad={cad} workHeightMm={workHeightMm} basePosition={basePosition} mode={mode} poseCommand={poseCommand} teachPoints={teachPoints} onJoints={setAngles} onPose={setPose} onIk={setIk} onCollision={setCollisions} />
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
        <details open><summary>ツール設定</summary>
          <NumberField label="ツール長" value={tool.lengthMm} onChange={value => setToolValue('lengthMm', Math.max(1, value))} />
          <div className="v2-grid3">{(['rx', 'ry', 'rz'] as const).map(key => <NumberField key={key} label={key.toUpperCase()} unit="°" value={tool[key]} onChange={value => setToolValue(key, value)} />)}</div>
          <p>フランジ先端から+X方向。姿勢変更時もTCP中心点は固定します。</p>
        </details>
        <details open><summary>到達性 / 干渉</summary>
          <div className={`v2-alert ${ik.reachable ? 'safe' : 'danger'}`}><b>{ik.reachable ? 'この姿勢に到達できます' : 'この姿勢には到達できません'}</b><span>位置誤差 {ik.positionErrorMm.toFixed(1)} mm　姿勢誤差 {ik.rotationErrorDeg.toFixed(1)}°</span></div>
          <div className={`v2-alert ${collisions.length ? 'danger' : 'safe'}`}><b>{collisions.length ? collisions.join(' / ') : '簡易干渉なし'}</b><span>床・ワーク・CAD・自己干渉のAABB概算</span></div>
        </details>
        <details><summary>CAD配置（STL / OBJ）</summary>
          <input ref={fileRef} hidden type="file" accept=".stl,.obj" onChange={event => event.target.files?.[0] && importCad(event.target.files[0])} />
          <button className="v2-action" onClick={() => fileRef.current?.click()}>CADファイルを選択</button>
          {cad && <><p className="v2-file">{cad.name}</p><div className="v2-grid3">{(['X', 'Y', 'Z'] as const).map((axis, i) => <NumberField key={axis} label={axis} value={Math.round(cad.position[i] * 1000)} onChange={value => setCad({ ...cad, position: cad.position.map((old, j) => i === j ? value / 1000 : old) as Vec3Tuple })} />)}</div><NumberField label="スケール" value={cad.scale} unit="倍" step={.001} onChange={value => setCad({ ...cad, scale: value })} /></>}
        </details>
        <details open><summary>教示点 / 軌跡</summary>
          <button className="v2-action accent" onClick={addPoint}>＋ 現在位置を教示</button>
          <div className="v2-points">{teachPoints.length === 0 && <p>教示点はまだありません。</p>}{teachPoints.map(point => <div key={point.id}><button onClick={() => recall(point)}><b>{point.name}</b><span>X {Math.round(worldValue(point.position, 0) * 1000)} Y {Math.round(worldValue(point.position, 1) * 1000)} Z {Math.round(worldValue(point.position, 2) * 1000)}</span></button><button aria-label={`${point.name}を削除`} onClick={() => setTeachPoints(items => items.filter(item => item.id !== point.id))}>×</button></div>)}</div>
        </details>
        <details><summary>共有 / 保存</summary>
          <div className="v2-actions"><button onClick={share}>共有URLをコピー</button><button onClick={download}>JSON保存</button><button onClick={() => layoutRef.current?.click()}>JSON読込</button></div>
          <input ref={layoutRef} hidden type="file" accept="application/json,.json" onChange={event => event.target.files?.[0] && importLayout(event.target.files[0])} />
          <p>ロボット、ツール、配置、教示点を共有します。CAD本体は含みません。</p>
        </details>
        <details><summary>軸角度</summary><div className="v2-joints">{angles.map((angle, i) => <span key={i}><b>J{i + 1}</b>{angle.toFixed(1)}°</span>)}</div></details>
        <p className="v2-disclaimer">構想検討用プロトタイプ。到達性・干渉結果は参考値であり、実機の安全検証には使用できません。</p>
      </aside>
    </section>
    {toast && <div className="v2-toast">{toast}</div>}
  </main>;
}
