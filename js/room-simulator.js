/**
 * Editor de quarto 3D (Three.js): piso, paredes, janela, porta, móveis + produto GLB.
 * Câmera: orbitar OU andar (WASD + mouse). Móveis cinzas: arrastar no piso; extras adicionar/remover.
 */
/* Import map em simulador.html resolve "three" e "three/addons/" para o navegador. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

function makeWoodCanvasTexture() {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 768;
  const g = c.getContext('2d');
  const planks = 11;
  const ph = c.height / planks;
  for (let i = 0; i < planks; i++) {
    const t = i / planks;
    const base = 118 + t * 58;
    g.fillStyle = `rgb(${base + 22},${base - 12},${base - 48})`;
    g.fillRect(0, i * ph, c.width, ph - 2);
    g.strokeStyle = 'rgba(35,26,18,0.38)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, (i + 1) * ph - 2);
    g.lineTo(c.width, (i + 1) * ph - 2);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.07)';
  for (let x = 0; x < c.width; x += 36) g.fillRect(x, 0, 1, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function makePvcCanvasTexture() {
  const c = document.createElement('canvas');
  c.width = 384;
  c.height = 384;
  const g = c.getContext('2d');
  g.fillStyle = '#e6ebf2';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * c.width;
    const y = Math.random() * c.height;
    g.fillStyle = `rgba(255,255,255,${0.02 + Math.random() * 0.05})`;
    g.fillRect(x, y, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const EXTRA_PRESETS = {
  criado: { w: 0.48, d: 0.42, h: 0.55, label: 'Criado-mudo' },
  puff: { w: 0.55, d: 0.55, h: 0.42, label: 'Puff' },
  estante: { w: 0.9, d: 0.35, h: 1.85, label: 'Estante' }
};

/** Acabamento (cor) do guarda-roupa — clone de material por rebuild. */
const WARDROBE_FINISH = {
  neutral: 0x8b939b,
  white: 0xeaedf2,
  graphite: 0x3a424c,
  oak: 0x8f6a4d
};

/** Clima / iluminação global (somente luzes + fundo + névoa). */
const CLIMATE_PRESETS = {
  clear: {
    bg: 0xe4eaf1,
    fogCol: 0xe4eaf1,
    fogNear: 7,
    fogFar: 28,
    hemiSky: 0xdce6f4,
    hemiGr: 0xb8c5d4,
    hemiI: 0.52,
    dirCol: 0xffffff,
    dirI: 1.02,
    fillCol: 0xf0f6ff,
    fillI: 0.4,
    exposure: 1.06,
    winFill: 0.58,
    winWarm: 0xf2f8ff
  },
  golden: {
    bg: 0xf3ebe4,
    fogCol: 0xeadfd4,
    fogNear: 6,
    fogFar: 22,
    hemiSky: 0xffedd5,
    hemiGr: 0xd4a574,
    hemiI: 0.48,
    dirCol: 0xffe4c4,
    dirI: 1.12,
    fillCol: 0xfff7ed,
    fillI: 0.3,
    exposure: 1.1,
    winFill: 0.68,
    winWarm: 0xffefd0
  },
  overcast: {
    bg: 0xd4dce6,
    fogCol: 0xc5ced9,
    fogNear: 5,
    fogFar: 18,
    hemiSky: 0xcbd5e1,
    hemiGr: 0x94a3b8,
    hemiI: 0.62,
    dirCol: 0xffffff,
    dirI: 0.72,
    fillCol: 0xe2e8f0,
    fillI: 0.52,
    exposure: 0.98,
    winFill: 0.36,
    winWarm: 0xe8eef5
  },
  evening: {
    bg: 0x1e293b,
    fogCol: 0x334155,
    fogNear: 4,
    fogFar: 16,
    hemiSky: 0x64748b,
    hemiGr: 0x0f172a,
    hemiI: 0.36,
    dirCol: 0xfde68a,
    dirI: 0.52,
    fillCol: 0x93c5fd,
    fillI: 0.2,
    exposure: 0.92,
    winFill: 0.12,
    winWarm: 0xffd8a8
  }
};

function addWindowToRoom(roomGroup, w, d, h, eps, mats, style) {
  const zBack = -d / 2 + eps * 2;
  let winW = 1.28;
  let winH = 1.06;
  let sill = 0.92;
  if (style === 'picture') {
    winW = 1.95;
    winH = 1.12;
    sill = 0.88;
  } else if (style === 'french') {
    winW = 1.42;
    winH = 1.12;
    sill = 0.9;
  }
  const glassMat = mats.glassMat.clone();
  glassMat.transparent = true;
  glassMat.opacity = 0.38;
  glassMat.depthWrite = false;
  glassMat.emissive = new THREE.Color(0xd8ecff);
  glassMat.emissiveIntensity = 0.38;
  glassMat.toneMapped = true;
  const frameT = 0.055;
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(winW + frameT * 2, frameT, frameT * 1.15), mats.woodFrameMat);
  topBar.position.set(0, sill + winH + frameT / 2, zBack);
  topBar.castShadow = true;
  const sillBar = new THREE.Mesh(new THREE.BoxGeometry(winW + frameT * 2, frameT * 0.85, frameT * 1.15), mats.woodFrameMat);
  sillBar.position.set(0, sill - frameT / 2, zBack);
  sillBar.castShadow = true;
  roomGroup.add(topBar, sillBar);
  const sideGeo = new THREE.BoxGeometry(frameT, winH, frameT * 1.15);
  const sideL = new THREE.Mesh(sideGeo, mats.woodFrameMat);
  sideL.position.set(-winW / 2 - frameT / 2, sill + winH / 2, zBack);
  sideL.castShadow = true;
  const sideR = new THREE.Mesh(sideGeo, mats.woodFrameMat);
  sideR.position.set(winW / 2 + frameT / 2, sill + winH / 2, zBack);
  sideR.castShadow = true;
  roomGroup.add(sideL, sideR);
  if (style === 'french') {
    const mullion = new THREE.Mesh(new THREE.BoxGeometry(frameT * 0.9, winH * 0.86, frameT * 0.9), mats.woodFrameMat);
    mullion.position.set(0, sill + winH / 2, zBack + 0.018);
    mullion.castShadow = true;
    roomGroup.add(mullion);
    const gw = winW * 0.42;
    const gh = winH * 0.84;
    const g1 = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat);
    g1.position.set(-winW * 0.24, sill + winH / 2, zBack + 0.032);
    const g2 = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat);
    g2.position.set(winW * 0.24, sill + winH / 2, zBack + 0.032);
    roomGroup.add(g1, g2);
  } else {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.9, winH * 0.86), glassMat);
    glass.position.set(0, sill + winH / 2, zBack + 0.034);
    roomGroup.add(glass);
  }
  if (style === 'casement') {
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.52, winH * 1.06), mats.curtainMat);
    curtain.position.set(winW / 2 + 0.3, sill + winH / 2, zBack + 0.038);
    curtain.rotation.y = -0.22;
    curtain.castShadow = true;
    roomGroup.add(curtain);
  }
}

