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
  c.width = 512;
  c.height = 512;
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
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e6ebf2';
  g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 5000; i++) {
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
    extras: [],
    cameraMode: 'orbit',
    walkHeight: 1.62
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

  function clearRoomGeometry() {
    wardrobeMesh = null;
    deskGroup = null;
    extraMeshes.clear();
    while (roomGroup.children.length) {
      const o = roomGroup.children.pop();
      o.traverse(function (x) {
        if (x.geometry) x.geometry.dispose();
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

    const winW = 1.28;
    const winH = 1.06;
    const sill = 0.92;
    const frameT = 0.055;
    const zBack = -d / 2 + eps * 2;

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(winW + frameT * 2, frameT, frameT * 1.15), woodFrameMat);
    topBar.position.set(0, sill + winH + frameT / 2, zBack);
    topBar.castShadow = true;
    const sillBar = new THREE.Mesh(new THREE.BoxGeometry(winW + frameT * 2, frameT * 0.85, frameT * 1.15), woodFrameMat);
    sillBar.position.set(0, sill - frameT / 2, zBack);
    sillBar.castShadow = true;
    roomGroup.add(topBar, sillBar);

    const sideGeo = new THREE.BoxGeometry(frameT, winH, frameT * 1.15);
    const sideL = new THREE.Mesh(sideGeo, woodFrameMat);
    sideL.position.set(-winW / 2 - frameT / 2, sill + winH / 2, zBack);
    sideL.castShadow = true;
    const sideR = new THREE.Mesh(sideGeo, woodFrameMat);
    sideR.position.set(winW / 2 + frameT / 2, sill + winH / 2, zBack);
    sideR.castShadow = true;
    roomGroup.add(sideL, sideR);

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW * 0.9, winH * 0.86), glassMat);
    glass.position.set(0, sill + winH / 2, zBack + 0.022);
    roomGroup.add(glass);

    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.52, winH * 1.06), curtainMat);
    curtain.position.set(winW / 2 + 0.3, sill + winH / 2, zBack + 0.038);
    curtain.rotation.y = -0.22;
    curtain.castShadow = true;
    roomGroup.add(curtain);

    const doorH = 2.1;
    const doorW = 0.9;
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, doorH, doorW), doorMat);
    door.position.set(-w / 2 + 0.045, doorH / 2, 0.35);
    door.castShadow = door.receiveShadow = true;
    roomGroup.add(door);

    const ww = Math.max(0.85, Math.min(3.2, state.wardrobeW));
    const wd = Math.max(0.45, Math.min(1.15, state.wardrobeD));
    const wh = Math.max(1.45, Math.min(2.65, state.wardrobeH));
    wardrobeMesh = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, wd), furnitureMat);
    const wx = w / 2 - ww / 2 - 0.1 + state.offWardrobe.x;
    const wz = -d / 2 + wd / 2 + 0.1 + state.offWardrobe.z;
    const cw = clampToRoom(wx, wz, Math.max(ww, wd) * 0.55);
    state.offWardrobe.x += cw.x - wx;
    state.offWardrobe.z += cw.z - wz;
    wardrobeMesh.position.set(cw.x, wh / 2, cw.z);
    wardrobeMesh.userData.movableId = 'wardrobe';
    wardrobeMesh.castShadow = wardrobeMesh.receiveShadow = true;
    roomGroup.add(wardrobeMesh);

    const dw = Math.max(0.75, Math.min(2.3, state.deskW));
    const dd = Math.max(0.45, Math.min(1.05, state.deskD));
    const dh = Math.max(0.66, Math.min(1.08, state.deskH));
    deskGroup = new THREE.Group();
    deskGroup.userData.movableId = 'desk';
    const deskTop = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.045, dd), furnitureMat);
    deskTop.position.set(0, dh - 0.022, 0);
    deskTop.castShadow = deskTop.receiveShadow = true;
    const legGeo = new THREE.BoxGeometry(0.055, dh - 0.05, Math.max(0.2, dd - 0.14));
    const leg1 = new THREE.Mesh(legGeo, furnitureMat);
    leg1.position.set(-dw / 2 + 0.11, (dh - 0.05) / 2, 0);
    const leg2 = new THREE.Mesh(legGeo, furnitureMat);
    leg2.position.set(dw / 2 - 0.11, (dh - 0.05) / 2, 0);
    leg1.castShadow = leg2.castShadow = true;
    deskGroup.add(deskTop, leg1, leg2);
    const dx = -w / 2 + dw / 2 + 0.32 + state.offDesk.x;
    const dz = d / 2 - dd / 2 - 0.18 + state.offDesk.z;
    const cd = clampToRoom(dx, dz, Math.max(dw, dd) * 0.55);
    state.offDesk.x += cd.x - dx;
    state.offDesk.z += cd.z - dz;
    deskGroup.position.set(cd.x, 0, cd.z);
    deskGroup.castShadow = true;
    roomGroup.add(deskGroup);

    state.extras.forEach(function (ex) {
      const pr = EXTRA_PRESETS[ex.kind] || EXTRA_PRESETS.criado;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(pr.w, pr.h, pr.d), furnitureMat);
      mesh.userData.movableId = 'extra:' + ex.id;
      mesh.userData.extraId = ex.id;
      mesh.castShadow = mesh.receiveShadow = true;
      const cx = ex.x != null ? ex.x : 0;
      const cz = ex.z != null ? ex.z : d / 2 - pr.d;
      const c = clampToRoom(cx, cz, Math.max(pr.w, pr.d) * 0.55);
      ex.x = c.x;
      ex.z = c.z;
      mesh.position.set(ex.x, pr.h / 2, ex.z);
      roomGroup.add(mesh);
      extraMeshes.set(ex.id, mesh);
    });

    scene.fog.far = Math.max(20, Math.max(w, d) * 2.4);
  }

  rebuildRoom();

  const camera = new THREE.PerspectiveCamera(40, 1, 0.06, 90);
  camera.position.set(W() * 0.52, H() * 0.5, D() * 0.58);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
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
  dir.shadow.bias = -0.00012;
  scene.add(dir);
  const fill = new THREE.DirectionalLight(0xf0f6ff, 0.32);
  fill.position.set(-W() * 0.6, H() * 0.45, -D() * 0.15);
  scene.add(fill);

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
      productGroup.position.set(state.offProduct.x, 0, state.offProduct.z);
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
  let pointerLocked = false;
  let dragObject = null;
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

  let drag = null;
  canvas.addEventListener('mousedown', function (e) {
    if (state.cameraMode === 'walk' || e.button !== 0) return;
    const pick = pickMovable(e.clientX, e.clientY);
    if (!pick) return;
    e.preventDefault();
    const obj = pick.obj;
    let baseY = obj.position.y;
    if (obj === deskGroup) baseY = 0;
    drag = { obj: obj, baseY: baseY };
    controls.enabled = false;
  });

  window.addEventListener('mousemove', function (e) {
    if (!drag) return;
    const yPlane = drag.obj === deskGroup ? 0.01 : drag.baseY;
    const p = screenToFloor(e.clientX, e.clientY, yPlane);
    if (!p) return;
    const half = Math.max(W(), D()) * 0.48;
    const c = clampToRoom(p.x, p.z, 0.4);
    if (drag.obj === wardrobeMesh) {
      const ww = Math.max(0.85, Math.min(3.2, state.wardrobeW));
      const wd = Math.max(0.45, Math.min(1.15, state.wardrobeD));
      const wh = Math.max(1.45, Math.min(2.65, state.wardrobeH));
      const w0 = W();
      const d0 = D();
      state.offWardrobe.x = c.x - (w0 / 2 - ww / 2 - 0.1);
      state.offWardrobe.z = c.z - (-d0 / 2 + wd / 2 + 0.1);
      drag.obj.position.set(c.x, wh / 2, c.z);
    } else if (drag.obj === deskGroup) {
      const dw = Math.max(0.75, Math.min(2.3, state.deskW));
      const dd = Math.max(0.45, Math.min(1.05, state.deskD));
      const dh = Math.max(0.66, Math.min(1.08, state.deskH));
      const w0 = W();
      const d0 = D();
      state.offDesk.x = c.x - (-w0 / 2 + dw / 2 + 0.32);
      state.offDesk.z = c.z - (d0 / 2 - dd / 2 - 0.18);
      drag.obj.position.set(c.x, 0, c.z);
    } else if (drag.obj === productGroup) {
      state.offProduct.x = c.x;
      state.offProduct.z = c.z;
      drag.obj.position.set(c.x, drag.baseY, c.z);
    } else if (drag.obj.userData.extraId) {
      const id = drag.obj.userData.extraId;
      const ex = state.extras.find(function (x) {
        return x.id === id;
      });
      if (ex) {
        ex.x = c.x;
        ex.z = c.z;
        drag.obj.position.x = c.x;
        drag.obj.position.z = c.z;
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
      }
      camera.position.y = state.walkHeight;
      const c = clampToRoom(camera.position.x, camera.position.z, 0.55);
      camera.position.x = c.x;
      camera.position.z = c.z;
      camera.rotation.order = 'YXZ';
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    } else {
      controls.update();
    }

    dir.position.set(W() * 0.38, H() * 0.92, D() * 0.42);
    renderer.render(scene, camera);
  }
  tick();

  let debounceT = 0;
  function scheduleRebuild() {
    clearTimeout(debounceT);
    debounceT = setTimeout(function () {
      rebuildRoom();
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
        z: D() / 2 - pr.d * 0.7
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
