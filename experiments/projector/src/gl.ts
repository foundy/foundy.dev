// Raw WebGL2 renderer: room, wall projection, slide tray (3D), volumetric beam (half-res), dust, grain/vignette.
// Everything is a pure function of the Frame passed to draw().
export interface Frame {
  t: number; W: number; H: number;
  light: number; // 0 dark room .. 1 warm paper
  projI: number; // how lit the projection currently is (halo / bounce)
  quad: [number, number, number, number]; // cx, cy, hw, hh (px) for halo
  top: [number, number, number]; bot: [number, number, number]; // xl, xr, y
  texA: number; texB: number; mix: number; blur: number; bright: number; vig: number; fringe: number; expo: number; bloom: number;
  dy: number; scale: number; alpha: number; flick: number; seed: number;
  pos: number; vel: number; trayCy: number;
  avg: [number, number, number]; tint: [number, number, number];
  lens: [number, number]; r0: number; beamTL: [number, number]; beamTR: [number, number]; beamGain: number; dustFade: number; vB: number;
  grain: number; vigPost: number; still: boolean;
}

const C = `
float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.1;a*=.5;}return s;}
`;
const H = '#version 300 es\nprecision highp float;\nprecision highp sampler2DArray;\n';
const QVS = `${H}uniform vec4 uBox;uniform vec2 uRes;out vec2 vPx;
void main(){vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vec2 px=mix(uBox.xy,uBox.zw,c);vPx=px;gl_Position=vec4(px.x/uRes.x*2.-1.,1.-px.y/uRes.y*2.,0.,1.);}`;

const BG = `${H}${C}in vec2 vPx;out vec4 o;uniform vec2 uRes;uniform float uLight,uProjI,uHor,uTime;uniform vec4 uQ;uniform vec3 uAvg;
void main(){
  vec3 dark=vec3(.043,.035,.031),paper=vec3(.953,.929,.886);
  float dp=length(max(abs(vPx-uQ.xy)-uQ.zw,0.));
  float halo=exp(-dp/(.30*uRes.y))*.6+exp(-dp/(.07*uRes.y))*.7;
  vec3 c=dark*(.75+.25*(1.-vPx.y/uRes.y));
  c+=uAvg*halo*uProjI*.20*(.8+.5*fbm(vPx/70.));
  // faint wall/floor split: floor catches the bounce
  float fl=smoothstep(uHor-18.,uHor+60.,vPx.y);
  c+=uAvg*uProjI*fl*.07*exp(-abs(vPx.x-uRes.x*.5)/(uRes.x*.8));
  c*=1.-.35*(1.-fl)*0.;
  c+=.006*smoothstep(uHor-2.,uHor,vPx.y)*(1.-smoothstep(uHor,uHor+3.,vPx.y))*uProjI;
  o=vec4(mix(c,paper,uLight),1.);}`;

