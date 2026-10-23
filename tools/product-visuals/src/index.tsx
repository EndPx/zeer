import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Composition, Easing, Img, continueRender, delayRender, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import sample from './sample.json';

const C={ink:'#0b1010',panel:'#111b16',raised:'#1a281f',stroke:'#34473b',paper:'#f3f1e7',sage:'#a0b09f',lime:'#c6ff42'};
const ease=Easing.bezier(.22,1,.36,1);
const tween=(f:number,a:number,b:number,x=0,y=1)=>interpolate(f,[a,b],[x,y],{easing:ease,extrapolateLeft:'clamp',extrapolateRight:'clamp'});
const pos=(x:number,y:number,w?:number,h?:number):React.CSSProperties=>({position:'absolute',left:x,top:y,width:w,height:h});
const mono={fontFamily:'Mono, monospace'};

function Stage({children}:{children:React.ReactNode}){
 const {width,height}=useVideoConfig(),scale=width/1280;
 const [fontHandle]=useState(()=>delayRender('Product illustration fonts'));
 useEffect(()=>{document.fonts.ready.then(()=>continueRender(fontHandle));},[fontHandle]);
 return <AbsoluteFill style={{background:C.ink,color:C.paper,fontFamily:'Manrope, sans-serif',overflow:'hidden'}}>
  <style>{`@font-face{font-family:Manrope;src:url('${staticFile('manrope.woff2')}');font-weight:200 800}@font-face{font-family:Mono;src:url('${staticFile('mono.woff2')}')}*{box-sizing:border-box}`}</style>
  <div style={{...pos(0,(height-720*scale)/2,1280,720),transform:`scale(${scale})`,transformOrigin:'top left',background:'radial-gradient(ellipse at 35% 0%, #28402b66, transparent 64%)'}}>
   <svg width={1280} height={720} style={pos(0,0)}><defs><pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#5a7b5020" strokeWidth=".6"/></pattern><linearGradient id="gridFade" x2="0" y2="1"><stop stopColor="white" stopOpacity=".5"/><stop offset="1" stopColor="white" stopOpacity="0"/></linearGradient><mask id="gridMask"><rect width="1280" height="720" fill="url(#gridFade)"/></mask></defs><rect width="1280" height="720" fill="url(#grid)" mask="url(#gridMask)"/></svg>
   {children}
  </div>
 </AbsoluteFill>;
}
function Brand({product}:{product?:string}){
 return <div style={{...pos(64,38,1152),display:'flex',alignItems:'center',gap:13}}><Img src={staticFile('zeer.svg')} style={{width:54,height:54}}/><span style={{fontSize:39,fontWeight:750,letterSpacing:-2}}>zeer</span>{product&&<><span style={{margin:'0 9px',color:C.stroke,fontSize:30}}>/</span><span style={{fontSize:29,fontWeight:550}}>{product}</span></>}<span style={{...mono,marginLeft:'auto',fontSize:16,letterSpacing:1.8,color:C.sage}}>ZCASH · TESTNET DEVELOPER PREVIEW</span></div>;
}
function Footer({children}:{children:React.ReactNode}){return <div style={{...pos(64,663,1152),...mono,fontSize:16,color:C.sage,borderTop:`1px solid ${C.stroke}`,paddingTop:17}}>{children}</div>;}
function Title({children}:{children:React.ReactNode}){return <h1 style={{...pos(64,127,1150),fontSize:60,lineHeight:1.08,letterSpacing:-3.1,fontWeight:650,margin:0}}>{children}</h1>;}
function Plate({label,children,x,y,w,h,active=false}:{label:string,children:React.ReactNode,x:number,y:number,w:number,h:number,active?:boolean}){
 return <div style={{...pos(x,y,w,h),border:`1px solid ${active?'#789847':C.stroke}`,borderRadius:20,overflow:'hidden',background:'linear-gradient(140deg,#1a281f,#0f1913)',boxShadow:'0 18px 40px #0004,inset 0 1px #e4ffcd14'}}><div style={{...mono,display:'flex',alignItems:'center',gap:10,fontSize:16,letterSpacing:.8,padding:'17px 23px',borderBottom:`1px solid ${C.stroke}`,color:C.sage}}><span style={{width:5,height:5,background:active?C.lime:'#6b8265',borderRadius:1}}/>{label}</div><div style={{padding:24}}>{children}</div></div>;
}
function Wire({x1,y1,x2,y2,start}:{x1:number,y1:number,x2:number,y2:number,start:number}){
 const f=useCurrentFrame(),p=tween(f,start,start+22),len=Math.hypot(x2-x1,y2-y1),q=(f-start-5)/28;
 return <svg width={1280} height={720} style={{...pos(0,0),pointerEvents:'none'}}><path d={`M${x1} ${y1}L${x2} ${y2}`} stroke={C.stroke} strokeWidth={2}/><path d={`M${x1} ${y1}L${x2} ${y2}`} stroke={C.lime} strokeWidth={2} strokeDasharray={len} strokeDashoffset={len*(1-p)}/>{q>0&&q<1&&<rect x={x1+(x2-x1)*q-4} y={y1+(y2-y1)*q-4} width={8} height={8} rx={2} fill={C.lime}/>}<path d={`M${x2-8} ${y2-5}L${x2} ${y2}L${x2-8} ${y2+5}`} stroke={p>.98?C.lime:C.stroke} strokeWidth={2} fill="none"/></svg>;
}
function ProductNode({x,w,name,tag,line,start}:{x:number,w:number,name:string,tag:string,line:string,start:number}){
 const f=useCurrentFrame(),p=tween(f,start,start+18);
 return <div style={{...pos(x,426,w,164),padding:'20px 21px',borderRadius:20,border:`1px solid ${p>.45?'#789847':C.stroke}`,background:'linear-gradient(140deg,#243821,#101b14)',boxShadow:'inset 0 1px #d8f7bd1c,0 20px 35px #0004',transform:`translateY(${(1-p)*7}px)`}}><div style={{...mono,fontSize:14,letterSpacing:1.2,color:C.sage}}>{tag}</div><div style={{fontSize:38,fontWeight:650,letterSpacing:-1.7,margin:'13px 0 10px',color:p>.5?C.lime:C.paper}}>{name}</div><div style={{fontSize:17,color:C.sage}}>{line}</div></div>;
}