function buildWardrobeGroup(style, ww, wh, wd, bodyMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), bodyMat);
  body.position.set(0, wh / 2, 0);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  if (style === 'panel') {
    const doorMat = bodyMat;
    const dw = ww * 0.22;
    const dMesh = new THREE.Mesh(new THREE.BoxGeometry(dw, wh * 0.88, 0.04), doorMat);
    dMesh.position.set(-ww * 0.22, wh * 0.44, wd / 2 + 0.021);
    dMesh.castShadow = true;
    const d2 = dMesh.clone();
    d2.position.x = ww * 0.22;
    g.add(dMesh, d2);
  } else if (style === 'mirror') {
    const mir = new THREE.MeshStandardMaterial({
      color: 0xc0cad4,
      roughness: 0.18,
      metalness: 0.78,
      envMapIntensity: 1.05
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(ww * 0.62, wh * 0.72), mir);
    plate.position.set(0, wh * 0.46, wd / 2 + 0.022);
    g.add(plate);
  }
  return g;
}

function buildDeskGroup(style, dw, dh, dd, furnitureMat) {
  const grp = new THREE.Group();
  const top = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.045, dd), furnitureMat);
  top.position.set(0, dh - 0.022, 0);
  top.castShadow = top.receiveShadow = true;
  grp.add(top);
  if (style === 'float') {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.22, dh - 0.08, dd * 0.35), furnitureMat);
    ped.position.set(0, (dh - 0.08) / 2, 0);
    ped.castShadow = true;
    grp.add(ped);
  } else {
    const legGeo = new THREE.BoxGeometry(0.055, dh - 0.05, Math.max(0.2, dd - 0.14));
    const leg1 = new THREE.Mesh(legGeo, furnitureMat);
    leg1.position.set(-dw / 2 + 0.11, (dh - 0.05) / 2, 0);
    const leg2 = new THREE.Mesh(legGeo, furnitureMat);
    leg2.position.set(dw / 2 - 0.11, (dh - 0.05) / 2, 0);
    leg1.castShadow = leg2.castShadow = true;
    grp.add(leg1, leg2);
  }
  if (style === 'drawer') {
    const drMat = furnitureMat;
    const drH = (dh - 0.12) / 3;
    for (let i = 0; i < 3; i++) {
      const dr = new THREE.Mesh(new THREE.BoxGeometry(dw * 0.82, drH - 0.02, 0.045), drMat);
      dr.position.set(0, 0.08 + drH * (i + 0.5), dd / 2 + 0.025);
      dr.castShadow = true;
      grp.add(dr);
    }
  }
  return grp;
}