const PROJ = `${H}${C}in vec2 vPx;out vec4 o;
uniform vec3 uTop,uBot,uTint;uniform sampler2D uA,uB;
uniform float uMix,uBlur,uBright,uVig,uFringe,uExpo,uBloom,uDy,uScale,uAlpha,uFlick,uSeed,uTime;
vec3 smp(sampler2D s,vec2 uv,float lod,float r){
  if(uBlur<.003) return texture(s,uv,-.7*(1.-uVig)).rgb;
  vec3 a=vec3(0.);
  for(int i=0;i<10;i++){float fi=float(i);float ang=fi*2.39996;float rad=sqrt((fi+.5)/10.)*r;a+=textureLod(s,uv+vec2(cos(ang),sin(ang))*rad,lod).rgb;}
  return a*.1;}
vec3 both(vec2 uv,float lod,float r){
  vec3 a=smp(uA,uv,lod,r);
  if(uMix>.001){vec3 b=smp(uB,uv,lod,r);a=mix(a,b,uMix);} return a;}
void main(){
  vec2 P=vPx-vec2(0.,uDy);
  float v=(P.y-uTop.z)/(uBot.z-uTop.z);
  float xl=mix(uTop.x,uBot.x,v),xr=mix(uTop.y,uBot.y,v);
  float u=(P.x-xl)/(xr-xl);
  float wpx=xr-xl,hpx=uBot.z-uTop.z;
  float ed=min(min(u,1.-u)*wpx,min(v,1.-v)*hpx);
  float m=smoothstep(-.5,.9+uVig*3.,ed);
  if(m<=0.){o=vec4(0.);return;}
  vec2 c=vec2(u,v)-.5;
  vec2 uv=.5+c/uScale;
  float rr=length(c*vec2(1.,hpx/wpx)*1.5);
  float lod=uBlur*3.2, br=uBlur*.016;
  vec2 fo=c*.010*uFringe*pow(length(c)*2.,2.);
  vec3 col;
  if(uFringe>.001){col=vec3(both(uv+fo,lod,br).r,both(uv,lod,br).g,both(uv-fo,lod,br).b);}
  else col=both(uv,lod,br);
  // lens bloom on highlights
  if(uBloom>.001){vec3 bl=textureLod(uA,uv,5.2).rgb;if(uMix>.001)bl=mix(bl,textureLod(uB,uv,5.2).rgb,uMix);
    vec3 hi=max(bl-vec3(.6),0.);col+=hi*uBloom*.55;}
  // lamp falloff, warm lamp, contrast
  float vg=1.-uVig*.82*smoothstep(.22,1.05,rr);
  col*=vg*(1.+.05*uVig*(1.-rr));
  col=mix(col,1.-exp(-col*1.7),uVig*.85);
  col*=mix(vec3(1.),vec3(1.05,.975,.89)*uTint*.5+.5,uVig*.6);
  col=mix(col,(col-.5)*1.1+.5,uVig);
  // slide grain + dust specks, only while projected
  float gr=vn(vec2(u,v)*vec2(wpx,hpx)*.9)-.5;col*=1.+gr*.07*uVig;
  for(int i=0;i<4;i++){float fi=float(i)+uSeed*7.;vec2 sp=vec2(h11(fi*3.1),h11(fi*7.7+2.));float sz=.004+.006*h11(fi*1.9);
    col*=1.-.25*uVig*smoothstep(sz,0.,length((vec2(u,v)-sp)*vec2(1.,hpx/wpx)));}
  col*=uExpo*uBright*(1.+uFlick);
  o=vec4(col,m*uAlpha);}`;

const TRAY_VS = `${H}uniform mat4 uVP;in vec3 aP;in vec3 aN;in float aK;out vec3 vP;out vec3 vN;out float vK;
void main(){vP=aP;vN=aN;vK=aK;gl_Position=uVP*vec4(aP,1.);}`;
const TRAY_FS = `${H}${C}in vec3 vP;in vec3 vN;in float vK;out vec4 o;
uniform vec3 uCam,uGate,uCol,uAvg;uniform float uPos,uN,uLit,uLight,uFlick;
void main(){
  vec3 N=normalize(vN),V=normalize(uCam-vP);
  float r=length(vP.xz),ang=atan(vP.x,vP.z),s=ang/(6.2831853/uN)+uPos;
  float fs=abs(fract(s)-.5); // 0.5 at slot centre... 0 at boundary
  vec3 alb=vec3(.07);float sp=.5,rg=.5;
  int k=int(vK+.5);
  if(k==0){alb=vec3(.075,.07,.066);alb*=.7+.6*vn(vec2(ang*70.,vP.y*5.));
    alb*=1.-.8*smoothstep(.03,.0,fs);
    alb+=vec3(.05)*smoothstep(.012,.0,abs(vP.y+.05))+vec3(.04)*smoothstep(.012,.0,abs(vP.y+.46));sp=.9;}
  else if(k==1){alb=vec3(.085,.08,.075)*(.85+.15*sin(r*190.));
    float slit=smoothstep(.05,.03,abs(fract(s+.5)-.5))*smoothstep(.88,.9,r)*smoothstep(1.06,1.03,r);alb*=1.-.9*slit;
    alb+=vec3(.05)*smoothstep(.01,.0,abs(r-.88))+vec3(.06)*smoothstep(.01,.0,abs(r-1.06));sp=.8;}
  else if(k==2){alb=vec3(.11,.105,.1)*(.85+.15*vn(vec2(ang*30.,vP.y*40.)));sp=1.;}
  else {alb=vec3(.045,.043,.042);sp=.35;}
  vec3 Lg=uGate-vP;float d2=dot(Lg,Lg);vec3 L=normalize(Lg);float att=1./(.5+d2*1.2);
  float diff=max(dot(N,L),0.);vec3 Hh=normalize(L+V);
  float spec=pow(max(dot(N,Hh),0.),mix(18.,110.,sp))*sp;
  vec3 Lw=normalize(vec3(0.,.35,-1.));float dw=pow(dot(N,Lw)*.5+.5,2.);
  float fr=pow(1.-max(dot(N,V),0.),3.);
  vec3 c=alb*(uCol*diff*att*3.4*(1.+uFlick)+uAvg*dw*uLit*.9+.02)+uCol*spec*att*1.7+uAvg*fr*uLit*.10+uCol*fr*att*.22;
  c*=1.+3.*uLight;
  o=vec4(c,1.);}`;