function Overview(){
 const f=useCurrentFrame();
 return <Stage><Brand/><Title>Zcash data.<br/><span style={{color:C.lime}}>Ready to build.</span></Title><div style={{...pos(850,160,350),paddingLeft:24,borderLeft:`1px solid ${C.stroke}`,fontSize:23,lineHeight:1.55,color:C.sage}}>Public chain queries.<br/>Your application model.<br/>Locally authorized receipts.</div>
 <div style={{...pos(64,369),...mono,fontSize:17,color:C.sage,letterSpacing:1.2}}>FROM CHAIN DATA TO YOUR APPLICATION API</div>
 <ProductNode x={64} w={228} name="Zcash" tag="SOURCE" line="Public blocks + transactions" start={0}/>
 <Wire x1={292} y1={507} x2={346} y2={507} start={15}/><ProductNode x={346} w={228} name="Prep" tag="DATA ENGINE" line="Select · filter · stream" start={25}/>
 <Wire x1={574} y1={507} x2={628} y2={507} start={42}/><ProductNode x={628} w={266} name="Chef" tag="INDEXING FRAMEWORK" line="TypeScript + PostgreSQL" start={52}/>
 <Wire x1={894} y1={507} x2={948} y2={507} start={69}/><ProductNode x={948} w={268} name="Your app" tag="READ MODEL" line="Query entities with GraphQL" start={79}/>
 <div style={{...pos(64,611,1152),display:'flex',justifyContent:'space-between',fontSize:19,color:C.sage,opacity:tween(f,85,105)}}><span>Use Prep directly, or build on it with Chef.</span><span style={{color:C.lime}}>Your schema. Your infrastructure.</span></div>
 <Footer>ILLUSTRATED DATA FLOW · OPTIONAL LOCAL SCANNER · VIEWING KEY STAYS WITH THE OPERATOR</Footer></Stage>;
}

