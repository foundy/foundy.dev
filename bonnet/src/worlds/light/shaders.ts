// LIGHT world GLSL (ES 3.00). Pixel coordinates are y DOWN (css px) in the quad vertex shader.
// The photo texture is the shared 4:5 layer array (row 0 = photo top); every sample goes through a layer window
// so the projection can show just the photo on the wall and grow into the full padded frame of the DOM hero.
const C = `
float h11(float p){p=fract(p*.1031);p*=p+33.33;p*=p+p;return fract(p);}
float h21(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<4;i++){s+=a*vn(p);p=p*2.03+17.1;a*=.5;}return s;}
`;
const H = '#version 300 es\nprecision highp float;\nprecision highp sampler2DArray;\n';
export const QVS = `${H}uniform vec4 uBox;uniform vec2 uRes;out vec2 vPx;
void main(){vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));vec2 px=mix(uBox.xy,uBox.zw,c);vPx=px;gl_Position=vec4(px.x/uRes.x*2.-1.,1.-px.y/uRes.y*2.,0.,1.);}`;

export const BG = `${H}${C}in vec2 vPx;out vec4 o;uniform vec2 uRes;uniform float uLight,uProjI,uHor,uTime;uniform vec4 uQ;uniform vec3 uAvg,uPaper;
void main(){
  vec3 dark=vec3(.043,.035,.031);
  float dp=length(max(abs(vPx-uQ.xy)-uQ.zw,0.));
  float halo=exp(-dp/(.30*uRes.y))*.6+exp(-dp/(.07*uRes.y))*.7;
  vec3 c=dark*(.75+.25*(1.-vPx.y/uRes.y));
  c+=uAvg*halo*uProjI*.20*(.8+.5*fbm(vPx/70.));
  float fl=smoothstep(uHor-18.,uHor+60.,vPx.y);
  c+=uAvg*uProjI*fl*.07*exp(-abs(vPx.x-uRes.x*.5)/(uRes.x*.8));
  c+=.006*smoothstep(uHor-2.,uHor,vPx.y)*(1.-smoothstep(uHor,uHor+3.,vPx.y))*uProjI;
  o=vec4(mix(c,uPaper,uLight),1.);}`;

export const PROJ = `${H}${C}in vec2 vPx;out vec4 o;
uniform vec3 uTop,uBot,uTint;uniform sampler2DArray uA;uniform vec4 uWin;uniform float uLayer,uRad;
uniform float uBlur,uBright,uVig,uFringe,uExpo,uBloom,uDy,uScale,uAlpha,uFlick,uSeed,uTime;
vec2 W(vec2 uv){return mix(uWin.xy,uWin.zw,uv);}
vec3 smp(vec2 uv,float lod,float r){
  if(uBlur<.003) return texture(uA,vec3(W(uv),uLayer),-.7*(1.-uVig)).rgb;
  vec3 a=vec3(0.);
  for(int i=0;i<10;i++){float fi=float(i);float ang=fi*2.39996;float rad=sqrt((fi+.5)/10.)*r;a+=textureLod(uA,vec3(W(uv+vec2(cos(ang),sin(ang))*rad),uLayer),lod).rgb;}
  return a*.1;}
void main(){
  vec2 P=vPx-vec2(0.,uDy);
  float v=(P.y-uTop.z)/(uBot.z-uTop.z);
  float xl=mix(uTop.x,uBot.x,v),xr=mix(uTop.y,uBot.y,v);
  float u=(P.x-xl)/(xr-xl);
  float wpx=xr-xl,hpx=uBot.z-uTop.z;
  vec2 e=vec2(min(u,1.-u)*wpx,min(v,1.-v)*hpx);
  // rounded corners grow in as the projection lands on the DOM hero
  vec2 qc=vec2(uRad)-e;
  float ed=(qc.x>0.&&qc.y>0.)?uRad-length(qc):min(e.x,e.y);
  float m=smoothstep(-.5,.9+uVig*3.,ed);
  if(m<=0.){o=vec4(0.);return;}
  vec2 c=vec2(u,v)-.5;
  vec2 uv=.5+c/uScale;
  float rr=length(c*vec2(1.,hpx/wpx)*1.5);
  float lod=uBlur*3.2, br=uBlur*.016;
  vec2 fo=c*.010*uFringe*pow(length(c)*2.,2.);
  vec3 col;
  if(uFringe>.001){col=vec3(smp(uv+fo,lod,br).r,smp(uv,lod,br).g,smp(uv-fo,lod,br).b);}
  else col=smp(uv,lod,br);
  if(uBloom>.001){vec3 bl=textureLod(uA,vec3(W(uv),uLayer),5.2).rgb;
    vec3 hi=max(bl-vec3(.6),0.);col+=hi*uBloom*.55;}
  float vg=1.-uVig*.82*smoothstep(.22,1.05,rr);
  col*=vg*(1.+.05*uVig*(1.-rr));
  col=mix(col,1.-exp(-col*1.7),uVig*.85);
  col*=mix(vec3(1.),vec3(1.05,.975,.89)*uTint*.5+.5,uVig*.6);
  col=mix(col,(col-.5)*1.1+.5,uVig);
  float gr=vn(vec2(u,v)*vec2(wpx,hpx)*.9)-.5;col*=1.+gr*.07*uVig;
  for(int i=0;i<4;i++){float fi=float(i)+uSeed*7.;vec2 sp=vec2(h11(fi*3.1),h11(fi*7.7+2.));float sz=.004+.006*h11(fi*1.9);
    col*=1.-.25*uVig*smoothstep(sz,0.,length((vec2(u,v)-sp)*vec2(1.,hpx/wpx)));}
  col*=uExpo*uBright*(1.+uFlick);
  o=vec4(col,m*uAlpha);}`;