const SL_VS = `${H}uniform mat4 uVP;uniform float uPos,uN,uP;
out vec2 vUV;out vec3 vW;out vec3 vNr;out float vGate;flat out float vLayer;
void main(){
  float i=float(gl_InstanceID);float a=6.2831853/uN;
  float ph=(i-uPos)*a;ph-=6.2831853*floor((ph+3.14159265)/6.2831853);
  float gw=exp(-pow(ph/(.55*a),2.));
  vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));
  float hw=.235,hh=.47,lift=.015+.17*gw;
  vec3 rad=vec3(sin(ph),0.,cos(ph));vec3 T=vec3(cos(ph),0.,-sin(ph));
  vec3 p=rad*(1.+.02*gw)+T*(c.x*2.-1.)*hw+vec3(0.,lift+c.y*hh,0.);
  p+=rad*(c.y*hh)*(.05-.07*gw);
  vUV=vec2(c.x,1.-c.y);vW=p;vNr=rad;vGate=gw;vLayer=mod(i,uP);
  gl_Position=uVP*vec4(p,1.);}`;
const SL_FS = `${H}${C}in vec2 vUV;in vec3 vW;in vec3 vNr;in float vGate;flat in float vLayer;out vec4 o;
uniform sampler2DArray uAtlas;uniform vec3 uCam,uGate,uCol,uAvg;uniform float uLit,uLight,uFlick;
void main(){
  vec2 p=vUV-.5;vec2 q=abs(p)-(.5-.07);float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-.07;
  float aa=max(fwidth(sd),1e-4);float cov=smoothstep(aa*.5,-aa*.5,sd);
  if(cov<=0.){discard;}
  bool fr=dot(vNr,uCam-vW)>0.;vec3 N=fr?vNr:-vNr;
  vec3 Lg=uGate-vW;float d2=dot(Lg,Lg);vec3 L=normalize(Lg);float att=1./(.6+d2*1.4);
  float diff=max(dot(N,L),0.);
  float gw=vGate;
  vec3 alb=vec3(.89,.85,.74)*(.93+.07*vn(vUV*95.));
  float lab=step(.40,p.y)*step(p.y,.455)*step(abs(p.x+.1),.2);alb*=1.-.22*lab;
  vec3 lightC=uCol*(diff*att*1.55*(1.+uFlick)+gw*.28)+uAvg*uLit*(.30+.2*(1.-diff))*.5+vec3(.03,.026,.022);
  vec3 col=alb*lightC;
  float edge=exp(-pow((sd+.017)/.011,2.));
  col+=uCol*edge*(.12+.8*gw+att*.45)*(fr?1.:.5);
  // aperture
  vec2 ap=p/.66;float am=max(abs(ap.x),abs(ap.y));
  if(am<.5){
    float inner=smoothstep(.5,.455,am);
    vec3 img=texture(uAtlas,vec3(ap+.5,vLayer)).rgb;
    float em=.26+.95*gw+.34*att;
    vec3 w=fr?img*em:(texture(uAtlas,vec3(1.-(ap.x+.5),ap.y+.5,vLayer)).rgb*(.05+.55*att)*uCol+alb*lightC*.35*(.75+.25*vUV.y));
    float sheen=smoothstep(.05,.0,abs(ap.x*.8+ap.y*.6-.1-.35*sin(uFlick*8.)))*.10;
    w+=uCol*sheen*att*(fr?1.:0.);
    col=mix(vec3(.01),w,inner);
    col=mix(col,vec3(.0),(1.-inner)*.8);
  }
  col*=1.+3.*uLight;
  o=vec4(col,cov);}`;