export function mountRoomSimulator(hostEl, options) {
  const glbUrl = options.glbUrl;
  const onError = typeof options.onError === 'function' ? options.onError : function () {};

  const state = {
    floor: options.initialFloor || 'wood',
    roomW: Number(options.initialRoomW) || 4.8,
    roomD: Number(options.initialRoomD) || 4.8,
    roomH: Number(options.initialRoomH) || 2.75,
    wardrobeW: Number(options.initialWardrobeW) || 1.85,
    wardrobeD: Number(options.initialWardrobeD) || 0.62,
    wardrobeH: Number(options.initialWardrobeH) || 2.15,
    deskW: Number(options.initialDeskW) || 1.28,
    deskD: Number(options.initialDeskD) || 0.62,
    deskH: Number(options.initialDeskH) || 0.78,
    offWardrobe: { x: 0, z: 0 },
    offDesk: { x: 0, z: 0 },
    offProduct: { x: 0, z: 0 },
    rotWardrobe: 0,
    rotDesk: 0,
    rotProduct: 0,
    extras: [],
    cameraMode: 'orbit',
    walkHeight: 1.62,
    windowStyle: 'casement',
    wardrobeStyle: 'slab',
    deskStyle: 'minimal',
    climate: 'clear',
    graphicsQuality: 'balanced',
    wardrobeFinish: 'neutral'
  };

  let extraIdSeq = 1;

  const W = () => Math.max(2.5, Math.min(12, state.roomW));
  const D = () => Math.max(2.5, Math.min(12, state.roomD));
  const H = () => Math.max(2.2, Math.min(3.5, state.roomH));

  const woodTex = makeWoodCanvasTexture();
  const pvcTex = makePvcCanvasTexture();

  const floorWoodMat = new THREE.MeshStandardMaterial({
    map: woodTex,
    color: 0xffffff,
    roughness: 0.64,
    metalness: 0,
    envMapIntensity: 0.45
  });
  const floorPvcMat = new THREE.MeshStandardMaterial({
    map: pvcTex,
    color: 0xffffff,
    roughness: 0.24,
    metalness: 0.11,
    envMapIntensity: 0.52
  });

  const wallLowMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.38
  });
  const wallUpMat = new THREE.MeshStandardMaterial({
    color: 0xd5dde6,
    roughness: 0.86,
    metalness: 0,
    envMapIntensity: 0.36
  });
  const ceilMat = wallLowMat;

  const woodFrameMat = new THREE.MeshStandardMaterial({ color: 0x5a3d2e, roughness: 0.84, metalness: 0.02 });
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.76, metalness: 0.02 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x5a7dae,
    roughness: 0.2,
    metalness: 0.32,
    transparent: true,
    opacity: 0.58
  });
  const curtainMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.94,
    metalness: 0,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide
  });
  const furnitureMat = new THREE.MeshStandardMaterial({
    color: 0x8b939b,
    roughness: 0.52,
    metalness: 0.09,
    envMapIntensity: 0.55
  });

  const sharedRoomMaterials = new Set([
    floorWoodMat,
    floorPvcMat,
    wallLowMat,
    wallUpMat,
    woodFrameMat,
    doorMat,
    glassMat,
    curtainMat,
    furnitureMat
  ]);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe4eaf1);
  scene.fog = new THREE.Fog(0xe4eaf1, 7, 28);

  const roomGroup = new THREE.Group();
  scene.add(roomGroup);

  let wardrobeMesh = null;
  let deskGroup = null;
  const extraMeshes = new Map();

  function clampToRoom(x, z, margin) {
    const w = W();
    const d = D();
    const m = margin || 0.35;
    return {
      x: THREE.MathUtils.clamp(x, -w / 2 + m, w / 2 - m),
      z: THREE.MathUtils.clamp(z, -d / 2 + m, d / 2 - m)
    };
  }

  /** Mantém o centro (x,z) dentro da sala respeitando meia-largura do objeto em X e Z (evita atravessar parede). */
  function clampCenterInRoom(cx, cz, halfX, halfZ) {
    const w = W();
    const d = D();
    const clearance = 0.08;
    const hx = Math.max(0.05, halfX);
    const hz = Math.max(0.05, halfZ);
    return {
      x: THREE.MathUtils.clamp(cx, -w / 2 + hx + clearance, w / 2 - hx - clearance),
      z: THREE.MathUtils.clamp(cz, -d / 2 + hz + clearance, d / 2 - hz - clearance)
    };
  }

  /** Recoloca o objeto se o AABB em XZ ultrapassar a parede (importante com rotação). */
  function nudgeMovableByFootprint(obj, syncState) {
    obj.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(obj);
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    b.getCenter(c);
    b.getSize(s);
    const pad = 0.1;
    const cl = clampCenterInRoom(c.x, c.z, s.x / 2 + pad, s.z / 2 + pad);
    const dx = cl.x - c.x;
    const dz = cl.z - c.z;
    if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) return;
    obj.position.x += dx;
    obj.position.z += dz;
    if (typeof syncState === 'function') syncState();
  }

  function clearRoomGeometry() {
    wardrobeMesh = null;
    deskGroup = null;
    extraMeshes.clear();
    while (roomGroup.children.length) {
      const o = roomGroup.children.pop();
      o.traverse(function (x) {
        if (x.geometry) x.geometry.dispose();
        if (x.material) {
          const mats = Array.isArray(x.material) ? x.material : [x.material];
          mats.forEach(function (m) {
            if (sharedRoomMaterials.has(m)) return;
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    }
  }

  function rebuildRoom() {
    clearRoomGeometry();
    const w = W();
    const d = D();
    const h = H();

    woodTex.repeat.set(w * 0.52, d * 0.52);
    pvcTex.repeat.set(w * 1.15, d * 1.15);
    woodTex.needsUpdate = true;
    pvcTex.needsUpdate = true;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), state.floor === 'pvc' ? floorPvcMat : floorWoodMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    roomGroup.add(floor);

    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h + 0.002;
    ceil.receiveShadow = true;
    roomGroup.add(ceil);

    function splitWall(planeW, planeH, cx, cz, rotY) {
      const g1 = new THREE.PlaneGeometry(planeW, planeH / 2);
      const g2 = new THREE.PlaneGeometry(planeW, planeH / 2);
      const lo = new THREE.Mesh(g1, wallLowMat);
      const hi = new THREE.Mesh(g2, wallUpMat);
      lo.position.set(cx, planeH / 4, cz);
      hi.position.set(cx, (planeH * 3) / 4, cz);
      lo.rotation.y = hi.rotation.y = rotY;
      lo.receiveShadow = hi.receiveShadow = true;
      roomGroup.add(lo, hi);
    }

    const eps = 0.014;
    splitWall(w, h, 0, -d / 2 + eps, 0);
    splitWall(w, h, 0, d / 2 - eps, Math.PI);
    splitWall(d, h, -w / 2 + eps, 0, Math.PI / 2);
    splitWall(d, h, w / 2 - eps, 0, -Math.PI / 2);

    addWindowToRoom(roomGroup, w, d, h, eps, { woodFrameMat: woodFrameMat, glassMat: glassMat, curtainMat: curtainMat }, state.windowStyle);

    const doorH = 2.1;
    const doorW = 0.9;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, doorH, doorW), doorMat);
    door.position.set(-w / 2 + 0.045, doorH / 2, 0.35);
    door.castShadow = door.receiveShadow = true;
    roomGroup.add(door);

    const ww = Math.max(0.85, Math.min(3.2, state.wardrobeW));
    const wd = Math.max(0.45, Math.min(1.15, state.wardrobeD));
    const wh = Math.max(1.45, Math.min(2.65, state.wardrobeH));
    const wBodyMat = furnitureMat.clone();
    wBodyMat.color.setHex(WARDROBE_FINISH[state.wardrobeFinish] || WARDROBE_FINISH.neutral);
    wardrobeMesh = buildWardrobeGroup(state.wardrobeStyle, ww, wh, wd, wBodyMat);
    const wx = w / 2 - ww / 2 - 0.1 + state.offWardrobe.x;
    const wz = -d / 2 + wd / 2 + 0.1 + state.offWardrobe.z;
    const cw = clampCenterInRoom(wx, wz, ww / 2 + 0.06, wd / 2 + 0.06);
    state.offWardrobe.x += cw.x - wx;
    state.offWardrobe.z += cw.z - wz;
    wardrobeMesh.position.set(cw.x, 0, cw.z);
    wardrobeMesh.rotation.y = state.rotWardrobe || 0;
    wardrobeMesh.userData.movableId = 'wardrobe';
    wardrobeMesh.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
      }
    });
    roomGroup.add(wardrobeMesh);
    nudgeMovableByFootprint(wardrobeMesh, function () {
      const www = Math.max(0.85, Math.min(3.2, state.wardrobeW));
      const wdd = Math.max(0.45, Math.min(1.15, state.wardrobeD));
      state.offWardrobe.x = wardrobeMesh.position.x - (w / 2 - www / 2 - 0.1);
      state.offWardrobe.z = wardrobeMesh.position.z - (-d / 2 + wdd / 2 + 0.1);
    });

    const dw = Math.max(0.75, Math.min(2.3, state.deskW));
    const dd = Math.max(0.45, Math.min(1.05, state.deskD));
    const dh = Math.max(0.66, Math.min(1.08, state.deskH));
    deskGroup = buildDeskGroup(state.deskStyle, dw, dh, dd, furnitureMat);
    deskGroup.userData.movableId = 'desk';
    const dx = -w / 2 + dw / 2 + 0.32 + state.offDesk.x;
    const dz = d / 2 - dd / 2 - 0.18 + state.offDesk.z;
    const cd = clampCenterInRoom(dx, dz, dw / 2 + 0.06, dd / 2 + 0.06);
    state.offDesk.x += cd.x - dx;
    state.offDesk.z += cd.z - dz;
    deskGroup.position.set(cd.x, 0, cd.z);
    deskGroup.rotation.y = state.rotDesk || 0;
    deskGroup.traverse(function (o) {
      if (o.isMesh) {
        o.castShadow = o.receiveShadow = true;
      }
    });
    roomGroup.add(deskGroup);
    nudgeMovableByFootprint(deskGroup, function () {
      const dww = Math.max(0.75, Math.min(2.3, state.deskW));
      const ddd = Math.max(0.45, Math.min(1.05, state.deskD));
      state.offDesk.x = deskGroup.position.x - (-w / 2 + dww / 2 + 0.32);
      state.offDesk.z = deskGroup.position.z - (d / 2 - ddd / 2 - 0.18);
    });

    state.extras.forEach(function (ex) {
      const pr = EXTRA_PRESETS[ex.kind] || EXTRA_PRESETS.criado;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(pr.w, pr.h, pr.d), furnitureMat);
      mesh.userData.movableId = 'extra:' + ex.id;
      mesh.userData.extraId = ex.id;
      mesh.castShadow = mesh.receiveShadow = true;
      const cx = ex.x != null ? ex.x : 0;
      const cz = ex.z != null ? ex.z : d / 2 - pr.d;
      const c = clampCenterInRoom(cx, cz, pr.w / 2 + 0.06, pr.d / 2 + 0.06);
      ex.x = c.x;
      ex.z = c.z;
      mesh.position.set(ex.x, pr.h / 2, ex.z);
      mesh.rotation.y = ex.rotY || 0;
      roomGroup.add(mesh);
      extraMeshes.set(ex.id, mesh);
      nudgeMovableByFootprint(mesh, function () {
        ex.x = mesh.position.x;
        ex.z = mesh.position.z;
      });
    });

    dir.shadow.camera.far = Math.max(W(), D()) * 5;
    dir.shadow.camera.left = -W() * 1.15;
    dir.shadow.camera.right = W() * 1.15;
    dir.shadow.camera.top = H() * 1.25;
    dir.shadow.camera.updateProjectionMatrix();
  }

  const camera = new THREE.PerspectiveCamera(40, 1, 0.06, 90);
  camera.position.set(W() * 0.52, H() * 0.5, D() * 0.58);

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0xe4eaf1, 1);
  hostEl.innerHTML = '';
  hostEl.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  canvas.style.borderRadius = 'inherit';
  canvas.style.touchAction = 'none';

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.target.set(0, H() * 0.36, 0);
  controls.minDistance = 1.55;
  controls.maxDistance = Math.max(W(), D()) * 1.32;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minPolarAngle = 0.16;
  controls.update();

  const hemi = new THREE.HemisphereLight(0xdce6f4, 0xb8c5d4, 0.52);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.12);
  dir.position.set(W() * 0.38, H() * 0.92, D() * 0.42);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.camera.near = 0.4;
  dir.shadow.camera.far = Math.max(W(), D()) * 5;
  dir.shadow.camera.left = -W() * 1.15;
  dir.shadow.camera.right = W() * 1.15;
  dir.shadow.camera.top = H() * 1.25;
  dir.shadow.camera.bottom = -1.5;
  dir.shadow.bias = -0.00006;
  dir.shadow.normalBias = 0.042;
  dir.shadow.radius = 1.85;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xf0f6ff, 0.32);
  fill.position.set(-W() * 0.6, H() * 0.45, -D() * 0.15);
  scene.add(fill);

  const windowLight = new THREE.DirectionalLight(0xfff6e8, 0.5);
  windowLight.castShadow = false;
  scene.add(windowLight);
  scene.add(windowLight.target);

  function applyClimate() {
    const key = CLIMATE_PRESETS[state.climate] ? state.climate : 'clear';
    const P = CLIMATE_PRESETS[key];
    scene.background.setHex(P.bg);
    scene.fog.color.setHex(P.fogCol);
    scene.fog.near = P.fogNear;
    scene.fog.far = Math.max(P.fogFar, Math.max(W(), D()) * 1.9);
    hemi.color.setHex(P.hemiSky);
    hemi.groundColor.setHex(P.hemiGr);
    hemi.intensity = P.hemiI;
    dir.color.setHex(P.dirCol);
    dir.intensity = P.dirI;
    fill.color.setHex(P.fillCol);
    fill.intensity = P.fillI;
    renderer.toneMappingExposure = P.exposure;
    renderer.setClearColor(P.bg, 1);
    if (windowLight) {
      windowLight.color.setHex(P.winWarm != null ? P.winWarm : 0xfff4e0);
      let gmul = 1;
      const gq = state.graphicsQuality || 'balanced';
      if (gq === 'fast') gmul = 0.62;
      else if (gq === 'balanced') gmul = 0.88;
      else if (gq === 'high') gmul = 1;
      else if (gq === 'ultra') gmul = 1.05;
      else if (gq === 'max') gmul = 1.08;
      const bi = (P.winFill != null ? P.winFill : 0.45) * gmul;
      windowLight.userData.baseI = bi;
      windowLight.intensity = bi;
    }
  }

  function applyGraphics() {
    const q = state.graphicsQuality || 'balanced';
    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1024;
    const desk = viewW >= 900;
    const maxTex = renderer.capabilities.maxTextureSize || 4096;
    const maxAniso = Math.max(1, Math.min(16, renderer.capabilities.getMaxAnisotropy()));
    let sm = 2048;
    let pr = Math.min(window.devicePixelRatio || 1, 2);
    let aniso = 12;
    let shadowRadius = 1.72;
    if (q === 'max') {
      sm = desk && maxTex >= 8192 ? 8192 : 4096;
      pr = Math.min(window.devicePixelRatio || 1, desk ? 3 : 2.55);
      aniso = maxAniso;
      shadowRadius = desk ? 3.05 : 2.72;
    } else if (q === 'ultra') {
      sm = 4096;
      pr = Math.min(window.devicePixelRatio || 1, desk ? 2.88 : 2.45);
      aniso = maxAniso;
      shadowRadius = desk ? 2.88 : 2.48;
    } else if (q === 'high') {
      sm = 4096;
      pr = Math.min(window.devicePixelRatio || 1, desk ? 2.48 : 2.12);
      aniso = maxAniso;
      shadowRadius = 2.45;
    } else if (q === 'fast') {
      sm = 1024;
      pr = Math.min(window.devicePixelRatio || 1, 1.2);
      aniso = 4;
      shadowRadius = 0.9;
    }
    dir.shadow.mapSize.set(sm, sm);
    dir.shadow.radius = shadowRadius;
    if (dir.shadow.map) dir.shadow.map.dispose();
    renderer.setPixelRatio(pr);
    woodTex.anisotropy = Math.min(aniso, maxAniso);
    pvcTex.anisotropy = Math.min(aniso, maxAniso);
    woodTex.needsUpdate = true;
    pvcTex.needsUpdate = true;
  }

  rebuildRoom();
  applyClimate();
  applyGraphics();

  const productGroup = new THREE.Group();
  productGroup.userData.movableId = 'product';
  scene.add(productGroup);

  let productRoot = null;
  const loader = new GLTFLoader();
  loader.load(
    glbUrl,
    function (gltf) {
      if (productRoot) {
        productGroup.remove(productRoot);
        productRoot.traverse(function (o) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) {
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            mats.forEach(function (m) {
              if (m.map) m.map.dispose();
              m.dispose();
            });
          }
        });
      }
      productRoot = gltf.scene;
      const box = new THREE.Box3().setFromObject(productRoot);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxXZ = Math.max(size.x, size.z, 0.001);
      const target = Math.min(1.88, W() * 0.4);
      const s = target / maxXZ;
      productRoot.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(productRoot);
      productRoot.position.set(0, -box2.min.y + 0.018, 0);
      productRoot.traverse(function (o) {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material && !Array.isArray(o.material)) {
            const m = o.material;
            if (m.envMapIntensity !== undefined) m.envMapIntensity = (m.envMapIntensity || 1) * 0.88;
            if (m.roughness !== undefined) m.roughness = Math.min(1, m.roughness * 0.9 + 0.03);
          }
        }
      });
      productGroup.add(productRoot);
      productGroup.rotation.y = state.rotProduct || 0;
      productGroup.position.set(state.offProduct.x, 0, state.offProduct.z);
      constrainProductToRoom();
      resolveProductVsFurniture();
    },
    undefined,
    function () {
      onError();
    }
  );

  const clock = new THREE.Clock();
  const keys = { KeyW: false, KeyS: false, KeyA: false, KeyD: false, ShiftLeft: false, ShiftRight: false };
  let yaw = 0;
  let pitch = 0;
  let walkPhase = 0;
  let pointerLocked = false;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPt = new THREE.Vector3();

  function syncCameraMode() {
    const walk = state.cameraMode === 'walk';
    controls.enabled = !walk;
    if (!walk) {
      try {
        document.exitPointerLock();
      } catch (_) { /* ignore */ }
      pointerLocked = false;
    }
  }

  function onKeyDown(e) {
    if (keys.hasOwnProperty(e.code)) keys[e.code] = true;
  }
  function onKeyUp(e) {
    if (keys.hasOwnProperty(e.code)) keys[e.code] = false;
  }
  function onPointerLockChange() {
    pointerLocked = document.pointerLockElement === canvas;
    if (!pointerLocked && state.cameraMode === 'walk') {
      /* stay in walk mode, user can click again */
    }
  }
  function onMouseMove(e) {
    if (!pointerLocked || state.cameraMode !== 'walk') return;
    const sens = 0.0022;
    yaw -= e.movementX * sens;
    pitch -= e.movementY * sens;
    pitch = THREE.MathUtils.clamp(pitch, -1.15, 1.15);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  canvas.addEventListener('mousemove', onMouseMove);

  canvas.addEventListener('click', function () {
    if (state.cameraMode === 'walk' && document.pointerLockElement !== canvas) {
      canvas.requestPointerLock();
    }
  });

  function getMovables() {
    const list = [];
    if (productRoot) list.push(productGroup);
    if (wardrobeMesh) list.push(wardrobeMesh);
    if (deskGroup) list.push(deskGroup);
    extraMeshes.forEach(function (m) {
      list.push(m);
    });
    return list;
  }

  function pickMovable(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(getMovables(), true);
    for (let i = 0; i < hits.length; i++) {
      let o = hits[i].object;
      while (o && !o.userData.movableId) o = o.parent;
      if (o && o.userData.movableId) return { obj: o, hit: hits[i] };
    }
    return null;
  }

  function screenToFloor(clientX, clientY, targetY) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    floorPlane.constant = -targetY;
    if (raycaster.ray.intersectPlane(floorPlane, hitPt)) return hitPt.clone();
    return null;
  }

  function footprintForObject(obj) {
    if (obj === wardrobeMesh && wardrobeMesh) {
      wardrobeMesh.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(wardrobeMesh);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      const pad = 0.1;
      return { x: c.x, z: c.z, hx: s.x / 2 + pad, hz: s.z / 2 + pad };
    }
    if (obj === deskGroup && deskGroup) {
      deskGroup.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(deskGroup);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      const pad = 0.1;
      return { x: c.x, z: c.z, hx: s.x / 2 + pad, hz: s.z / 2 + pad };
    }
    if (obj === productGroup && productRoot) {
      productGroup.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(productGroup);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      const pad = 0.12;
      return { x: c.x, z: c.z, hx: s.x / 2 + pad, hz: s.z / 2 + pad };
    }
    if (obj.userData && obj.userData.extraId) {
      obj.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(obj);
      const c = new THREE.Vector3();
      const s = new THREE.Vector3();
      b.getCenter(c);
      b.getSize(s);
      const pad = 0.1;
      return { x: c.x, z: c.z, hx: s.x / 2 + pad, hz: s.z / 2 + pad };
    }
    return null;
  }

  function overlapsFootprint(a, b) {
    return Math.abs(a.x - b.x) < a.hx + b.hx && Math.abs(a.z - b.z) < a.hz + b.hz;
  }

  function separateFromOthers(movingObj, px, pz) {
    const self = footprintForObject(movingObj);
    if (!self) return { x: px, z: pz };
    const cl0 = clampCenterInRoom(px, pz, self.hx, self.hz);
    self.x = cl0.x;
    self.z = cl0.z;
    const others = getMovables().filter(function (m) {
      return m !== movingObj;
    });
    for (let iter = 0; iter < 10; iter++) {
      let changed = false;
      for (let i = 0; i < others.length; i++) {
        const fo = footprintForObject(others[i]);
        if (!fo) continue;
        if (overlapsFootprint(self, fo)) {
          const dx = self.x - fo.x;
          const dz = self.z - fo.z;
          const len = Math.sqrt(dx * dx + dz * dz) || 1;
          const push = 0.14;
          self.x += (dx / len) * push;
          self.z += (dz / len) * push;
          changed = true;
        }
      }
      const c2 = clampCenterInRoom(self.x, self.z, self.hx, self.hz);
      self.x = c2.x;
      self.z = c2.z;
      if (!changed) break;
    }
    return { x: self.x, z: self.z };
  }

  function constrainProductToRoom() {
    if (!productRoot) return;
    const fp = footprintForObject(productGroup);
    if (!fp) return;
    const c = clampCenterInRoom(productGroup.position.x, productGroup.position.z, fp.hx, fp.hz);
    state.offProduct.x = c.x;
    state.offProduct.z = c.z;
    productGroup.position.set(c.x, 0, c.z);
  }

  function resolveProductVsFurniture() {
    if (!productRoot) return;
    for (let i = 0; i < 12; i++) {
      const sep = separateFromOthers(productGroup, state.offProduct.x, state.offProduct.z);
      state.offProduct.x = sep.x;
      state.offProduct.z = sep.z;
      productGroup.position.set(sep.x, 0, sep.z);
    }
  }

  function applySyncAfterSeparate(obj, sep) {
    const sx = sep.x;
    const sz = sep.z;
    if (obj === wardrobeMesh) {
      const ww = Math.max(0.85, Math.min(3.2, state.wardrobeW));
      const wd = Math.max(0.45, Math.min(1.15, state.wardrobeD));
      state.offWardrobe.x = sx - (W() / 2 - ww / 2 - 0.1);
      state.offWardrobe.z = sz - (-D() / 2 + wd / 2 + 0.1);
      obj.position.set(sx, 0, sz);
    } else if (obj === deskGroup) {
      const dw = Math.max(0.75, Math.min(2.3, state.deskW));
      const dd = Math.max(0.45, Math.min(1.05, state.deskD));
      state.offDesk.x = sx - (-W() / 2 + dw / 2 + 0.32);
      state.offDesk.z = sz - (D() / 2 - dd / 2 - 0.18);
      obj.position.set(sx, 0, sz);
    } else if (obj === productGroup) {
      state.offProduct.x = sx;
      state.offProduct.z = sz;
      obj.position.set(sx, 0, sz);
    } else if (obj.userData && obj.userData.extraId) {
      const ex = state.extras.find(function (x) {
        return x.id === obj.userData.extraId;
      });
      if (ex) {
        ex.x = sx;
        ex.z = sz;
        obj.position.x = sx;
        obj.position.z = sz;
      }
    }
  }

  let drag = null;
  canvas.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });
  canvas.addEventListener('mousedown', function (e) {
    if (state.cameraMode === 'walk') return;
    const wantRotate = e.button === 2 || (e.button === 0 && (e.shiftKey || e.altKey));
    if (e.button !== 0 && !wantRotate) return;
    const pick = pickMovable(e.clientX, e.clientY);
    if (!pick) return;
    e.preventDefault();
    const obj = pick.obj;
    if (wantRotate) {
      drag = { mode: 'rotate', obj: obj, lastX: e.clientX };
    } else {
      let baseY = obj.position.y;
      if (obj === deskGroup || obj === wardrobeMesh || obj === productGroup) baseY = 0;
      drag = { mode: 'move', obj: obj, baseY: baseY };
    }
    controls.enabled = false;
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    if (drag.mode === 'rotate') {
      const sens = 0.0068;
      const dx = e.clientX - drag.lastX;
      drag.lastX = e.clientX;
      const da = dx * sens;
      if (drag.obj === wardrobeMesh) {
        state.rotWardrobe = (state.rotWardrobe || 0) + da;
        drag.obj.rotation.y = state.rotWardrobe;
      } else if (drag.obj === deskGroup) {
        state.rotDesk = (state.rotDesk || 0) + da;
        drag.obj.rotation.y = state.rotDesk;
      } else if (drag.obj === productGroup) {
        state.rotProduct = (state.rotProduct || 0) + da;
        drag.obj.rotation.y = state.rotProduct;
      } else if (drag.obj.userData && drag.obj.userData.extraId) {
        const ex = state.extras.find(function (x) {
          return x.id === drag.obj.userData.extraId;
        });
        if (ex) {
          ex.rotY = (ex.rotY || 0) + da;
          drag.obj.rotation.y = ex.rotY;
        }
      }
      const sepR = separateFromOthers(drag.obj, drag.obj.position.x, drag.obj.position.z);
      applySyncAfterSeparate(drag.obj, sepR);
      return;
    }
    const yPlane = drag.obj === deskGroup || drag.obj === wardrobeMesh || drag.obj === productGroup ? 0.01 : drag.baseY;
    const p = screenToFloor(e.clientX, e.clientY, yPlane);
    if (!p) return;
    const fp0 = footprintForObject(drag.obj);
    let cx = p.x;
    let cz = p.z;
    if (fp0) {
      const cl = clampCenterInRoom(p.x, p.z, fp0.hx, fp0.hz);
      cx = cl.x;
      cz = cl.z;
    }
    if (drag.obj === wardrobeMesh) {
      const sep = separateFromOthers(drag.obj, cx, cz);
      applySyncAfterSeparate(drag.obj, sep);
    } else if (drag.obj === deskGroup) {
      const sepD = separateFromOthers(drag.obj, cx, cz);
      applySyncAfterSeparate(drag.obj, sepD);
    } else if (drag.obj === productGroup) {
      const sepP = separateFromOthers(drag.obj, cx, cz);
      applySyncAfterSeparate(drag.obj, sepP);
    } else if (drag.obj.userData.extraId) {
      const id = drag.obj.userData.extraId;
      const ex = state.extras.find(function (x) {
        return x.id === id;
      });
      if (ex) {
        const sepE = separateFromOthers(drag.obj, cx, cz);
        applySyncAfterSeparate(drag.obj, sepE);
      }
    }
  });

  window.addEventListener('mouseup', function () {
    if (drag) {
      drag = null;
      if (state.cameraMode === 'orbit') controls.enabled = true;
    }
  });

  function resize() {
    const rect = hostEl.getBoundingClientRect();
    const wpx = Math.max(2, rect.width);
    const hpx = Math.max(2, rect.height);
    camera.aspect = wpx / hpx;
    camera.updateProjectionMatrix();
    renderer.setSize(wpx, hpx, false);
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(hostEl);

  let rafId = 0;
  function tick() {
    rafId = requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (state.cameraMode === 'walk' && pointerLocked) {
      const speed = (keys.ShiftLeft || keys.ShiftRight ? 4.2 : 2.4) * dt;
      const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const move = new THREE.Vector3();
      if (keys.KeyW) move.add(forward);
      if (keys.KeyS) move.sub(forward);
      if (keys.KeyD) move.add(right);
      if (keys.KeyA) move.sub(right);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed);
        camera.position.add(move);
        walkPhase += dt * 9.2;
      } else {
        walkPhase *= 0.88;
      }
      camera.position.y = state.walkHeight + Math.sin(walkPhase) * 0.022;
      const c = clampToRoom(camera.position.x, camera.position.z, 0.62);
      camera.position.x = c.x;
      camera.position.z = c.z;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    } else {
      controls.update();
    }

    dir.position.set(W() * 0.38, H() * 0.92, D() * 0.42);
    if (windowLight) {
      const hv = H();
      const dv = D();
      windowLight.position.set(0, hv * 0.58, -dv / 2 - 2.6);
      windowLight.target.position.set(0, hv * 0.24, dv * 0.14);
      if (windowLight.userData.baseI != null) {
        const tw = Math.sin(clock.getElapsedTime() * 1.05);
        windowLight.intensity = windowLight.userData.baseI * (1 + tw * 0.045);
      }
    }
    renderer.render(scene, camera);
  }
  tick();

  let debounceT = 0;
  function scheduleRebuild() {
    clearTimeout(debounceT);
    debounceT = setTimeout(function () {
      rebuildRoom();
      applyClimate();
      constrainProductToRoom();
      resolveProductVsFurniture();
      controls.target.set(0, H() * 0.36, 0);
      controls.maxDistance = Math.max(W(), D()) * 1.32;
      controls.update();
      syncCameraMode();
    }, 110);
  }

  return {
    state: state,
    setFloor: function (v) {
      state.floor = v === 'pvc' ? 'pvc' : 'wood';
      scheduleRebuild();
    },
    setRoom: function (rw, rd, rh) {
      if (rw != null) state.roomW = rw;
      if (rd != null) state.roomD = rd;
      if (rh != null) state.roomH = rh;
      scheduleRebuild();
    },
    setWardrobe: function (w, d, h) {
      if (w != null) state.wardrobeW = w;
      if (d != null) state.wardrobeD = d;
      if (h != null) state.wardrobeH = h;
      scheduleRebuild();
    },
    setDesk: function (w, d, h) {
      if (w != null) state.deskW = w;
      if (d != null) state.deskD = d;
      if (h != null) state.deskH = h;
      scheduleRebuild();
    },
    setWindowStyle: function (v) {
      const ok = ['casement', 'french', 'picture'].indexOf(v) >= 0 ? v : 'casement';
      state.windowStyle = ok;
      scheduleRebuild();
    },
    setWardrobeStyle: function (v) {
      const ok = ['slab', 'panel', 'mirror'].indexOf(v) >= 0 ? v : 'slab';
      state.wardrobeStyle = ok;
      scheduleRebuild();
    },
    setWardrobeFinish: function (v) {
      const ok = v in WARDROBE_FINISH ? v : 'neutral';
      state.wardrobeFinish = ok;
      scheduleRebuild();
    },
    setDeskStyle: function (v) {
      const ok = ['minimal', 'drawer', 'float'].indexOf(v) >= 0 ? v : 'minimal';
      state.deskStyle = ok;
      scheduleRebuild();
    },
    setClimate: function (v) {
      state.climate = CLIMATE_PRESETS[v] ? v : 'clear';
      applyClimate();
    },
    setGraphicsQuality: function (v) {
      const ok = ['max', 'ultra', 'high', 'fast'].indexOf(v) >= 0 ? v : 'balanced';
      state.graphicsQuality = ok;
      applyGraphics();
      applyClimate();
    },
    setCameraMode: function (mode) {
      state.cameraMode = mode === 'walk' ? 'walk' : 'orbit';
      try {
        document.exitPointerLock();
      } catch (_) { /* ignore */ }
      pointerLocked = false;
      syncCameraMode();
      if (state.cameraMode === 'orbit') {
        camera.rotation.order = 'XYZ';
        camera.rotation.set(0, 0, 0);
        yaw = 0;
        pitch = 0;
        camera.position.set(W() * 0.52, H() * 0.5, D() * 0.58);
        controls.target.set(0, H() * 0.36, 0);
        if (typeof controls.reset === 'function') controls.reset();
        controls.update();
      }
    },
    addExtra: function (kind) {
      const k = EXTRA_PRESETS[kind] ? kind : 'criado';
      const id = extraIdSeq++;
      const pr = EXTRA_PRESETS[k];
      state.extras.push({
        id: id,
        kind: k,
        x: 0,
        z: D() / 2 - pr.d * 0.7,
        rotY: 0
      });
      scheduleRebuild();
      return id;
    },
    removeExtra: function (id) {
      state.extras = state.extras.filter(function (x) {
        return x.id !== id;
      });
      scheduleRebuild();
    },
    dispose: function () {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      clearRoomGeometry();
      scene.remove(windowLight.target);
      scene.remove(windowLight);
      windowLight.dispose();
      controls.dispose();
      renderer.dispose();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      canvas.removeEventListener('mousemove', onMouseMove);
      if (hostEl.contains(canvas)) hostEl.removeChild(canvas);
      woodTex.dispose();
      pvcTex.dispose();
      floorWoodMat.dispose();
      floorPvcMat.dispose();
      wallLowMat.dispose();
      wallUpMat.dispose();
      woodFrameMat.dispose();
      doorMat.dispose();
      glassMat.dispose();
      curtainMat.dispose();
      furnitureMat.dispose();
    }
  };
}
