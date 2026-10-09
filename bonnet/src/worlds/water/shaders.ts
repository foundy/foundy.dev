// All GLSL ES 3.00. Coordinates inside the shaders are y-UP (GL convention); main.ts flips CSS y before uploading.

export const VERT = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1., 0., 1.); }`;

const PACK = `
#ifdef FLOATTEX
vec2 dec(vec4 t){ return t.xy; }
vec4 enc(vec2 s){ return vec4(s, 0., 1.); }
#else
vec2 dec(vec4 t){ vec4 b = floor(t*255.+.5); return (vec2(b.r*256.+b.g, b.b*256.+b.a) - 32768.)/32767.; }
vec4 enc(vec2 s){ vec2 u = floor(clamp(s,-1.,1.)*32767.+.5)+32768.; vec2 hi = floor(u/256.); vec2 lo = u-hi*256.; return vec4(hi.x, lo.x, hi.y, lo.y)/255.; }
#endif`;

// wave equation on a height field: state = (h, v). Drops/rect sources are velocity impulses.
export const SIM = `#version 300 es
precision highp float;
${PACK}
uniform sampler2D uState; uniform vec2 uSize;
uniform float uC2, uDamp;
uniform int uN; uniform vec4 uDrops[16];
uniform vec4 uRect; uniform vec4 uRectP; // rect: cx cy hw hh (cells) ; P: inside, ring, soft, radius
out vec4 o;
float H(ivec2 p){ return dec(texelFetch(uState, clamp(p, ivec2(0), ivec2(uSize)-1), 0)).x; }
float sdR(vec2 p, vec2 hs, float r){ vec2 q = abs(p)-hs+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec2 s = dec(texelFetch(uState, p, 0));
  float h = s.x;
  float lap = H(p+ivec2(1,0))+H(p-ivec2(1,0))+H(p+ivec2(0,1))+H(p-ivec2(0,1))-4.*h;
  float v = s.y + uC2*lap;
  vec2 fp = vec2(p)+.5;
  float e = min(min(fp.x, fp.y), min(uSize.x-fp.x, uSize.y-fp.y));
  v *= uDamp * mix(.93, 1., smoothstep(0., 12., e));
  for (int i=0;i<16;i++){
    if (i>=uN) break;
    vec4 d = uDrops[i];
    float r = length(fp-d.xy)/d.z;
    if (r<1.){ float b = .5+.5*cos(3.14159265*r); v += d.w*b*b; }
  }
  if (uRect.z>0.){
    float sd = sdR(fp-uRect.xy, uRect.zw, uRectP.w);
    v += uRectP.x*(1.-smoothstep(-uRectP.z, uRectP.z, sd)) + uRectP.y*exp(-(sd*sd)/(uRectP.z*uRectP.z));
  }
  h += v + .012*lap;
  h = clamp(h, -.3, .3); v = clamp(v, -.12, .12);
#ifdef FLOATTEX
  if (abs(h)<2e-5 && abs(v)<2e-5){ h = 0.; v = 0.; }
#endif
  o = enc(vec2(h, v));
}`;

// derived surface: slope.xy, height, laplacian (bilinear-filterable)
export const DERIVE = `#version 300 es
precision highp float;
${PACK}
uniform sampler2D uState; uniform vec2 uSize;
out vec4 o;
float H(ivec2 p){ return dec(texelFetch(uState, clamp(p, ivec2(0), ivec2(uSize)-1), 0)).x; }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  float h = H(p);
  float hl=H(p-ivec2(1,0)), hr=H(p+ivec2(1,0)), hd=H(p-ivec2(0,1)), hu=H(p+ivec2(0,1));
  vec2 g = vec2(hr-hl, hu-hd)*.5;
  float lap = hl+hr+hd+hu-4.*h;
#ifdef FLOATTEX
  o = vec4(g, h, lap);
#else
  o = clamp(vec4(g*24., h*2., lap*24.)*.5+.5, 0., 1.);
#endif
}`;