const BEAM = `${H}${C}in vec2 vPx;out vec4 o;
uniform vec2 uL,uTL,uTR;uniform vec4 uQ;uniform float uR0,uTime,uGain,uYT;uniform vec3 uCol;
void main(){
  float yE=(uTL.y+uTR.y)*.5;float Hh=uL.y-yE;
  float v=(uL.y-vPx.y)/Hh;
  if(v<-.02||vPx.y<uYT){o=vec4(0.);return;}
  float vc=clamp(v,0.,1.);
  float xl=uL.x+(uTL.x-uL.x)*vc-uR0*(1.-vc),xr=uL.x+(uTR.x-uL.x)*vc+uR0*(1.-vc);
  float w=xr-xl;float u=(vPx.x-xl)/w;
  float soft=8.+46.*vc;
  float edge=smoothstep(0.,soft,min(vPx.x-xl,xr-vPx.x));
  float t=uTime;
  float s1=vn(vec2(u*11.+t*.05,v*1.7-t*.07));
  float s2=fbm(vec2(u*2.2-t*.02,v*3.0-t*.10));
  float s3=vn(vec2(u*30.-t*.03,v*.8-t*.03));
  float dens=.34+1.0*s2+.6*(s1*s1)+.25*s3;
  float I=(mix(.85,.34,pow(vc,.7))+.45*exp(-vc*12.))*smoothstep(0.,.12,vc);
  float bx=smoothstep(-8.,8.,uQ.z-abs(vPx.x-uQ.x))*smoothstep(-8.,8.,uQ.w-abs(vPx.y-uQ.y));float veil=mix(1.,.08,bx);
  float cut=smoothstep(-.02,.01,v)*smoothstep(uYT-1.,uYT+30.,vPx.y);
  float core=exp(-pow(length(vec2((vPx.x-uL.x)/(uR0*1.4+1.),(vPx.y-uL.y)/(uR0*2.4+1.))),2.));
  vec3 rgb=uCol*(I*dens*edge*veil*cut)*uGain+uCol*core*.35*uGain;
  rgb+=(h21(vPx*3.7+t)-.5)/200.;
  o=vec4(max(rgb,0.),1.);}`;
const COMP = `${H}in vec2 vPx;out vec4 o;uniform sampler2D uT;uniform vec2 uRes;
void main(){o=vec4(texture(uT,vec2(vPx.x,uRes.y-vPx.y)/uRes).rgb,1.);}`;