function Prep(){
 const f=useCurrentFrame(),response=tween(f,74,96);
 return <Stage><Brand product="Prep"/><Title>Select public fields.<br/><span style={{color:C.lime}}>Receive focused data.</span></Title>
 <Plate label="REQUEST / PUBLIC CHAIN DATA" x={64} y={321} w={390} h={300}><div style={{...mono,fontSize:18,color:C.sage}}>BLOCK RANGE · END EXCLUSIVE</div><div style={{...mono,fontSize:26,marginTop:13}}>4515166 → 4515167</div><div style={{height:1,background:C.stroke,margin:'22px 0'}}/><div style={{display:'flex',gap:13}}>{['height','time'].map((name,i)=><div key={name} style={{...mono,fontSize:25,padding:'12px 17px',borderRadius:10,border:`1px solid ${f>15+i*16?'#789847':C.stroke}`,color:f>15+i*16?C.lime:C.sage,background:'#c6ff4208'}}>{f>15+i*16?'✓ ':''}{name}</div>)}</div></Plate>
 <Wire x1={454} y1={467} x2={507} y2={467} start={34}/><div style={{...pos(507,364,210,208),display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',borderRadius:24,border:'1px solid #789847',background:'radial-gradient(ellipse at top,#344b29,#142017 80%)',boxShadow:'inset 0 1px #d8f7bd22,0 24px 45px #0005'}}><div style={{...mono,fontSize:17,color:C.sage}}>DATA ENGINE</div><div style={{fontSize:49,letterSpacing:-2,fontWeight:650,color:C.lime,margin:'12px 0'}}>Prep</div><div style={{...mono,fontSize:17,color:C.sage}}>select → project</div></div><Wire x1={717} y1={467} x2={770} y2={467} start={57}/>
 <div style={{opacity:response,transform:`translateY(${(1-response)*12}px)`}}><Plate label="RESPONSE / data.blocks[0]" x={770} y={321} w={446} h={300} active><div style={{...mono,fontSize:20,color:C.sage}}>height</div><div style={{...mono,fontSize:39,color:C.lime,margin:'8px 0 19px'}}>{sample.block.height}</div><div style={{...mono,fontSize:20,color:C.sage}}>time</div><div style={{...mono,fontSize:32,marginTop:8}}>{sample.block.time}</div></Plate></div>
 <Footer>ILLUSTRATED PROJECTION · VERIFIED TESTNET BLOCK 4515166 · ONLY THE SELECTED FIELDS</Footer></Stage>;
}

function Chef(){
 const f=useCurrentFrame(),query=tween(f,47,68),response=tween(f,78,99);
 return <Stage><Brand product="Chef"/><Title>Your model.<br/><span style={{color:C.lime}}>A queryable application API.</span></Title>
 <div style={{opacity:1-query}}><Plate label="PREP / TRANSACTION INPUT" x={64} y={327} w={345} h={280}><div style={{...mono,color:C.sage,fontSize:19}}>txid</div><div style={{...mono,fontSize:24,lineHeight:1.6,margin:'12px 0 20px'}}>{sample.transaction.txid.slice(0,16)}…<br/>{sample.transaction.txid.slice(-16)}</div><div style={{color:C.sage,fontSize:21}}>Public transaction data</div></Plate>
 <Wire x1={409} y1={467} x2={470} y2={467} start={9}/><Plate label="YOUR TYPESCRIPT" x={470} y={327} w={265} h={280} active><div style={{fontSize:39,color:C.lime,letterSpacing:-1,fontWeight:650,margin:'20px 0'}}>Handlers</div><div style={{fontSize:23,color:C.sage,lineHeight:1.4}}>Define entities.<br/>Transform data.</div></Plate><Wire x1={735} y1={467} x2={794} y2={467} start={27}/>
 <Plate label="POSTGRESQL / YOUR ENTITY" x={794} y={327} w={422} h={280} active><div style={{fontSize:36,fontWeight:600,letterSpacing:-1}}>Transaction</div><div style={{...mono,fontSize:23,color:C.sage,marginTop:23}}>block {sample.block.height}</div><div style={{...mono,fontSize:25,color:C.lime,marginTop:18}}>1 input · 3 outputs</div></Plate></div>
 <div style={{opacity:query,transform:`translateY(${(1-query)*12}px)`}}><Plate label="GRAPHQL / EXAMPLE APPLICATION MODEL" x={64} y={309} w={564} h={326}><pre style={{...mono,fontSize:22,lineHeight:1.49,letterSpacing:-.3,margin:0,whiteSpace:'pre'}}><span style={{color:C.lime}}>{'query ($txid: ID!) {'}</span>{'\n  TransactionById(id: $txid) {\n    inputs { resolution valueZat }\n    outputs { valueZat }\n  }\n}'}</pre></Plate></div>
 <div style={{opacity:response,transform:`translateY(${(1-response)*12}px)`}}><Plate label="data.TransactionById" x={659} y={309} w={557} h={326} active><div style={{...mono,fontSize:16,color:C.sage}}>INPUT 0 · RESOLVED · ZATOSHI</div><div style={{...mono,fontSize:47,color:C.lime,margin:'10px 0 20px',letterSpacing:-1.2}}>{sample.transaction.inputValueZat}</div><div style={{...mono,fontSize:16,color:C.sage,borderTop:`1px solid ${C.stroke}`,paddingTop:17}}>OUTPUT VALUES · ZATOSHI</div><div style={{display:'flex',gap:12,marginTop:14}}>{sample.transaction.outputs.map(value=><div key={value} style={{...mono,fontSize:22,padding:'10px 12px',border:`1px solid ${C.stroke}`,borderRadius:9}}>{value}</div>)}</div></Plate></div>
 <Footer>PREP → HANDLERS → POSTGRESQL → GRAPHQL · VERIFIED TRANSACTION FIELDS · ILLUSTRATED, NOT LIVE</Footer></Stage>;
}

registerRoot(()=> <>
 <Composition id="RepositoryOverview" component={Overview} width={1280} height={720} fps={30} durationInFrames={144}/>
 <Composition id="PrepOverview" component={Prep} width={1040} height={600} fps={30} durationInFrames={144}/>
 <Composition id="ChefOverview" component={Chef} width={1040} height={600} fps={30} durationInFrames={144}/>
</>);
