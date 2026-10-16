// Lean HDR post chain: MSAA half-float scene target → soft-knee bloom mip chain → background
// soft focus (depth-based) → ACES filmic + exposure + gentle vignette → sRGB.
import * as THREE from 'three';

const VS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function target(w, h, opts = {}) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, ...opts,
  });
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.levels = 4;
    this.bloomStrength = 0.22;
    this.exposure = 1.0;
    this.focus = { dist: 2.0, range: 0.5, amount: 1.0 };
    this.saturation = 1.06;
    this.vignette = 0.22;

    this.mPre = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.2 }, uKnee: { value: 0.6 } },
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold, uKnee; varying vec2 vUv;
        void main(){
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5,-0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5,-0.5)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-0.5,0.5)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.5,0.5)).rgb;
          c *= 0.25;
          c = min(c, vec3(60.0));
          float br = max(c.r, max(c.g, c.b));
          float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
          soft = soft * soft / (4.0 * uKnee + 1e-4);
          float w = max(soft, br - uThreshold) / max(br, 1e-4);
          gl_FragColor = vec4(c * w, 1.0);
        }`,
    });
    this.mDown = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        void main(){
          vec3 a = texture2D(tSrc, vUv + uTexel * vec2(-1.0,-1.0)).rgb, b = texture2D(tSrc, vUv + uTexel * vec2(1.0,-1.0)).rgb;
          vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0,1.0)).rgb, d = texture2D(tSrc, vUv + uTexel * vec2(1.0,1.0)).rgb;
          vec3 e = texture2D(tSrc, vUv).rgb;
          gl_FragColor = vec4((a + b + c + d) * 0.125 + e * 0.5, 1.0);
        }`,
    });
    this.mUp = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uK: { value: 1 } },
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uK; varying vec2 vUv;
        void main(){
          vec3 s = texture2D(tSrc, vUv + uTexel * vec2(-1,-1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1,-1)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(-1,1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1,1)).rgb;
          s += 2.0 * (texture2D(tSrc, vUv + uTexel * vec2(-1,0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1,0)).rgb
                 + texture2D(tSrc, vUv + uTexel * vec2(0,-1)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0,1)).rgb);
          s += 4.0 * texture2D(tSrc, vUv).rgb;
          gl_FragColor = vec4(s / 16.0 * uK, 1.0);
        }`,
    });
    // background soft focus: half-res disk gather weighted by circle of confusion
    this.mBlur = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNear: { value: 0.05 }, uFar: { value: 20 },
        uFocus: { value: 2 }, uRange: { value: 0.6 }, uAmount: { value: 1 } },
      fragmentShader: /* glsl */`
        #include <packing>
        uniform sampler2D tSrc, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uFocus, uRange, uAmount; varying vec2 vUv;
        float lin(vec2 uv){ float d = texture2D(tDepth, uv).x; return perspectiveDepthToViewZ(d, uNear, uFar) * -1.0; }
        float coc(float z){ return clamp((z - uFocus - uRange) / (uFocus * 1.2), 0.0, 1.0) * uAmount; }
        void main(){
          float c0 = coc(lin(vUv));
          vec3 acc = texture2D(tSrc, vUv).rgb; float wsum = 1.0;
          const int N = 10;
          for (int i = 0; i < N; i++) {
            float a = float(i) * 2.39996;
            float r = sqrt((float(i) + 0.5) / float(N));
            vec2 o = vec2(cos(a), sin(a)) * r * 7.0 * c0 * uTexel;
            vec2 uv = vUv + o;
            float c = coc(lin(uv));
            float w = smoothstep(0.0, 0.3, c);
            acc += texture2D(tSrc, uv).rgb * w; wsum += w;
          }
          gl_FragColor = vec4(acc / wsum, c0);
        }`,
    });
    this.mComp = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tBloom: { value: null }, tBlur: { value: null }, uBloom: { value: 0.2 }, uExposure: { value: 1 },
        uSat: { value: 1.05 }, uVig: { value: 0.2 }, uAspect: { value: 1 }, uBlurOn: { value: 1 }, uTime: { value: 0 } },
      fragmentShader: /* glsl */`
        uniform sampler2D tScene, tBloom, tBlur; uniform float uBloom, uExposure, uSat, uVig, uAspect, uBlurOn, uTime; varying vec2 vUv;
        vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
        vec3 aces(vec3 color){
          const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
          const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
          color = ACESInputMat * color; color = RRTAndODTFit(color); color = ACESOutputMat * color; return clamp(color, 0.0, 1.0);
        }
        void main(){
          vec3 c = texture2D(tScene, vUv).rgb;
          if (uBlurOn > 0.5) { vec4 b = texture2D(tBlur, vUv); c = mix(c, b.rgb, smoothstep(0.02, 0.25, b.a)); }
          c += texture2D(tBloom, vUv).rgb * uBloom;
          c *= uExposure;
          c = aces(c);
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = max(mix(vec3(l), c, uSat), 0.0);
          vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
          c *= 1.0 - uVig * smoothstep(0.35, 1.0, length(q) * 1.15);
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          // dither against banding
          float n = fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor.rgb += (n - 0.5) / 255.0;
        }`,
    });
    this.mFxaa = new THREE.ShaderMaterial({
      vertexShader: VS, depthTest: false, depthWrite: false,
      uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } },
      fragmentShader: /* glsl */`
        uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
        float L(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
        void main(){
          // FXAA (lite): edge-aware blend along the local gradient
          vec3 cM = texture2D(tSrc, vUv).rgb;
          vec3 cNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb, cNE = texture2D(tSrc, vUv + vec2(1.0, -1.0) * uTexel).rgb;
          vec3 cSW = texture2D(tSrc, vUv + vec2(-1.0, 1.0) * uTexel).rgb, cSE = texture2D(tSrc, vUv + vec2(1.0, 1.0) * uTexel).rgb;
          float lM = L(cM), lNW = L(cNW), lNE = L(cNE), lSW = L(cSW), lSE = L(cSE);
          float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
          vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
          float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
          float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
          dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * uTexel;
          vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
          vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
          float lB = L(b);
          gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.setSize(2, 2, 4);
  }

  setSize(w, h, samples = 4) {
    this.w = w; this.h = h; this.samples = samples;
    if (this.scene) { this.scene.dispose(); this.blur.dispose(); this.mips.forEach((m) => m.dispose()); this.ldr?.dispose(); }
    this.ldr = samples ? null : new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    if (this.ldr) this.ldr.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene = target(w, h, { samples, depthBuffer: true });
    this.scene.depthTexture = new THREE.DepthTexture(w, h);
    this.scene.depthTexture.type = THREE.UnsignedIntType;
    this.blur = target(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.mips = [];
    let mw = w >> 1, mh = h >> 1;
    for (let i = 0; i < this.levels; i++) { this.mips.push(target(Math.max(1, mw), Math.max(1, mh))); mw >>= 1; mh >>= 1; }
  }

  pass(mat, tgt) { this.quad.material = mat; this.r.setRenderTarget(tgt); this.r.render(this.quad, this.cam); }

  render(scene, camera, time = 0, opts = {}) {
    const r = this.r;
    const G = this.gpuT;
    r.setRenderTarget(this.scene);
    r.clear();
    G && G.begin('scene');
    r.render(scene, camera);
    G && G.end();
    const ac = r.autoClear; r.autoClear = false;
    G && G.begin('bloom');
    // bloom
    this.mPre.uniforms.tSrc.value = this.scene.texture; this.mPre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    r.autoClear = true; this.pass(this.mPre, this.mips[0]);
    for (let i = 1; i < this.levels; i++) {
      this.mDown.uniforms.tSrc.value = this.mips[i - 1].texture; this.mDown.uniforms.uTexel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
      this.pass(this.mDown, this.mips[i]);
    }
    r.autoClear = false;
    for (let i = this.levels - 1; i > 0; i--) {
      this.mUp.uniforms.tSrc.value = this.mips[i].texture; this.mUp.uniforms.uTexel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.mUp.uniforms.uK.value = 1.0;
      this.pass(this.mUp, this.mips[i - 1]);
    }
    r.autoClear = true;
    G && G.end();
    // background soft focus
    const blurOn = this.focus.amount > 0.01 && !opts.noBlur;
    G && G.begin('dof');
    if (blurOn) {
      const u = this.mBlur.uniforms;
      u.tSrc.value = this.scene.texture; u.tDepth.value = this.scene.depthTexture; u.uTexel.value.set(1 / this.w, 1 / this.h);
      u.uNear.value = camera.near; u.uFar.value = camera.far; u.uFocus.value = this.focus.dist; u.uRange.value = this.focus.range; u.uAmount.value = this.focus.amount;
      this.pass(this.mBlur, this.blur);
    }
    G && G.end();
    G && G.begin('composite');
    const u = this.mComp.uniforms;
    u.tScene.value = this.scene.texture; u.tBloom.value = this.mips[0].texture; u.tBlur.value = this.blur.texture; u.uBlurOn.value = blurOn ? 1 : 0;
    u.uBloom.value = this.bloomStrength; u.uExposure.value = this.exposure; u.uSat.value = this.saturation; u.uVig.value = this.vignette;
    u.uAspect.value = this.w / this.h; u.uTime.value = time % 100;
    if (this.ldr) {
      // no MSAA: composite into an sRGB buffer, then FXAA to the output
      this.pass(this.mComp, this.ldr);
      this.mFxaa.uniforms.tSrc.value = this.ldr.texture; this.mFxaa.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(this.mFxaa, opts.target || null);
    } else this.pass(this.mComp, opts.target || null);
    G && G.end();
    r.autoClear = ac;
  }
}