const DUST_VS = `${H}${C}uniform vec2 uL,uTL,uTR,uRes;uniform float uTime,uDpr,uFade,uVel,uR0,uYT;out float vA;out float vSoft;
void main(){
  float id=float(gl_VertexID);
  float r1=h11(id+.5),r2=h11(id*1.7+11.),r3=h11(id*3.1+23.),r4=h11(id*7.3+41.),r5=h11(id*13.7+5.);
  float yE=(uTL.y+uTR.y)*.5,Hh=uL.y-yE,vT=max((uL.y-uYT)/Hh,1.);
  float f=fract(r1+uTime*(.003+.012*r4));
  float v=(f+.012*sin(uTime*(.3+r4*.5)+id*1.3))*vT;
  float u=mix(-.6,1.6,r2)+.05*sin(uTime*(.15+r5*.4)+id)+.03*sin(uTime*.31+id*.7);
  float vx=min(v,1.);
  vec2 pe=uL+(uTL-uL)*vx*(1.-u)+(uTR-uL)*vx*u+vec2((u*2.-1.)*uR0*(1.-vx),0.);
  pe.y=uL.y-Hh*v;
  float big=smoothstep(.16,.0,r3);
  float size=mix(1.3+1.7*r5,14.+11.*r5,big);
  pe.x+=uVel*(r3-.5)*-16.+4.*sin(uTime*.2+id)*big;
  float ins=smoothstep(-.03,.1,u)*smoothstep(1.03,.9,u);
  float lit=mix(.06,1.,ins);
  float tw=.5+.5*sin(uTime*(.7+r4*2.2)+r1*40.);
  vA=lit*(.35+.65*tw)*mix(1.,.16,big)*mix(1.4,.5,min(v,1.))*mix(1.,.55,smoothstep(.98,1.05,v))*smoothstep(0.,.07,v)*smoothstep(1.,.86,f)*uFade;
  gl_PointSize=size*uDpr;vSoft=big;
  gl_Position=vec4(pe.x/uRes.x*2.-1.,1.-pe.y/uRes.y*2.,0.,1.);}`;
const DUST_FS = `${H}in float vA;in float vSoft;out vec4 o;uniform vec3 uCol;
void main(){float d=length(gl_PointCoord-.5)*2.;float c=smoothstep(1.,mix(.5,-.2,vSoft),d);o=vec4(uCol*vA*c*.9,1.);}`;

const POST = `${H}${C}in vec2 vPx;out vec4 o;uniform vec2 uRes;uniform float uGrain,uVig,uLight,uTime;
void main(){
  vec2 q=(vPx/uRes-.5);q.x*=uRes.x/uRes.y*.75;
  float av=smoothstep(.2,.95,length(q)*1.5)*uVig;
  float fr=floor(uTime*24.);
  float n=h21(floor(vPx/1.4)+vec2(fr*37.,fr*17.));n=max(n-.5,0.)*2.;
  float k=uGrain*(1.-uLight);
  o=vec4(vec3(n*k*.034),1.-av*(1.-uLight));}`;

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null>; gl: WebGL2RenderingContext };
const loc = (pr: Prog, n: string) => (n in pr.u ? pr.u[n] : (pr.u[n] = pr.gl.getUniformLocation(pr.p, n)));
function set(pr: Prog, n: string, v: number | number[] | Float32Array) {
  const gl = pr.gl, l = loc(pr, n);
  if (l == null) return;
  if (typeof v === 'number') gl.uniform1f(l, v);
  else if (v.length === 2) gl.uniform2fv(l, v);
  else if (v.length === 3) gl.uniform3fv(l, v);
  else if (v.length === 4) gl.uniform4fv(l, v);
  else gl.uniformMatrix4fv(l, false, v);
}
function mk(gl: WebGL2RenderingContext, vs: string, fs: string, bind?: (p: WebGLProgram) => void): Prog {
  const sh = (t: number, s: string) => {
    const x = gl.createShader(t)!;
    gl.shaderSource(x, s); gl.compileShader(x);
    if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) + '\n' + s.split('\n').map((l, i) => i + 1 + ' ' + l).join('\n'));
    return x;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  bind?.(p);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
  return { p, u: {}, gl };
}

// --- tray camera -----------------------------------------------------------------------------
const EL = 0.5, DIST = 7, SE = Math.sin(EL), CE = Math.cos(EL);
export function trayCam(W: number, H: number, cy: number) {
  const s = Math.min(W * 0.46, H * 0.27), F = s * DIST, cx = W / 2;
  const a = (2 * F) / W, b = (2 * F) / H, cxn = (2 * cx) / W - 1, cyn = 1 - (2 * cy) / H;
  const n = 0.5, f = 40, A = (f + n) / (f - n), B = (-2 * f * n) / (f - n);
  const rows = [
    [a, -cxn * SE, -cxn * CE, cxn * DIST],
    [0, b * CE - cyn * SE, -b * SE - cyn * CE, cyn * DIST],
    [0, -A * SE, -A * CE, A * DIST + B],
    [0, -SE, -CE, DIST],
  ];
  const vp = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) vp[c * 4 + r] = rows[r][c];
  const proj = (x: number, y: number, z: number): [number, number, number] => {
    const yc = CE * y - SE * z, zc = -SE * y - CE * z + DIST;
    return [cx + (F * x) / zc, cy - (F * yc) / zc, F / zc];
  };
  return { vp, proj, cam: [0, DIST * SE, DIST * CE] as [number, number, number] };
}