export const RENDER = `#version 300 es
precision highp float; precision highp sampler2DArray;
uniform sampler2D uSurf; uniform sampler2DArray uProd;
uniform vec2 uRes; uniform float uPx, uTime, uSeed;
uniform float uS, uSv, uP, uSlopeK, uLapK, uLayerW, uHeroRad, uPoolRad, uRestZ, uSpacing, uDith, uTilt, uGrab;
uniform int uN, uCur;
uniform vec3 uInk[8];
uniform vec3 uTone, uBgInk;
uniform vec4 uPool, uHero;   // cx cy w h  (css px, y up)
out vec4 fragColor;

float hash(vec2 p){ p = fract(p*vec2(.1031,.1030)); p += dot(p, p.yx+33.33); return fract((p.x+p.y)*p.x); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+1.),f.x), f.y); }
float sdR(vec2 p, vec2 hs, float r){ vec2 q = abs(p)-hs+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
float box(vec2 p, vec2 c, vec2 s, float soft){ vec2 d=abs(p-c)-s; float sd=length(max(d,0.))+min(max(d.x,d.y),0.); return 1.-smoothstep(-soft,soft,sd); }

// procedural studio: large soft boxes + strips. a = reflected direction projected on a plane (y up)
vec3 env(vec2 a){
  vec3 c = vec3(.020,.050,.072) + vec3(.020,.045,.065)*(.5+.5*a.y);
  c += vec3(1.00,.95,.88)*box(a, vec2(-.30,.40), vec2(.10,.24), .11)*1.35;   // key softbox
  c += vec3(.55,.78,1.0)*box(a, vec2(.21,.05), vec2(.022,.9), .035)*1.15;    // cool strip
  c += vec3(1.0,.86,.7)*box(a, vec2(.0,-.43), vec2(.42,.028), .04)*.95;      // warm floor strip
  c += vec3(.8,.9,1.)*box(a, vec2(.12,.62), vec2(.20,.04), .06)*.8;          // top fill
  c += vec3(.30,.55,.62)*box(a, vec2(-.05,-.1), vec2(.35,.08), .3)*.30;      // wide soft
  c += vec3(.45,.7,.8)*(.5+.5*sin(a.x*9.+a.y*5.))*.035;                      // faint roll-off banding
  return c;
}

float flowCaustic(vec2 uv, float t){
  vec2 p = mod(uv*6.28318530718, 6.28318530718)-250.;
  vec2 i = p; float c = 1.; float inten = .005;
  for (int n=0;n<5;n++){
    float tt = t*(1.-(3.5/float(n+1)));
    i = p + vec2(cos(tt-i.x)+sin(tt+i.y), sin(tt-i.y)+cos(tt+i.x));
    c += 1./length(vec2(p.x/(sin(i.x+tt)/inten), p.y/(cos(i.y+tt)/inten)));
  }
  c /= 5.; c = 1.17-pow(c,1.4);
  return clamp(pow(abs(c),8.), 0., 1.6);
}

vec4 surfAt(vec2 px){
  vec4 s = texture(uSurf, px/uRes);
#ifndef FLOATTEX
  s = (s-.5)*2.; s.xy /= 24.; s.z /= 2.; s.w /= 24.;
#endif
  return s;
}

float causticAt(vec2 px, vec2 slope, float lap, float flowA){
  vec4 S2 = surfAt(px - slope*60.);
  float lap2 = S2.w*uLapK;
  float x = -(lap*.45+lap2*.55);
  float c = clamp(1. + 1.15*tanh(x*1.1), .22, 2.2);
  if (flowA>.001){
    float pc = flowCaustic(px/uRes.y*1.6 + vec2(uS*.9,0.), uTime*.8);
    c *= mix(1., clamp(.55+pc*.9,.45,1.8), flowA*.8);
  }
  return c;
}

// geometry of product i: centre, half-size, radius, depth in px, alpha, in-plane tilt, yaw.
// x is EXACTLY (i - s) * spacing: the product under the finger moves 1:1 with it (s = s0 - dx / spacing while dragging).
// Depth, scale, blur and yaw are functions of |i - s| only: the next product rises as the current one is dragged away.
void geom(int i, out vec2 c, out vec2 hs, out float rad, out float z, out float al, out float ang, out float yaw){
  float d = float(i)-uS; float ad = abs(d);
  float nearW = 1.-smoothstep(0., 1., ad);
  z = uRestZ - 8.*uGrab*nearW + 300.*(1.-exp(-ad*1.15));
  float sc = 1./(1.+z*.0011);
  c = vec2(uPool.x + d*uSpacing, uPool.y + (1.-sc)*uPool.w*.35);
  hs = .5*uPool.zw*sc; rad = uPoolRad*sc;
  al = 1.;
  ang = (-.42*d + uTilt)*nearW;
  yaw = clamp(d, -1.4, 1.4)*.30;
  if (i==uCur && uP>0.){
    float g = uP*uP*(3.-2.*uP);
    c = mix(c, uHero.xy, g); hs = mix(hs, .5*uHero.zw, g); rad = mix(rad, uHeroRad, g);
    z *= 1.-smoothstep(0.,.32,uP);
    ang *= 1.-g; yaw *= 1.-g;
  }
}

// the shared layer array has row 0 = photo TOP; this shader works y-up, so flip here
vec3 prodTex(vec2 uv, int i, float lod){ return textureLod(uProd, vec3(clamp(uv.x,0.003,0.997), 1.-clamp(uv.y,0.003,0.997), float(i)), lod).rgb; }

vec4 sub(int i, vec2 px, vec2 slope, float flowA, float C){
  vec2 c, hs; float rad, z, al, ang, yaw; geom(i, c, hs, rad, z, al, ang, yaw);
  vec2 q = px - slope*z*1.8;
  if (flowA>.001) q += (vec2(vn(px*.021+uTime*.5), vn(px*.019-uTime*.4))-.5)*flowA*10.;
  // plane coordinates: undo the in-plane tilt, then the yaw foreshortening (outer edges recede)
  vec2 r = q-c;
  float ca = cos(ang), sa = sin(ang);
  r = vec2(ca*r.x + sa*r.y, -sa*r.x + ca*r.y);
  float sy = sin(yaw), cy = cos(yaw);
  float xp = r.x/(cy - r.x*sy/1100.);
  vec2 rp = vec2(xp, r.y*(1.+xp*sy/1100.));
  float soft = .75 + z*.022;
  float sd = sdR(rp, hs, rad);
  float m = 1.-smoothstep(-soft, soft, sd);
  if (m<=.001 || al<=.001) return vec4(0);
  vec2 uv = rp/(2.*hs)+.5;
  float t = 1.-exp(-z/170.);
  float lod = max(0., log2(uLayerW/(2.*hs.x*uPx))-.75) + t*4.2 + flowA*1.1;
  vec3 tex;
  float sl = length(slope);
  if (sl>.035 && z<120.){
    vec2 dd = normalize(slope+1e-5)*sl*z*.5/(2.*hs);
    tex = vec3(prodTex(uv+dd,i,lod).r, prodTex(uv,i,lod).g, prodTex(uv-dd,i,lod).b);
  } else if (flowA>.12){
    vec2 sm = vec2(uSv*9./(2.*hs.x), 0.);
    tex = (prodTex(uv-sm,i,lod)+prodTex(uv,i,lod)*2.+prodTex(uv+sm,i,lod))*.25;
  } else tex = prodTex(uv,i,lod);
  vec3 ink = uInk[i];
  vec3 deep = mix(vec3(.012,.04,.06), ink*.30, .35);
  tex *= mix(vec3(1.), vec3(.50,.70,.95), t);
  tex = mix(tex, deep, pow(t,1.25)*.88);
  float near = 1.-t;
  float ein = -sd;
  tex *= mix(.74, 1., smoothstep(0., 26., ein));
  // depth cue: far neighbours fall off toward the dark edges of the pool and lose the near product's sparkle
  tex *= 1.-.32*t*smoothstep(.15,.62,abs(px.x-uPool.x)/uRes.x);
  tex += vec3(.9,.97,1.)*exp(-pow((ein-1.6)/1.7,2.))*.22*near*(.35+.65*smoothstep(-.4,.9,rp.y/hs.y));
  tex *= 1.+(C-1.)*(.42*near+.12);
  tex += vec3(.8,.95,1.)*max(C-1.3,0.)*.10*near;
  return vec4(tex, m*al);
}

float lanes(vec2 uv){ float l = vn(vec2(uv.x*13.,7.7)); float r = smoothstep(.5,.78,l); return r*(.55+.45*vn(vec2(uv.x*13.,uv.y*2.2-uP*2.6))); }
float wetAt(vec2 uv){ float th = .40+.36*(1.-uv.y)+.20*lanes(uv)-.02; float w = 1.-smoothstep(th-.07, th, uP); return w*(1.-smoothstep(.965,1.,uP)); }
float thick(vec2 uv){ float e = min(min(uv.x,1.-uv.x), min(uv.y,1.-uv.y)); return wetAt(uv)*(.5+.5*lanes(uv)+1.1*smoothstep(.08,0.,e)); }

void main(){
  vec2 fc = gl_FragCoord.xy;
  vec2 px = fc/uPx;
  vec4 S = surfAt(px);
  vec2 slope = S.xy*uSlopeK;
  slope /= 1.+1.6*length(slope);
  float lap = S.w*uLapK;
  float sl = length(slope);
  vec3 N = normalize(vec3(-slope, 1.));
  float flowA = min(abs(uSv)*.5, 1.);
  float C = causticAt(px, slope, lap, flowA);

  // ---- floor of the pool
  vec2 rel = (px-uPool.xy)/uRes.y;
  float glow = exp(-dot(rel,rel)*2.2);
  float vig = 1.-.55*smoothstep(.15,.95,length(rel*vec2(1.,.62)));
  vec3 col = (vec3(.006,.030,.046)*(.35+1.5*glow) + uBgInk*.035*glow)*vig*(.6+.5*C);
  {
    // static caustic web on the pool floor: invisible-ish at rest, bent hard by every ripple
    vec2 fq = px - slope*300.;
    float web = flowCaustic(fq/uRes.y*1.5 + vec2(.17,.3), 2.3);
    col += vec3(.16,.42,.50)*web*.16*(.35+glow)*vig;
  }
  {
    vec2 hc, hhs; float hr, hz, ha, ha2, hy; geom(clamp(int(floor(uS+.5)),0,uN-1), hc, hhs, hr, hz, ha, ha2, hy);
    float hd = max(sdR(px-hc, hhs, hr), 0.);
    float satk = 1.6;
    vec3 hi = uBgInk; float hl = dot(hi, vec3(.33)); hi = clamp(vec3(hl)+(hi-vec3(hl))*satk, 0., 1.);
    col += hi*(exp(-hd/46.)*.20 + exp(-hd/150.)*.10)*(.7+.4*C)*(1.-smoothstep(.0,.35,uP));
  }

  // ---- submerged products, farthest first
  int b = int(floor(uS+.5));
  int ord[5] = int[5](-2,2,-1,1,0);
  float cover = 0.;
  for (int k=0;k<5;k++){
    int i = b+ord[k];
    if (i<0 || i>=uN) continue;
    vec4 L = sub(i, px, slope, flowA, C);
    col = mix(col, L.rgb, L.a);
    cover = max(cover, L.a*(1.-smoothstep(0.,.6,abs(float(i)-uS))));
  }

  // ---- water surface: glossy reflection of the studio
  vec2 a = (px-uRes*.5)/(uRes.y*.85) ;
  vec2 ra = a*.8 + slope*2.2;
  vec3 E = env(ra);
  float F = (.12 + .28*pow(clamp(sl*2.4,0.,1.), 1.2))*(1.-.55*cover);
  vec3 spec = vec3(0.);
  vec3 V = vec3(0,0,1);
  vec3 L1 = normalize(vec3(-.40,.55,.72)), L2 = normalize(vec3(.62,.20,.60));
  spec += vec3(1.,.97,.92)*pow(max(dot(N,normalize(L1+V)),0.), 260.)*2.2;
  spec += vec3(.75,.88,1.)*pow(max(dot(N,normalize(L2+V)),0.), 200.)*1.4;
  spec += vec3(1.,.95,.9)*pow(max(dot(N,normalize(L1+V)),0.), 90.)*.18;
  // surface film: dust sparkle + faint iridescence on slopes
  vec2 dcell = px/3.2; vec2 dfr = fract(dcell)-.5;
  float dh = hash(floor(dcell));
  float dust = smoothstep(.9965,1.,dh)*smoothstep(.5,.0,length(dfr))*(.25+dot(E,vec3(.33)))*(.4+sl*4.);
  vec3 iri = .5+.5*cos(6.2831*(vec3(0.,.33,.67)+S.z*60.+a.x*.6));
  vec3 refl = E*F + iri*smoothstep(.02,.25,sl)*dot(E,vec3(.33))*.06 + dust*vec3(.7,.85,1.)*.28;
  vec3 water = col*(1.-F*.6) + refl + spec;

  // ---- rise: product leaves the water
  vec3 outc = water;
  if (uP>.0){
    vec2 c, hs; float rad, z, al, ang0, yaw0; geom(uCur, c, hs, rad, z, al, ang0, yaw0);
    float lift = smoothstep(.2,.7,uP);
    // calm bright surface spreading from the product
    float dist = length(px-c)/length(uRes);
    float front = mix(-.1, 1.7, smoothstep(.3,.98,uP));
    float calm = 1.-smoothstep(front-.45, front, dist);
    if (uP>.985) calm = 1.;
    vec3 calmCol = uTone + (spec*.12 + dust*.02)*(1.-smoothstep(.9,1.,uP));
    // thin bright meniscus where the calm front passes
    float rim = exp(-pow((dist-(front-.22))/.02,2.))*(1.-calm)*.0;
    outc = mix(water, calmCol, calm) + rim;
    // shadow of the product on the water
    float sd = sdR(px-c-vec2(0.,-14.*lift), hs, rad);
    float sh = (1.-smoothstep(-4., 16.+22.*lift, sd))*mix(.42,.16,calm)*lift*(1.-smoothstep(.8,1.,uP));
    outc *= 1.-sh;
    // product
    float sdm = sdR(px-c, hs, rad);
    float m = 1.-smoothstep(-.6,.6,sdm);
    if (m>.001){
      vec2 uv = (px-c)/(2.*hs)+.5;
      float ee = .006;
      float T0 = thick(uv);
      vec2 grad = vec2(thick(uv+vec2(ee,0.))-thick(uv-vec2(ee,0.)), thick(uv+vec2(0.,ee))-thick(uv-vec2(0.,ee)))/(2.*ee);
      float wet = wetAt(uv);
      vec2 off = -grad*.0020;
      // beads of water that slide down: clean lenses with a bright spec, no dirty rims
      float dropHi = 0.; float dropDark = 0.;
      for (int k=0;k<6;k++){
        float fk = float(k)+uSeed;
        float x0 = .12+.76*hash(vec2(fk,1.3)), y0 = .88-.4*hash(vec2(fk,2.7));
        float ts = .40+.20*hash(vec2(fk,5.1)), sp = .45+.7*hash(vec2(fk,8.9));
        float r = .013+.012*hash(vec2(fk,3.3));
        float dy = max(uP-ts,0.)*sp*(1.1+2.4*(uP-ts));
        vec2 dp = vec2(x0+.015*sin(dy*12.+fk), y0-dy);
        vec2 dv = (uv-dp)*vec2(.8,1.)/r;
        float dl = length(dv);
        float on = step(ts,uP)*smoothstep(.97,.88,uP)*smoothstep(-.02,.1,dp.y)*smoothstep(.0,.35,wetAt(dp)+.001);
        if (dl<1. && on>0.){
          float zc = sqrt(1.-dl*dl);
          off += -dv*.55*r*(1.-dl)*on;
          dropHi += pow(max(dot(normalize(vec3(dv,zc)), normalize(vec3(-.5,.6,.65))),0.), 22.)*on;
          dropDark += smoothstep(.6,1.,dl)*.16*on;
        }
      }
      vec2 fuv = uv+off;
      float lod = max(0., log2(uLayerW/(2.*hs.x*uPx))-.75);
      vec3 tex = prodTex(fuv, uCur, lod);
      // wet look: a little deeper and richer
      float lum = dot(tex, vec3(.3,.6,.1));
      tex = mix(tex, mix(vec3(lum), tex, 1.18)*.86, wet*.8);
      tex *= 1.-dropDark;
      // studio sheen on the film (slopes from the thickness gradient)
      vec2 fs = -grad*.012;
      vec2 ra2 = (px-uRes*.5)/(uRes.y*.85)*.8 + fs*2.2;
      tex += env(ra2)*wet*.16*(.4+.6*smoothstep(.05,.5,T0)) + dropHi*.85*vec3(1.,.98,.95);
      // thin bright meniscus at the drying front
      float th0 = .40+.36*(1.-uv.y)+.20*lanes(uv)-.02;
      tex += vec3(1.)*exp(-pow((uP-th0+.03)/.014,2.))*.10*step(.3,uP)*(1.-smoothstep(.95,1.,uP));
      float shown = smoothstep(.26,.36,uP);
      outc = mix(outc, tex, m*shown);
      // keep cross-fade seamless: submerged copy still visible below shown
    }
  }

  // ---- finish: vignette-free, dithered
  if (uDith>0.) outc += (hash(fc+uSeed*17.)-.5)/255.*1.6;
  fragColor = vec4(outc, 1.);
}`;
