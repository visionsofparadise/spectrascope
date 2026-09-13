import { useEffect, useRef } from "react";
import { THEME_PALETTES } from "../utils/themePalettes";
import { hexToRgb255 } from "../workspace/spectral/colorUtil";
import type { ThemeId } from "../utils/themePalettes";

const VERT = `#version 300 es
in vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision mediump float;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_gscale;
uniform float u_gwell;
uniform float u_gwellw;
uniform float u_gthin;
uniform float u_gint;
uniform vec2 u_gcenter;
uniform float u_gpar;
uniform float u_gtilt;
uniform vec3 u_stops[16];
uniform int u_nstops;
uniform vec3 u_sky;
out vec4 fragColor;

const float SPEED = 5.8;
const float CAM_HEIGHT = 14.5;
const float LOOK_DOWN = -1.1;
const float FOV = 0.5;
const float FOG_DENSITY = 0.055;
const float FOG_START = 30.0;
const float TERRAIN_SCALE = 0.05;
const float TERRAIN_AMP = 4.1;
const float ROTATION = radians(-29.0);
const float COLOR_MIN = 1.1;
const float COLOR_MAX = 8.0;
const float SWAY_AMT = 3.0;
const float SWAY_SPEED = 0.5;
const float TROUGH = 0.004;
const vec3 GRID_COL = vec3(184.0, 184.0, 192.0) / 255.0;
const float COS_ROT = cos(ROTATION);
const float SIN_ROT = sin(ROTATION);

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289v2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 10.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289v2(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float ridgedFbm(vec2 p) {
  float n0 = 1.0 - abs(snoise(p));
  float n1 = 1.0 - abs(snoise(p * 2.0));
  float n2 = 1.0 - abs(snoise(p * 4.0));
  return n0 * n0 * 0.5 + n1 * n1 * 0.25 + n2 * n2 * 0.125;
}

float terrainBase(vec2 p) {
  vec2 sp = p * TERRAIN_SCALE;
  return (ridgedFbm(sp * 0.3) * 2.0 + ridgedFbm(sp * 0.7 + 3.7) * 0.8) * TERRAIN_AMP;
}

float terrain(vec2 p, float camX) {
  float dx = p.x - camX;
  return terrainBase(p) + dx * dx * TROUGH;
}

vec3 colormapFn(float t) {
  float f = clamp(t, 0.0, 1.0) * float(u_nstops - 1);
  int i = int(floor(f));
  i = clamp(i, 0, u_nstops - 2);
  float k = f - float(i);
  return mix(u_stops[i], u_stops[i + 1], k);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float aspect = u_resolution.x / u_resolution.y;
  float t = u_time * SPEED;
  float swayX = sin(u_time * SWAY_SPEED) * SWAY_AMT;
  float swayY = cos(u_time * SWAY_SPEED * 0.7) * SWAY_AMT * 0.3;
  vec3 camPos = vec3(swayX, CAM_HEIGHT + swayY, t);
  vec3 camTarget = vec3(swayX * 0.5, CAM_HEIGHT - LOOK_DOWN, t + 5.0);
  vec3 camUp = vec3(0.0, 1.0, 0.0);
  vec3 cw = normalize(camTarget - camPos);
  vec3 cu = normalize(cross(cw, camUp));
  vec3 cv = cross(cu, cw);
  vec2 screen = (uv - 0.5) * vec2(aspect, 1.0) * 2.0;
  screen = vec2(screen.x * COS_ROT - screen.y * SIN_ROT, screen.x * SIN_ROT + screen.y * COS_ROT);
  vec3 rd = normalize(screen.x * cu + screen.y * cv + FOV * cw);
  vec3 voidColor = vec3(2.0 / 255.0, 2.0 / 255.0, 4.0 / 255.0);
  float tRay = 0.0;
  bool hit = false;
  vec3 hitPos;
  for (int i = 0; i < 64; i++) {
    hitPos = camPos + rd * tRay;
    float hh = terrain(hitPos.xz, camPos.x);
    float dist = hitPos.y - hh;
    if (dist < 0.1) {
      hit = true;
      break;
    }
    tRay += max(dist * 0.6, 0.16);
    if (tRay > 60.0) break;
  }
  vec3 col = voidColor;
  float alpha = 0.0;
  if (hit) {
    float hh = terrainBase(hitPos.xz);
    float nh = clamp((hh - COLOR_MIN) / (COLOR_MAX - COLOR_MIN), 0.0, 1.0);
    col = colormapFn(nh);
    float fogDist = max(tRay - FOG_START, 0.0);
    float fogFactor = 1.0 - exp(-fogDist * FOG_DENSITY);
    col = mix(col, voidColor, fogFactor);
    alpha = 1.0;
  } else {
    vec3 skyBase = u_sky;
    float skyGrad = smoothstep(-0.2, 0.5, rd.y);
    col = mix(skyBase, voidColor, skyGrad);
    alpha = 1.0 - skyGrad;
    vec3 cw0 = normalize(vec3(0.0, -LOOK_DOWN, 5.0));
    vec3 cu0 = normalize(cross(cw0, camUp));
    vec3 cv0 = cross(cu0, cw0);
    float dz = max(dot(rd, cw0), 0.05);
    vec2 gsFixed = vec2(dot(rd, cu0), dot(rd, cv0)) / dz * FOV;
    vec2 gs = mix(screen, gsFixed, u_gtilt) - u_gcenter;
    float r2 = dot(gs, gs);
    gs *= 1.0 + u_gwell * exp(-sqrt(r2) * u_gwellw);
    gs += u_gcenter;
    vec2 g = gs * u_gscale + vec2(swayX, swayY) * u_gpar;
    vec2 fw = fwidth(g);
    vec2 d = abs(fract(g) - 0.5);
    vec2 lw = 1.0 - smoothstep(vec2(0.0), fw * u_gthin, vec2(0.5) - d);
    float line = max(lw.x, lw.y);
    float gi = line * u_gint;
    col = col * alpha + GRID_COL * gi;
    alpha = min(alpha + gi, 1.0);
    fragColor = vec4(col, alpha);
    return;
  }
  fragColor = vec4(col * alpha, alpha);
}
`;