function trayMesh(): Float32Array {
  const v: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => v.push(...a, ...b, ...c);
  const S = 96, TAU = Math.PI * 2;
  const ring = (r: number, y: number, i: number) => [Math.sin((i / S) * TAU) * r, y, Math.cos((i / S) * TAU) * r];
  for (let i = 0; i < S; i++) {
    const j = i + 1;
    const nr = (k: number) => [Math.sin((k / S) * TAU), 0, Math.cos((k / S) * TAU)];
    // band
    const q = (r: number, y0: number, y1: number, kind: number, n0: number[], n1: number[]) => {
      const a = [...ring(r, y0, i), ...n0, kind], b = [...ring(r, y0, j), ...n1, kind], c = [...ring(r, y1, j), ...n1, kind], d = [...ring(r, y1, i), ...n0, kind];
      tri(a, b, c); tri(a, c, d);
    };
    q(1.07, -0.5, 0, 0, nr(i), nr(j));
    q(0.24, 0, 0.3, 2, nr(i), nr(j));
    const up = [0, 1, 0];
    const ann = (r0: number, r1: number, y: number, kind: number) => {
      const a = [...ring(r0, y, i), ...up, kind], b = [...ring(r0, y, j), ...up, kind], c = [...ring(r1, y, j), ...up, kind], d = [...ring(r1, y, i), ...up, kind];
      tri(a, b, c); tri(a, c, d);
    };
    ann(0.24, 1.07, 0, 1);
    ann(0, 0.24, 0.3, 2);
  }
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
    const f = (n: number[], p: number[][]) => { const m = p.map((q) => [...q, ...n, 3]); tri(m[0], m[1], m[2]); tri(m[0], m[2], m[3]); };
    f([0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]);
    f([0, 0, -1], [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]]);
    f([1, 0, 0], [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]]);
    f([-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]);
    f([0, 1, 0], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]);
  };
  box(-1.4, 1.4, -1.0, -0.5, -1.25, 1.4);
  return new Float32Array(v);
}