export const TRAY_VS = `${H}uniform mat4 uVP;in vec3 aP;in vec3 aN;in float aK;out vec3 vP;out vec3 vN;out float vK;
void main(){vP=aP;vN=aN;vK=aK;gl_Position=uVP*vec4(aP,1.);}`;
export const TRAY_FS = `${H}${C}in vec3 vP;in vec3 vN;in float vK;out vec4 o;
uniform vec3 uCam,uGate,uCol,uAvg;uniform float uPos,uN,uLit,uLight,uFlick;
void main(){
  vec3 N=normalize(vN),V=normalize(uCam-vP);
  float r=length(vP.xz),ang=atan(vP.x,vP.z),s=ang/(6.2831853/uN)+uPos;
  float fs=abs(fract(s)-.5);
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
  c*=mix(.42,1.,smoothstep(-.85,.45,vP.z)); // the rear half of the tray falls into the dark: less clutter behind the front row
  c*=1.+3.*uLight;
  o=vec4(c,1.);}`;

export const SL_VS = `${H}uniform mat4 uVP;uniform float uPos,uN;
out vec2 vUV;out vec3 vW;out vec3 vNr;out float vGate;out float vFront;flat out int vLayer;
void main(){
  float i=float(gl_InstanceID);float a=6.2831853/uN;
  float ph=(i-uPos)*a;ph-=6.2831853*floor((ph+3.14159265)/6.2831853);
  float gw=exp(-pow(ph/(.55*a),2.));
  vec2 c=vec2(float(gl_VertexID&1),float((gl_VertexID>>1)&1));
  float hw=.235,hh=.47,lift=.015+.17*gw;
  vec3 rad=vec3(sin(ph),0.,cos(ph));vec3 T=vec3(cos(ph),0.,-sin(ph));
  vec3 p=rad*(1.+.02*gw)+T*(c.x*2.-1.)*hw+vec3(0.,lift+c.y*hh,0.);
  p+=rad*(c.y*hh)*(.05-.07*gw);
  vUV=vec2(c.x,1.-c.y);vW=p;vNr=rad;vGate=gw;vFront=cos(ph);vLayer=gl_InstanceID;
  gl_Position=uVP*vec4(p,1.);}`;
export const SL_FS = `${H}${C}in vec2 vUV;in vec3 vW;in vec3 vNr;in float vGate;in float vFront;flat in int vLayer;out vec4 o;
uniform sampler2DArray uAtlas;uniform vec3 uCam,uGate,uCol,uAvg;uniform float uLit,uLight,uFlick;uniform vec4 uAp[32];
void main(){
  vec2 p=vUV-.5;vec2 q=abs(p)-(.5-.07);float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-.07;
  float aa=max(fwidth(sd),1e-4);float cov=smoothstep(aa*.5,-aa*.5,sd);
  if(cov<.5){discard;}
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
  vec2 ap=p/.66;float am=max(abs(ap.x),abs(ap.y));
  if(am<.5){
    float inner=smoothstep(.5,.455,am);
    vec4 W=vLayer<32?uAp[vLayer]:vec4(0.,0.,1.,1.);
    vec3 img=texture(uAtlas,vec3(mix(W.xy,W.zw,ap+.5),float(vLayer))).rgb;
    float em=.26+.95*gw+.34*att;
    // only the front face carries the picture; the back of a slide is a plain dark mount
    vec3 w=fr?img*em:alb*lightC*.30*(.75+.25*vUV.y);
    float sheen=smoothstep(.05,.0,abs(ap.x*.8+ap.y*.6-.1-.35*sin(uFlick*8.)))*.10;
    w+=uCol*sheen*att*(fr?1.:0.);
    col=mix(vec3(.01),w,inner);
    col=mix(col,vec3(.0),(1.-inner)*.8);
  }
  col*=mix(.40,1.,smoothstep(-.1,.55,vFront)); // rear slides recede
  col*=1.+3.*uLight;
  o=vec4(col,smoothstep(.5,1.,cov));}`;

export const BEAM = `${H}${C}in vec2 vPx;out vec4 o;
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
export const COMP = `${H}in vec2 vPx;out vec4 o;uniform sampler2D uT;uniform vec2 uRes;
void main(){o=vec4(texture(uT,vec2(vPx.x,uRes.y-vPx.y)/uRes).rgb,1.);}`;

export const DUST_VS = `${H}${C}uniform vec2 uL,uTL,uTR,uRes;uniform float uTime,uDpr,uFade,uVel,uR0,uYT;out float vA;out float vSoft;
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
export const DUST_FS = `${H}in float vA;in float vSoft;out vec4 o;uniform vec3 uCol;
void main(){float d=length(gl_PointCoord-.5)*2.;float c=smoothstep(1.,mix(.5,-.2,vSoft),d);o=vec4(uCol*vA*c*.9,1.);}`;

export const POST = `${H}${C}in vec2 vPx;out vec4 o;uniform vec2 uRes;uniform float uGrain,uVig,uLight,uTime;
void main(){
  vec2 q=(vPx/uRes-.5);q.x*=uRes.x/uRes.y*.75;
  float av=smoothstep(.2,.95,length(q)*1.5)*uVig;
  float fr=floor(uTime*24.);
  float n=h21(floor(vPx/1.4)+vec2(fr*37.,fr*17.));n=max(n-.5,0.)*2.;
  float k=uGrain*(1.-uLight);
  o=vec4(vec3(n*k*.034),1.-av*(1.-uLight));}`;