const PIXEL_RATIO_CAP = 0.75;
const MAX_STOPS = 16;
const GRID_SCALE = 10;
const GRID_WELL = -0.95;
const GRID_WELL_WIDTH = 1.4;
const GRID_THIN = 0.5;
const GRID_INTENSITY = 0.16;
const GRID_CENTER_X = -0.1;
const GRID_CENTER_Y = -0.85;
const GRID_PARALLAX = 0.1;
const GRID_TILT = 0;

function createShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type);

	if (!shader) return null;

	gl.shaderSource(shader, source);
	gl.compileShader(shader);

	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error("Shader compile error:", gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);

		return null;
	}

	return shader;
}

function createProgram(gl: WebGL2RenderingContext, vert: WebGLShader, frag: WebGLShader): WebGLProgram | null {
	const program = gl.createProgram();

	gl.attachShader(program, vert);
	gl.attachShader(program, frag);
	gl.linkProgram(program);

	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error("Program link error:", gl.getProgramInfoLog(program));
		gl.deleteProgram(program);

		return null;
	}

	return program;
}

function unitRgbOf(hex: string): [number, number, number] {
	const [red, green, blue] = hexToRgb255(hex);

	return [red / 255, green / 255, blue / 255];
}

export function TerrainShader({ theme, className }: { readonly theme: ThemeId; readonly className?: string }) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rafRef = useRef<number>(0);
	const themeRef = useRef(theme);

	themeRef.current = theme;

	useEffect(() => {
		const canvas = canvasRef.current;

		if (!canvas) return;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		const gl = canvas.getContext("webgl2", {
			alpha: true,
			premultipliedAlpha: true,
			antialias: false,
			preserveDrawingBuffer: true,
		});

		if (!gl) return;

		const vert = createShader(gl, gl.VERTEX_SHADER, VERT);
		const frag = createShader(gl, gl.FRAGMENT_SHADER, FRAG);

		if (!vert || !frag) {
			if (vert) gl.deleteShader(vert);

			if (frag) gl.deleteShader(frag);

			return;
		}

		const program = createProgram(gl, vert, frag);

		if (!program) {
			gl.deleteShader(vert);
			gl.deleteShader(frag);

			return;
		}

		const posAttr = gl.getAttribLocation(program, "a_position");
		const uResolution = gl.getUniformLocation(program, "u_resolution");
		const uTime = gl.getUniformLocation(program, "u_time");
		const uGridScale = gl.getUniformLocation(program, "u_gscale");
		const uGridWell = gl.getUniformLocation(program, "u_gwell");
		const uGridWellWidth = gl.getUniformLocation(program, "u_gwellw");
		const uGridThin = gl.getUniformLocation(program, "u_gthin");
		const uGridIntensity = gl.getUniformLocation(program, "u_gint");
		const uGridCenter = gl.getUniformLocation(program, "u_gcenter");
		const uGridParallax = gl.getUniformLocation(program, "u_gpar");
		const uGridTilt = gl.getUniformLocation(program, "u_gtilt");
		const uStops = gl.getUniformLocation(program, "u_stops");
		const uStopCount = gl.getUniformLocation(program, "u_nstops");
		const uSky = gl.getUniformLocation(program, "u_sky");

		const buffer = gl.createBuffer();

		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

		const resize = () => {
			const pixelRatio = Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP);
			const rect = canvas.getBoundingClientRect();

			canvas.width = Math.max(1, rect.width * pixelRatio);
			canvas.height = Math.max(1, rect.height * pixelRatio);
			gl.viewport(0, 0, canvas.width, canvas.height);
		};

		resize();

		const observer = new ResizeObserver(resize);

		observer.observe(canvas);

		const stops = new Float32Array(MAX_STOPS * 3);
		let stopCount = 0;
		let sky: [number, number, number] = [0, 0, 0];
		let paletteTheme: ThemeId | null = null;
		const startTime = performance.now();

		const render = () => {
			const elapsed = (performance.now() - startTime) / 1000;

			if (paletteTheme !== themeRef.current) {
				const palette = THEME_PALETTES[themeRef.current];
				const ramp = palette.ramp.slice(0, MAX_STOPS);

				stops.fill(0);
				ramp.forEach((hex, index) => stops.set(unitRgbOf(hex), index * 3));
				stopCount = ramp.length;
				sky = unitRgbOf(palette.sky);
				paletteTheme = themeRef.current;
			}

			gl.clearColor(0, 0, 0, 0);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.useProgram(program);
			gl.uniform2f(uResolution, canvas.width, canvas.height);
			gl.uniform1f(uTime, reducedMotion ? 0 : elapsed);
			gl.uniform1f(uGridScale, GRID_SCALE);
			gl.uniform1f(uGridWell, GRID_WELL);
			gl.uniform1f(uGridWellWidth, GRID_WELL_WIDTH);
			gl.uniform1f(uGridThin, GRID_THIN);
			gl.uniform1f(uGridIntensity, GRID_INTENSITY);
			gl.uniform2f(uGridCenter, GRID_CENTER_X, GRID_CENTER_Y);
			gl.uniform1f(uGridParallax, GRID_PARALLAX);
			gl.uniform1f(uGridTilt, GRID_TILT);
			gl.uniform3fv(uStops, stops);
			gl.uniform1i(uStopCount, stopCount);
			gl.uniform3f(uSky, ...sky);

			gl.enableVertexAttribArray(posAttr);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		};

		const loop = () => {
			render();
			rafRef.current = requestAnimationFrame(loop);
		};

		render();
		rafRef.current = requestAnimationFrame(loop);

		return () => {
			cancelAnimationFrame(rafRef.current);
			observer.disconnect();
			gl.deleteProgram(program);
			gl.deleteShader(vert);
			gl.deleteShader(frag);
			gl.deleteBuffer(buffer);
			gl.getExtension("WEBGL_lose_context")?.loseContext();
		};
	}, []);

	return (
		<canvas
			ref={canvasRef}
			className={className}
			style={{ display: "block", width: "100%", height: "100%" }}
			aria-hidden="true"
		/>
	);
}