export function createGL(canvas: HTMLCanvasElement, nProd: number, nSlots: number, onLost: () => void) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('no webgl2');
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); onLost(); });
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  const bg = mk(gl, QVS, BG), proj = mk(gl, QVS, PROJ), beam = mk(gl, QVS, BEAM), comp = mk(gl, QVS, COMP), post = mk(gl, QVS, POST);
  const dust = mk(gl, DUST_VS, DUST_FS);
  const tray = mk(gl, TRAY_VS, TRAY_FS, (p) => { gl.bindAttribLocation(p, 0, 'aP'); gl.bindAttribLocation(p, 1, 'aN'); gl.bindAttribLocation(p, 2, 'aK'); });
  const slide = mk(gl, SL_VS, SL_FS);
  const vao0 = gl.createVertexArray()!;
  const mesh = trayMesh();
  const vaoT = gl.createVertexArray()!;
  gl.bindVertexArray(vaoT);
  const vb = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
  gl.bindVertexArray(vao0);
  const meshN = mesh.length / 7;

  // textures
  const tex: (WebGLTexture | null)[] = [];
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 6, 5, 255]));
  const atlas = gl.createTexture()!;
  const AS = 256;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlas);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 9, gl.RGBA8, AS, AS, nProd);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const cv = document.createElement('canvas'); cv.width = cv.height = AS;
  const cx2 = cv.getContext('2d', { willReadFrequently: true })!;
  const cv2 = document.createElement('canvas'); cv2.width = cv2.height = 16;
  const cx3 = cv2.getContext('2d', { willReadFrequently: true })!;
  const avgs: [number, number, number][] = [];

  function setTex(i: number, bmp: ImageBitmap) {
    const t = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, t);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, bmp);
    gl!.generateMipmap(gl!.TEXTURE_2D);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR_MIPMAP_LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    tex[i] = t;
    // atlas layer: cover crop, biased up for tall images (faces)
    const w = bmp.width, h = bmp.height, side = Math.min(w, h);
    cx2.drawImage(bmp, (w - side) / 2, (h - side) * 0.3, side, side, 0, 0, AS, AS);
    gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, atlas);
    gl!.texSubImage3D(gl!.TEXTURE_2D_ARRAY, 0, 0, 0, i, AS, AS, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, cv);
    gl!.generateMipmap(gl!.TEXTURE_2D_ARRAY);
    cx3.drawImage(bmp, 0, 0, 16, 16);
    const d = cx3.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0, ws = 0;
    for (let k = 0; k < d.length; k += 4) {
      const mx = Math.max(d[k], d[k + 1], d[k + 2]), mn = Math.min(d[k], d[k + 1], d[k + 2]);
      const wt = 0.25 + (mx - mn) / 255; // saturated pixels carry the colour
      r += d[k] * wt; g += d[k + 1] * wt; b += d[k + 2] * wt; ws += wt;
    }
    avgs[i] = [r / ws / 255, g / ws / 255, b / ws / 255];
  }

  // beam target
  let bw = 2, bh = 2, fbo: WebGLFramebuffer | null = null, bt: WebGLTexture | null = null;
  let W = 0, Hh = 0, dpr = 1;
  function resize(w: number, h: number, d: number) {
    W = w; Hh = h; dpr = d;
    canvas.width = Math.round(w * d); canvas.height = Math.round(h * d);
    bw = Math.max(2, Math.round(canvas.width / 2)); bh = Math.max(2, Math.round(canvas.height / 2));
    if (fbo) gl!.deleteFramebuffer(fbo);
    if (bt) gl!.deleteTexture(bt);
    bt = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, bt);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, bw, bh, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    fbo = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, bt, 0);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  const ND = 2400;
  const full = (pr: Prog) => { set(pr, 'uRes', [W, Hh]); set(pr, 'uBox', [0, 0, W, Hh]); };
  const strip = () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  function draw(F: Frame) {
    const T = F.still ? 0 : F.t;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.disable(gl!.DEPTH_TEST); gl!.disable(gl!.BLEND);
    gl!.bindVertexArray(vao0);
    // room
    gl!.useProgram(bg.p); full(bg);
    set(bg, 'uLight', F.light); set(bg, 'uProjI', F.projI); set(bg, 'uQ', F.quad); set(bg, 'uAvg', F.avg); set(bg, 'uHor', Hh * 0.625); set(bg, 'uTime', T);
    strip();
    // wall projection
    if (F.alpha > 0.001 && F.bright > 0.001) {
      gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA);
      gl!.useProgram(proj.p);
      const pad = 40 + Math.abs(F.dy);
      const x0 = Math.min(F.top[0], F.bot[0]) - pad, x1 = Math.max(F.top[1], F.bot[1]) + pad;
      set(proj, 'uRes', [W, Hh]); set(proj, 'uBox', [x0, F.top[2] - pad, x1, F.bot[2] + pad]);
      set(proj, 'uTop', F.top); set(proj, 'uBot', F.bot); set(proj, 'uTint', F.tint);
      for (const [k, v] of Object.entries({ uMix: F.mix, uBlur: F.blur, uBright: F.bright, uVig: F.vig, uFringe: F.fringe, uExpo: F.expo, uBloom: F.bloom, uDy: F.dy, uScale: F.scale, uAlpha: F.alpha, uFlick: F.flick, uSeed: F.seed, uTime: T })) set(proj, k, v);
      gl!.uniform1i(loc(proj, 'uA'), 0); gl!.uniform1i(loc(proj, 'uB'), 1);
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, tex[F.texA] ?? blank);
      gl!.activeTexture(gl!.TEXTURE1); gl!.bindTexture(gl!.TEXTURE_2D, tex[F.texB] ?? blank);
      strip();
      gl!.disable(gl!.BLEND);
    }
    // tray (3D)
    const cam = trayCam(W, Hh, F.trayCy);
    const gate: [number, number, number] = [0, 0.7, 1.2];
    if (F.trayCy < Hh + 200) {
      gl!.enable(gl!.DEPTH_TEST); gl!.depthMask(true); gl!.clear(gl!.DEPTH_BUFFER_BIT);
      const common = (pr: Prog) => {
        set(pr, 'uVP', cam.vp); set(pr, 'uCam', cam.cam); set(pr, 'uGate', gate); set(pr, 'uCol', F.tint); set(pr, 'uAvg', F.avg);
        set(pr, 'uPos', F.pos); set(pr, 'uN', nSlots); set(pr, 'uLit', F.projI * F.bright * 0.85 + 0.15 * F.projI); set(pr, 'uLight', F.light); set(pr, 'uFlick', F.flick);
      };
      gl!.useProgram(tray.p); common(tray);
      gl!.bindVertexArray(vaoT); gl!.drawArrays(gl!.TRIANGLES, 0, meshN);
      gl!.bindVertexArray(vao0);
      gl!.useProgram(slide.p); common(slide); set(slide, 'uP', nProd);
      gl!.uniform1i(loc(slide, 'uAtlas'), 2);
      gl!.activeTexture(gl!.TEXTURE2); gl!.bindTexture(gl!.TEXTURE_2D_ARRAY, atlas);
      gl!.enable(gl!.SAMPLE_ALPHA_TO_COVERAGE);
      gl!.drawArraysInstanced(gl!.TRIANGLE_STRIP, 0, 4, nSlots);
      gl!.disable(gl!.SAMPLE_ALPHA_TO_COVERAGE);
      gl!.disable(gl!.DEPTH_TEST);
    }
    // beam @ half res
    const dbg = (window as unknown as { __flags?: Record<string, boolean> }).__flags || {};
    if (F.beamGain > 0.002 && !dbg.nobeam) {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
      gl!.viewport(0, 0, bw, bh);
      gl!.useProgram(beam.p); full(beam);
      set(beam, 'uL', F.lens); set(beam, 'uTL', F.beamTL); set(beam, 'uTR', F.beamTR); set(beam, 'uR0', F.r0); set(beam, 'uTime', T);
      set(beam, 'uQ', F.quad); set(beam, 'uGain', F.beamGain); set(beam, 'uYT', F.vB); set(beam, 'uCol', F.tint);
      strip();
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.ONE, gl!.ONE);
      gl!.useProgram(comp.p); full(comp);
      gl!.uniform1i(loc(comp, 'uT'), 3); gl!.activeTexture(gl!.TEXTURE3); gl!.bindTexture(gl!.TEXTURE_2D, bt);
      strip();
      // dust
      gl!.useProgram(dust.p);
      set(dust, 'uRes', [W, Hh]); set(dust, 'uL', F.lens); set(dust, 'uTL', F.beamTL); set(dust, 'uTR', F.beamTR); set(dust, 'uR0', F.r0); set(dust, 'uYT', F.vB);
      set(dust, 'uTime', T); set(dust, 'uDpr', dpr); set(dust, 'uFade', F.dustFade); set(dust, 'uVel', F.vel); set(dust, 'uCol', F.tint);
      if (!dbg.nodust) gl!.drawArrays(gl!.POINTS, 0, ND);
      gl!.disable(gl!.BLEND);
    }
    // grain + vignette
    gl!.enable(gl!.BLEND); gl!.blendFunc(gl!.ONE, gl!.SRC_ALPHA);
    gl!.useProgram(post.p); full(post);
    set(post, 'uGrain', F.grain); set(post, 'uVig', F.vigPost); set(post, 'uLight', F.light); set(post, 'uTime', T);
    strip();
    gl!.disable(gl!.BLEND);
  }
  return { gl, gpu, resize, setTex, draw, avgs };
}
