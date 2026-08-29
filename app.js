/* =============================================================================
   PartyPulse — live crowd queue + energy meter
   Plain ES2017. Supabase Realtime when configured; BroadcastChannel on-device.
   ============================================================================= */
(function () {
'use strict';

/* --------------------------------------------------------------- 0. config */
/* The anon key is a public client credential by design: it carries no privileges
   beyond the row-level security policies in the schema. Guests have no accounts,
   so this is the intended way to ship it. Override either value per-browser via
   the LOCAL chip on the entry screen. */
const SUPABASE_URL      = 'https://jbmcjkvrjtxfinqkoega.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpibWNqa3ZyanR4ZmlucWtvZWdhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc5NzE2MDYsImV4cCI6MjEwMzU0NzYwNn0.kS4rhzqgKahtSB79JXadGpJFJE5oFYNtVNkZiU6gqes';

const K = {
  url:'pp.url', key:'pp.key', rooms:'pp.rooms', recent:'pp.recent',
  songs:c=>'pp.s.'+c, vibes:c=>'pp.v.'+c
};
const WINDOW_MS = 5*60*1000;   // rolling vibe window
const TICK_MS   = 4000;        // re-evaluate the window on a timer

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const uid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16);
    }));

/* ------------------------------------------------------------------ 1. qr */
/* Minimal but spec-correct QR encoder: byte mode, ECC level M, versions 1-10.
   Written inline because the brief allows no dependency but a fake QR that
   does not scan would break the room's primary join path. */
const QR = (function(){
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i=0,x=1;i<255;i++){ EXP[i]=x; LOG[x]=i; x<<=1; if(x&256) x^=0x11d; }
  for (let i=255;i<512;i++) EXP[i]=EXP[i-255];
  const mul = (a,b) => (a===0||b===0) ? 0 : EXP[LOG[a]+LOG[b]];

  function rsPoly(n){
    let p=[1];
    for(let i=0;i<n;i++){
      const q=new Array(p.length+1).fill(0);
      for(let j=0;j<p.length;j++){ q[j]^=mul(p[j],1); q[j+1]^=mul(p[j],EXP[i]); }
      p=q;
    }
    return p;
  }
  function rsEncode(data,ecLen){
    const gen=rsPoly(ecLen), res=new Array(ecLen).fill(0);
    for(const d of data){
      const factor=d^res[0];
      res.shift(); res.push(0);
      for(let i=0;i<ecLen;i++) res[i]^=mul(gen[i+1],factor);
    }
    return res;
  }

  // [ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data] for ECC level M
  const SPEC = {
    1:[10,1,16,0,0],  2:[16,1,28,0,0],  3:[26,1,44,0,0],  4:[18,2,32,0,0],
    5:[24,2,43,0,0],  6:[16,4,27,0,0],  7:[18,4,31,0,0],  8:[22,2,38,2,39],
    9:[22,3,36,2,37], 10:[26,4,43,1,44]
  };
  const ALIGN = {1:[],2:[6,18],3:[6,22],4:[6,26],5:[6,30],
                 6:[6,34],7:[6,22,38],8:[6,24,42],9:[6,26,46],10:[6,28,50]};

  const bchFormat = d => { let v=d<<10; for(let i=4;i>=0;i--) if(v&(1<<(i+10))) v^=0x537<<i; return ((d<<10)|v)^0x5412; };
  const bchVersion = d => { let v=d<<12; for(let i=5;i>=0;i--) if(v&(1<<(i+12))) v^=0x1f25<<i; return (d<<12)|v; };

  function pickVersion(len){
    for(let v=1;v<=10;v++){
      const s=SPEC[v], cap=s[1]*s[2]+s[3]*s[4];
      const header = 4 + (v<10?8:16);
      if (cap*8 >= header + len*8) return v;
    }
    return null;
  }

  function build(text){
    const bytes = Array.from(new TextEncoder().encode(text));
    const ver = pickVersion(bytes.length);
    if (!ver) return null;
    const [ecLen,g1,d1,g2,d2] = SPEC[ver];
    const totalData = g1*d1 + g2*d2;

    // --- bit stream: mode 0100 + length + payload + terminator + pad
    const bits=[];
    const push=(val,n)=>{ for(let i=n-1;i>=0;i--) bits.push((val>>i)&1); };
    push(0b0100,4);
    push(bytes.length, ver<10?8:16);
    bytes.forEach(b=>push(b,8));
    for(let i=0;i<4 && bits.length<totalData*8;i++) bits.push(0);
    while(bits.length%8) bits.push(0);
    const words=[];
    for(let i=0;i<bits.length;i+=8) words.push(parseInt(bits.slice(i,i+8).join(''),2));
    const PADS=[0xec,0x11];
    for(let i=0; words.length<totalData; i++) words.push(PADS[i%2]);

    // --- split into blocks, interleave data then ec
    const blocks=[]; let at=0;
    for(let i=0;i<g1;i++){ blocks.push(words.slice(at,at+d1)); at+=d1; }
    for(let i=0;i<g2;i++){ blocks.push(words.slice(at,at+d2)); at+=d2; }
    const ecs = blocks.map(b=>rsEncode(b,ecLen));

    const stream=[];
    const maxD=Math.max(d1,d2);
    for(let i=0;i<maxD;i++) blocks.forEach(b=>{ if(i<b.length) stream.push(b[i]); });
    for(let i=0;i<ecLen;i++) ecs.forEach(e=>stream.push(e[i]));

    // --- matrix
    const size = ver*4+17;
    const M = Array.from({length:size},()=>new Array(size).fill(null)); // null = free
    const set=(r,c,v)=>{ if(r>=0&&r<size&&c>=0&&c<size) M[r][c]=v; };

    function finder(r,c){
      for(let i=-1;i<=7;i++) for(let j=-1;j<=7;j++){
        const rr=r+i, cc=c+j;
        if(rr<0||rr>=size||cc<0||cc>=size) continue;
        const on = (i>=0&&i<=6&&(j===0||j===6)) || (j>=0&&j<=6&&(i===0||i===6)) ||
                   (i>=2&&i<=4&&j>=2&&j<=4);
        set(rr,cc,on?1:0);
      }
    }
    finder(0,0); finder(0,size-7); finder(size-7,0);

    for(let i=8;i<size-8;i++){ const b=i%2===0?1:0; set(6,i,b); set(i,6,b); }

    ALIGN[ver].forEach(r=>ALIGN[ver].forEach(c=>{
      if((r===6&&c===6)||(r===6&&c===size-7)||(r===size-7&&c===6)) return;
      for(let i=-2;i<=2;i++) for(let j=-2;j<=2;j++)
        set(r+i,c+j,(Math.max(Math.abs(i),Math.abs(j))!==1)?1:0);
    }));

    set(size-8,8,1); // dark module

    // reserve format areas
    for(let i=0;i<9;i++){ if(M[8][i]===null) set(8,i,0); if(M[i][8]===null) set(i,8,0); }
    for(let i=0;i<8;i++){ set(8,size-1-i,0); set(size-1-i,8,0); }
    if(ver>=7) for(let i=0;i<18;i++){
      const r=Math.floor(i/3), c=i%3;
      set(size-11+c,r,0); set(r,size-11+c,0);
    }

    // --- place data, zig-zag upward in 2-column strips
    const reserved = M.map(row=>row.map(v=>v!==null));
    let bit=0, up=true;
    for(let col=size-1; col>0; col-=2){
      if(col===6) col--;
      for(let k=0;k<size;k++){
        const row = up ? size-1-k : k;
        for(let d=0;d<2;d++){
          const c = col-d;
          if(reserved[row][c]) continue;
          const byteI=bit>>3;
          M[row][c] = byteI<stream.length ? (stream[byteI]>>(7-(bit&7)))&1 : 0;
          bit++;
        }
      }
      up=!up;
    }

    const MASKS=[
      (r,c)=>(r+c)%2===0, (r,c)=>r%2===0, (r,c)=>c%3===0, (r,c)=>(r+c)%3===0,
      (r,c)=>((r>>1)+Math.floor(c/3))%2===0, (r,c)=>((r*c)%2)+((r*c)%3)===0,
      (r,c)=>(((r*c)%2)+((r*c)%3))%2===0, (r,c)=>(((r+c)%2)+((r*c)%3))%2===0
    ];

    function penalty(g){
      let p=0;
      // rule 1: runs of 5+
      for(let i=0;i<size;i++){
        for(const line of [g[i], g.map(r=>r[i])]){
          let run=1;
          for(let j=1;j<size;j++){
            if(line[j]===line[j-1]) run++;
            else { if(run>=5) p+=3+(run-5); run=1; }
          }
          if(run>=5) p+=3+(run-5);
        }
      }
      // rule 2: 2x2 blocks
      for(let r=0;r<size-1;r++) for(let c=0;c<size-1;c++)
        if(g[r][c]===g[r][c+1] && g[r][c]===g[r+1][c] && g[r][c]===g[r+1][c+1]) p+=3;
      // rule 3: finder-like patterns
      const P1=[1,0,1,1,1,0,1,0,0,0,0], P2=[0,0,0,0,1,0,1,1,1,0,1];
      const hit=(line,i,pat)=>pat.every((v,k)=>line[i+k]===v);
      for(let i=0;i<size;i++){
        const rows=g[i], cols=g.map(r=>r[i]);
        for(let j=0;j+11<=size;j++){
          if(hit(rows,j,P1)||hit(rows,j,P2)) p+=40;
          if(hit(cols,j,P1)||hit(cols,j,P2)) p+=40;
        }
      }
      // rule 4: dark ratio
      let dark=0; g.forEach(r=>r.forEach(v=>dark+=v));
      p += Math.floor(Math.abs(dark*100/(size*size)-50)/5)*10;
      return p;
    }

    // Both format copies, paired cell-by-cell in canonical MSB-to-LSB order.
    const fmtCells=[];
    for(let i=0;i<=5;i++) fmtCells.push([[8,i],[size-1-i,8]]);
    fmtCells.push([[8,7],[size-7,8]]);
    fmtCells.push([[8,8],[8,size-8]]);
    fmtCells.push([[7,8],[8,size-7]]);
    for(let i=9;i<15;i++) fmtCells.push([[14-i,8],[8,size-15+i]]);

    let best=null, bestMask=0, bestScore=Infinity;
    for(let m=0;m<8;m++){
      const g = M.map((row,r)=>row.map((v,c)=>reserved[r][c] ? v : (v^(MASKS[m](r,c)?1:0))));
      const fmt = bchFormat((0b00<<3)|m);   // 00 = ECC level M
      fmtCells.forEach(([a,b2],k)=>{
        const b=(fmt>>(14-k))&1;
        g[a[0]][a[1]]=b; g[b2[0]][b2[1]]=b;
      });
      g[size-8][8]=1; // dark module, never part of the format payload
      if(ver>=7){
        const vinfo=bchVersion(ver);
        for(let i=0;i<18;i++){
          const b=(vinfo>>i)&1, r=Math.floor(i/3), c=i%3;
          g[size-11+c][r]=b; g[r][size-11+c]=b;
        }
      }
      const s=penalty(g);
      if(s<bestScore){ bestScore=s; best=g; bestMask=m; }
    }
    return best;
  }

  return {
    svg(text){
      const g = build(text);
      if(!g) return '';
      const n=g.length, q=2, dim=n+q*2;
      let d='';
      for(let r=0;r<n;r++) for(let c=0;c<n;c++)
        if(g[r][c]) d += `M${c+q} ${r+q}h1v1h-1z`;
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">`
           + `<path fill="#08080A" d="${d}"/></svg>`;
    }
  };
})();

/* --------------------------------------------------------------- 2. state */
const state = { code:null, songs:[], vibes:[], cloud:false };
let sb = null, chan = null, bus = null, tick = null;

const ls = {
  get(k,f){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):f; }catch(e){ return f; } },
  set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} },
  raw(k){ try{ return localStorage.getItem(k)||''; }catch(e){ return ''; } },
  put(k,v){ try{ localStorage.setItem(k,v); }catch(e){} },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* ---------------------------------------------------------------- 3. cloud */
const Cloud = {
  boot(){
    const url = ls.raw(K.url) || SUPABASE_URL;
    const key = ls.raw(K.key) || SUPABASE_ANON_KEY;
    sb = null; state.cloud = false;
    if (url && key && window.supabase) {
      try { sb = window.supabase.createClient(url, key); state.cloud = true; }
      catch(e){ sb = null; state.cloud = false; }
    }
    UI.netBadge();
  },

  async roomExists(code){
    if(!sb) return null;
    const { data, error } = await sb.from('rooms').select('code').eq('code',code).limit(1);
    if(error) throw error;
    return !!(data && data.length);
  },

  async createRoom(code){ if(sb) await sb.from('rooms').insert({ code }); },

  /* Backfill history. Merges rather than replaces: the channel is already live
     by the time this runs, so an event can land mid-request and must survive. */
  async load(code){
    if(!sb) return false;
    const since = new Date(Date.now()-WINDOW_MS).toISOString();
    const [s,v] = await Promise.all([
      sb.from('songs').select('*').eq('room_code',code),
      sb.from('vibes').select('*').eq('room_code',code).gte('created_at',since)
    ]);
    if(s.error||v.error) return false;

    const songById = new Map(state.songs.map(x=>[x.id,x]));
    (s.data||[]).map(Song.fromRow).forEach(x=>songById.set(x.id,x));
    state.songs = Array.from(songById.values());

    const vibeById = new Map(state.vibes.map(x=>[x.id,x]));
    (v.data||[]).map(Vibe.fromRow).forEach(x=>vibeById.set(x.id,x));
    state.vibes = Array.from(vibeById.values());
    return true;
  },

  /* Realtime: push-based. Rows arrive as events, never polled.
     Resolves once the channel is actually SUBSCRIBED, so the caller can
     backfill afterwards without a gap where inserts are dropped. */
  subscribe(code){
    if(!sb) return Promise.resolve();
    Cloud.unsubscribe();
    return new Promise(resolve=>{
      let settled=false;
      const done=()=>{ if(!settled){ settled=true; resolve(); } };
      setTimeout(done, 5000);   // never block the room on a slow socket
      Cloud._open(code, done);
    });
  },

  _open(code, onReady){
    chan = sb.channel('room:'+code)
      .on('postgres_changes',
          { event:'INSERT', schema:'public', table:'songs', filter:'room_code=eq.'+code },
          p => { Room.mergeSong(Song.fromRow(p.new), true); })
      .on('postgres_changes',
          { event:'UPDATE', schema:'public', table:'songs', filter:'room_code=eq.'+code },
          p => { Room.mergeSong(Song.fromRow(p.new), false); })
      .on('postgres_changes',
          { event:'DELETE', schema:'public', table:'songs', filter:'room_code=eq.'+code },
          p => { state.songs = state.songs.filter(s=>s.id!==p.old.id); Room.paint(); })
      .on('postgres_changes',
          { event:'INSERT', schema:'public', table:'vibes', filter:'room_code=eq.'+code },
          p => { Room.mergeVibe(Vibe.fromRow(p.new)); })
      .subscribe(status=>{ if(status==='SUBSCRIBED') onReady(); });
  },

  unsubscribe(){ if(sb && chan){ sb.removeChannel(chan); chan=null; } }
};

/* ------------------------------------------------------------ 4. entities */
const Song = {
  fromRow: r => ({ id:r.id, title:r.title, votes:r.votes|0, at:Date.parse(r.created_at)||Date.now() })
};
const Vibe = {
  fromRow: r => ({ id:r.id, value:r.value, at:Date.parse(r.created_at)||Date.now() })
};

/* -------------------------------------------------------------- 5. on-device
   BroadcastChannel keeps tabs on one machine in sync when there is no cloud,
   so the room is demoable before credentials exist. */
const Bus = {
  boot(){
    if(typeof BroadcastChannel === 'undefined') return;
    bus = new BroadcastChannel('partypulse');
    bus.onmessage = e => {
      const m = e.data;
      if(!m || m.code !== state.code) return;
      if(m.t==='song')  Room.mergeSong(m.song, true);
      if(m.t==='vote'){ const s=state.songs.find(x=>x.id===m.id); if(s){ s.votes=m.votes; Room.paint(); } }
      if(m.t==='vibe')  Room.mergeVibe(m.vibe);
    };
  },
  send(msg){ if(bus) bus.postMessage(Object.assign({ code:state.code }, msg)); }
};

/* ------------------------------------------------------------------ 6. ui */
const UI = {
  toast(msg, bad){
    const el=document.createElement('div');
    el.className='toast'+(bad?' toast--bad':'');
    el.textContent=msg;
    $('#toasts').appendChild(el);
    setTimeout(()=>{ el.classList.add('toast--out'); setTimeout(()=>el.remove(),220); }, 2200);
  },

  netBadge(){
    $('#net-dot').className = 'dot' + (state.cloud?' dot--on':'');
    $('#net-label').textContent = state.cloud ? 'CLOUD' : 'LOCAL';
    $('#net-note').textContent = state.cloud
      ? 'Connected. Rooms sync across every device on the internet in real time.'
      : 'On-device mode: tabs on this machine stay in sync. Add Supabase credentials for phone-to-phone sync.';
  },

  async copy(text, msg){
    try{
      if(navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text);
      else {
        const t=document.createElement('textarea');
        t.value=text; t.style.cssText='position:fixed;opacity:0';
        document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
      }
      UI.toast(msg);
    }catch(e){ UI.toast('Copy failed', true); }
  },

  err(node, msg){
    if(!msg){ node.hidden=true; node.textContent=''; return; }
    node.hidden=false; node.textContent=msg;
  },

  ripple(btn, ev){
    const r=btn.getBoundingClientRect();
    const d=Math.max(r.width,r.height);
    const el=document.createElement('span');
    el.className='rip';
    el.style.cssText=`width:${d}px;height:${d}px;left:${(ev.clientX||r.left+r.width/2)-r.left-d/2}px;top:${(ev.clientY||r.top+r.height/2)-r.top-d/2}px`;
    btn.appendChild(el);
    setTimeout(()=>el.remove(),580);
  },

  mark(text, color, el){
    const r=el.getBoundingClientRect();
    const m=document.createElement('span');
    m.className='mark'; m.textContent=text;
    m.style.cssText=`left:${r.left+r.width/2}px;top:${r.top}px;color:${color};--dx:${(Math.random()-.5)*70}px`;
    document.body.appendChild(m);
    setTimeout(()=>m.remove(),1000);
  }
};

/* --------------------------------------------------------------- 7. entry */
const Entry = {
  boot(){
    const slots=$$('#code-slots .slot');

    slots.forEach((el,i)=>{
      el.addEventListener('input',()=>{
        el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g,'');
        el.classList.toggle('slot--filled', !!el.value);
        UI.err($('#entry-err'), '');
        if(el.value && i<slots.length-1) slots[i+1].focus();
      });
      el.addEventListener('keydown',e=>{
        if(e.key==='Backspace' && !el.value && i>0){ slots[i-1].focus(); slots[i-1].value=''; slots[i-1].classList.remove('slot--filled'); }
        if(e.key==='ArrowLeft'  && i>0) slots[i-1].focus();
        if(e.key==='ArrowRight' && i<slots.length-1) slots[i+1].focus();
      });
      el.addEventListener('paste',e=>{
        e.preventDefault();
        const txt=(e.clipboardData.getData('text')||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,4);
        slots.forEach((s,j)=>{ s.value=txt[j]||''; s.classList.toggle('slot--filled',!!s.value); });
        slots[Math.min(txt.length,3)].focus();
      });
    });

    $('#btn-create').addEventListener('click', Entry.create);
    $('#form-join').addEventListener('submit', e=>{ e.preventDefault(); Entry.join(); });

    const openNet=()=>{ $('#in-url').value=ls.raw(K.url); $('#in-key').value=ls.raw(K.key); $('#sheet-net').hidden=false; };
    $('#net-tag').addEventListener('click', openNet);
    $('#net-tag').addEventListener('keydown', e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openNet(); } });

    Entry.recents();
  },

  code(){ return $$('#code-slots .slot').map(s=>s.value).join(''); },

  clear(){ $$('#code-slots .slot').forEach(s=>{ s.value=''; s.classList.remove('slot--filled'); }); },

  reject(msg){
    UI.err($('#entry-err'), msg);
    const f=$('#form-join');
    f.classList.remove('joiner--shake'); void f.offsetWidth; f.classList.add('joiner--shake');
  },

  gen(){
    const A='ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — misread on a projector
    let c=''; for(let i=0;i<4;i++) c+=A[Math.floor(Math.random()*A.length)];
    return c;
  },

  async create(){
    const btn=$('#btn-create');
    btn.disabled=true; $('.cta__label').textContent='Opening…'; $('#cta-load').hidden=false;
    try{
      let code=Entry.gen(), guard=0;
      const known=ls.get(K.rooms,[]);
      while(guard++<40){
        let taken = known.indexOf(code)>-1;
        if(!taken && sb){ try{ taken = await Cloud.roomExists(code); }catch(e){} }
        if(!taken) break;
        code=Entry.gen();
      }
      if(sb) await Cloud.createRoom(code);
      ls.set(K.rooms, known.concat([code]));
      Rooms.remember(code);
      location.hash = code;
      UI.toast('Room '+code+' is open');
    } finally {
      btn.disabled=false; $('.cta__label').textContent='Start a room'; $('#cta-load').hidden=true;
    }
  },

  async join(){
    const code=Entry.code();
    if(code.length<4) return Entry.reject('Enter all four letters of the room code.');

    let ok = ls.get(K.rooms,[]).indexOf(code)>-1;
    if(!ok && sb){
      try{ ok = await Cloud.roomExists(code); }
      catch(e){ return Entry.reject('Could not reach the server. Check the connection settings.'); }
      if(ok) ls.set(K.rooms, ls.get(K.rooms,[]).concat([code]));
    }
    if(!ok) return Entry.reject('No room named '+code+'. Check the code, or start your own.');

    Rooms.remember(code);
    Entry.clear();
    UI.err($('#entry-err'),'');
    location.hash = code;
  },

  recents(){
    const list = ls.get(K.recent,[]);
    const wrap=$('#recents'), row=$('#recents-row');
    if(!list.length){ wrap.hidden=true; return; }
    row.innerHTML='';
    list.forEach(c=>{
      const b=document.createElement('button');
      b.type='button'; b.textContent=c;
      b.addEventListener('click',()=>{ location.hash=c; });
      row.appendChild(b);
    });
    wrap.hidden=false;
  }
};

const Rooms = {
  remember(code){
    const list=ls.get(K.recent,[]).filter(c=>c!==code);
    list.unshift(code);
    ls.set(K.recent, list.slice(0,5));
  }
};

/* ---------------------------------------------------------------- 8. room */
const Room = {
  boot(){
    $('#btn-leave').addEventListener('click',()=>{ location.hash=''; });
    $('#btn-code').addEventListener('click',()=>UI.copy(state.code,'Code '+state.code+' copied'));

    $('#btn-share').addEventListener('click',()=>{
      $('#share-code').textContent = state.code;
      $('#qr').innerHTML = QR.svg(Room.link());
      $('#sheet-share').hidden=false;
    });
    $('#btn-share-x').addEventListener('click',()=>{ $('#sheet-share').hidden=true; });
    $('#btn-copy-link').addEventListener('click',()=>UI.copy(Room.link(),'Join link copied'));

    $('#form-song').addEventListener('submit',e=>{ e.preventDefault(); Room.addSong(); });
    $('#song-in').addEventListener('input',()=>UI.err($('#song-err'),''));

    $('#btn-fire').addEventListener('click',  e=>Room.vibe('fire',  e));
    $('#btn-sleepy').addEventListener('click',e=>Room.vibe('sleepy',e));

    $('#btn-recap').addEventListener('click', Room.recap);
  },

  link(){ return location.origin + location.pathname + '#' + state.code; },

  async enter(code){
    state.code = code;
    state.songs = []; state.vibes = [];
    $('#room-code').textContent = code;
    $('#song-in').value=''; UI.err($('#song-err'),'');

    // Subscribe before backfilling, or rows inserted in between are lost.
    let loaded=false;
    if(sb){
      await Cloud.subscribe(code);
      try{ loaded = await Cloud.load(code); }catch(e){}
    }
    if(!loaded){
      state.songs = ls.get(K.songs(code),[]);
      state.vibes = ls.get(K.vibes(code),[]);
    }

    Room.paint();
    clearInterval(tick);
    tick = setInterval(Room.paintEnergy, TICK_MS);
  },

  leave(){
    state.code=null; state.songs=[]; state.vibes=[];
    Cloud.unsubscribe();
    if(Cam.on) Cam.stop();
    clearInterval(tick); tick=null;
  },

  persist(){
    if(!state.code) return;
    ls.set(K.songs(state.code), state.songs);
    ls.set(K.vibes(state.code), state.vibes.filter(v=>v.at >= Date.now()-WINDOW_MS*2));
  },

  /* ---- mutations ---- */
  async addSong(){
    const input=$('#song-in');
    const title=input.value.trim().replace(/\s+/g,' ');
    if(!title) return UI.err($('#song-err'),'Type a track or artist first.');
    if(state.songs.some(s=>s.title.toLowerCase()===title.toLowerCase()))
      return UI.err($('#song-err'),'Already in the queue — upvote it instead.');

    const song={ id:uid(), title, votes:0, at:Date.now() };
    input.value=''; UI.err($('#song-err'),'');

    Room.mergeSong(song, true);
    Bus.send({ t:'song', song });
    if(sb){
      const { error } = await sb.from('songs').insert({
        id:song.id, room_code:state.code, title:song.title, votes:0
      });
      if(error){
        state.songs = state.songs.filter(s=>s.id!==song.id);
        Room.paint();
        UI.err($('#song-err'),'Could not save that request. Try again.');
      }
    }
  },

  async vote(id, btn){
    const song=state.songs.find(s=>s.id===id);
    if(!song) return;

    song.votes++;
    btn.classList.add('up--hit');
    const n=btn.querySelector('.up__n');
    n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop');
    UI.mark('+1', 'var(--acid)', btn);

    Room.say('+1 · '+song.title);
    Room.paint();
    Room.persist();
    Bus.send({ t:'vote', id, votes:song.votes });

    if(sb){
      // Atomic where available so simultaneous voters never clobber each other.
      const rpc = await sb.rpc('bump_vote', { song_id:id });
      if(rpc.error) await sb.from('songs').update({ votes:song.votes }).eq('id',id);
    }
  },

  async vibe(value, ev){
    if(!state.code) return;
    const btn = ev.currentTarget;
    UI.ripple(btn, ev);
    Combo.hit();
    UI.mark(value==='fire'?'FIRE':'CHILL', value==='fire'?'var(--fire)':'var(--chill)', btn);

    const v={ id:uid(), value, at:Date.now() };
    Room.mergeVibe(v);
    Bus.send({ t:'vibe', vibe:v });

    if(sb) await sb.from('vibes').insert({ id:v.id, room_code:state.code, value });
  },

  /* ---- merges from any transport ---- */
  mergeSong(song, isNew){
    const i=state.songs.findIndex(s=>s.id===song.id);
    if(i<0){
      state.songs.push(song);
      if(isNew) Room.say('added · '+song.title);
    } else {
      state.songs[i].votes = song.votes;
      state.songs[i].title = song.title;
    }
    Room.paint();
    Room.persist();
  },

  mergeVibe(v){
    if(state.vibes.some(x=>x.id===v.id)) return;
    state.vibes.push(v);
    Room.paintEnergy();
    Room.persist();
  },

  say(text){
    const t=$('#ticker');
    t.textContent=text;
    t.classList.remove('flash'); void t.offsetWidth; t.classList.add('flash');
  },

  /* ---- render ---- */
  paint(){ Room.paintQueue(); Room.paintEnergy(); },

  paintEnergy(){
    const cut = Date.now()-WINDOW_MS;
    state.vibes = state.vibes.filter(v=>v.at>=cut);

    let fire=0, sleepy=0;
    state.vibes.forEach(v=>{ if(v.value==='fire') fire++; else sleepy++; });
    const total=fire+sleepy;
    const pct = total ? Math.round(fire/total*100) : 50;

    $('#count-fire').textContent=fire;
    $('#count-sleepy').textContent=sleepy;
    $('#energy-num').textContent=pct;
    $('#gauge-fill').style.width=pct+'%';
    $('#gauge-pin').style.left=pct+'%';

    // Drive the ambient field: cool blue when chill, hot red when raging.
    const e = pct/100;
    const hue = Math.round(220 - e*208);
    document.documentElement.style.setProperty('--e', e.toFixed(3));
    document.documentElement.style.setProperty('--e-hue', hue);

    $('#energy-verdict').textContent =
      !total       ? 'Waiting on the crowd' :
      pct>=80      ? 'Room is going off' :
      pct>=60      ? 'Riding high' :
      pct>=40      ? 'Holding steady' :
      pct>=20      ? 'Losing them' :
                     'Drop something now';
  },

  paintQueue(){
    const list=$('#list'), voidEl=$('#void');

    // FLIP: capture geometry so re-ranked rows visibly slide past each other.
    const before=new Map();
    $$('#list .row').forEach(r=>before.set(r.dataset.id, r.getBoundingClientRect().top));

    const songs=state.songs.slice().sort((a,b)=> b.votes-a.votes || a.at-b.at );

    $('#queue-n').textContent = songs.length + (songs.length===1?' track':' tracks');
    voidEl.hidden = songs.length>0;
    list.hidden   = songs.length===0;
    list.innerHTML='';

    songs.forEach((s,i)=>{
      const li=document.createElement('li');
      li.className='row'+(i===0?' row--lead':'');
      li.dataset.id=s.id;

      const rank=document.createElement('span');
      rank.className='row__rank'; rank.textContent=String(i+1).padStart(2,'0');

      const body=document.createElement('div');
      body.className='row__body';
      const title=document.createElement('span');
      title.className='row__title'; title.textContent=s.title; title.title=s.title;
      body.appendChild(title);
      if(i===0){
        const sub=document.createElement('span');
        sub.className='row__sub';
        sub.innerHTML='<span class="eq"><i></i><i></i><i></i></span>Next up';
        body.appendChild(sub);
      }

      const up=document.createElement('button');
      up.type='button'; up.className='up';
      up.setAttribute('aria-label','Upvote '+s.title+', '+s.votes+' votes');
      up.innerHTML='<span class="up__arw">▲</span><span class="up__n">'+s.votes+'</span>';
      up.addEventListener('click',()=>Room.vote(s.id, up));

      li.append(rank, body, up);
      list.appendChild(li);

      if(!before.has(s.id)) li.classList.add('row--new');
    });

    $$('#list .row').forEach(r=>{
      const prev=before.get(r.dataset.id);
      if(prev===undefined) return;
      const delta=prev - r.getBoundingClientRect().top;
      if(!delta) return;
      r.animate(
        [{ transform:`translateY(${delta}px)` },{ transform:'none' }],
        { duration:420, easing:'cubic-bezier(.2,1,.3,1)' }
      );
    });
  },

  recap(){
    const songs=state.songs.slice().sort((a,b)=> b.votes-a.votes || a.at-b.at );
    let fire=0, sleepy=0;
    state.vibes.forEach(v=>{ if(v.value==='fire') fire++; else sleepy++; });

    let out='PartyPulse — room '+state.code+'\n';
    out+='Energy: '+(fire+sleepy ? Math.round(fire/(fire+sleepy)*100) : 50)+'% ('+fire+' fire / '+sleepy+' sleepy)\n\n';
    out+= songs.length
      ? songs.map((s,i)=>(i+1)+'. '+s.title+' — '+s.votes+(s.votes===1?' vote':' votes')).join('\n')
      : 'No tracks requested.';
    UI.copy(out,'Set recap copied');
  }
};

/* ------------------------------------------------------------ 8b. pulse cam
   Reads crowd movement straight off the camera: each frame is downsampled to
   64x48 luma and differenced against the last one. The mean difference is a
   motion score; peaks in that signal are footfalls, so their spacing gives a
   rough BPM. Everything runs in this tab — no frame is uploaded or stored. */
const W = 64, H = 48;

const Cam = {
  on:false, raf:null, prev:null, ema:0, fed:0,
  peaks:[], lastPeak:0, lastFeed:0, cool:0,
  vid:null, work:null, wctx:null, fx:null, fctx:null,

  boot(){
    Cam.vid  = $('#cam-video');
    Cam.fx   = $('#cam-fx');
    Cam.fctx = Cam.fx.getContext('2d');
    Cam.work = document.createElement('canvas');
    Cam.work.width = W; Cam.work.height = H;
    Cam.wctx = Cam.work.getContext('2d', { willReadFrequently:true });

    $('#btn-cam').addEventListener('click', ()=>{ $('#sheet-cam').hidden=false; });
    $('#btn-cam-x').addEventListener('click', Cam.close);
    $('#btn-cam-toggle').addEventListener('click', ()=> Cam.on ? Cam.stop() : Cam.start());
  },

  close(){ $('#sheet-cam').hidden = true; },

  async start(){
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return Cam.fail('This browser has no camera access.');
    try{
      const stream = await navigator.mediaDevices.getUserMedia({
        video:{ facingMode:'environment', width:{ideal:640}, height:{ideal:480} }, audio:false
      });
      Cam.vid.srcObject = stream;
      await Cam.vid.play();
    }catch(e){
      return Cam.fail(
        e && e.name==='NotAllowedError' ? 'Camera permission denied. Allow it in your browser to read the room.'
      : e && e.name==='NotFoundError'   ? 'No camera found on this device.'
      : 'Could not open the camera here.');
    }

    Cam.on=true; Cam.prev=null; Cam.ema=0; Cam.fed=0; Cam.peaks=[];
    $('#cam-fed').textContent='0';
    $('.cam').classList.add('cam--on');
    $('#btn-cam').classList.add('camcta--on');
    $('#cam-state').textContent='LIVE';
    $('#cam-hud').textContent='reading';
    $('#btn-cam-toggle').textContent='Stop reading';
    $('#cam-note').textContent='Reading movement. Sustained motion feeds fire; a still floor feeds sleepy.';
    $('.cam').style.setProperty('--camh', $('.cam').clientHeight+'px');
    Cam.loop();
  },

  fail(msg){
    $('#cam-note').textContent = msg;
    UI.toast(msg, true);
  },

  stop(){
    Cam.on=false;
    if(Cam.raf) cancelAnimationFrame(Cam.raf);
    const s = Cam.vid.srcObject;
    if(s) s.getTracks().forEach(t=>t.stop());
    Cam.vid.srcObject=null;
    $('.cam').classList.remove('cam--on');
    $('#btn-cam').classList.remove('camcta--on');
    $('#cam-state').textContent='OFF';
    $('#cam-hud').textContent='standby';
    $('#btn-cam-toggle').textContent='Start reading the room';
    Cam.fctx.clearRect(0,0,W,H);
  },

  loop(){
    if(!Cam.on) return;
    Cam.raf = requestAnimationFrame(Cam.loop);
    if(Cam.vid.readyState < 2) return;

    Cam.wctx.drawImage(Cam.vid, 0, 0, W, H);
    const px = Cam.wctx.getImageData(0,0,W,H);
    const d  = px.data;
    const cur = new Uint8Array(W*H);
    for(let i=0,p=0;i<d.length;i+=4,p++)
      cur[p] = (d[i]*77 + d[i+1]*150 + d[i+2]*29) >> 8;   // luma

    if(!Cam.prev){ Cam.prev = cur; return; }

    // difference + heat overlay in one pass
    const heat = Cam.fctx.createImageData(W,H);
    let sum = 0;
    for(let p=0;p<cur.length;p++){
      const diff = Math.abs(cur[p] - Cam.prev[p]);
      sum += diff;
      const v = diff > 14 ? Math.min(255, diff*4) : 0;
      const q = p*4;
      heat.data[q]   = v;
      heat.data[q+1] = Math.min(255, v*1.5);
      heat.data[q+2] = v>0 ? 40 : 0;
      heat.data[q+3] = v>0 ? 190 : 0;
    }
    Cam.fctx.putImageData(heat,0,0);
    Cam.prev = cur;

    // normalise: ~18 mean luma delta is an energetic floor
    const raw = Math.min(1, (sum / cur.length) / 18);
    Cam.ema = Cam.ema*0.82 + raw*0.18;

    const now = performance.now();

    // peak pick on the fast signal -> beat spacing -> bpm
    if(raw > Cam.ema*1.55 && raw > 0.08 && now - Cam.lastPeak > 260){
      if(Cam.lastPeak) Cam.peaks.push(now - Cam.lastPeak);
      Cam.lastPeak = now;
      if(Cam.peaks.length > 10) Cam.peaks.shift();
    }
    let bpm = null;
    if(Cam.peaks.length >= 4){
      const s = Cam.peaks.slice().sort((a,b)=>a-b);
      const med = s[s.length>>1];
      const b = Math.round(60000/med);
      if(b>=60 && b<=190) bpm = b;
    }

    const pct = Math.round(Cam.ema*100);
    $('#cam-motion').textContent = pct;
    $('#cam-bpm').textContent    = bpm || '—';
    $('#cam-bar').style.width    = pct+'%';
    $('#cam-hud').textContent    = bpm ? bpm+' bpm' : 'reading';

    // feed the room, rate-limited so vision never floods the window
    if(state.code && now - Cam.lastFeed > 2600){
      let v = null;
      if(Cam.ema > 0.42) v = 'fire';
      else if(Cam.ema < 0.08) v = 'sleepy';
      if(v){
        Cam.lastFeed = now;
        Cam.fed++;
        $('#cam-fed').textContent = Cam.fed;
        Cam.push(v);
      }
    }
  },

  async push(value){
    const v = { id:uid(), value, at:Date.now() };
    Room.mergeVibe(v);
    Bus.send({ t:'vibe', vibe:v });
    Room.say('pulse cam · '+value);
    if(sb) await sb.from('vibes').insert({ id:v.id, room_code:state.code, value });
  }
};

/* ------------------------------------------------------------- 8c. combo
   Rapid consecutive taps build a streak. Purely local flourish — it makes the
   dock feel like an instrument rather than a form control. */
const Combo = {
  n:0, last:0, timer:null,
  hit(){
    const now = Date.now();
    Combo.n = (now - Combo.last < 1500) ? Combo.n+1 : 1;
    Combo.last = now;
    if(Combo.n >= 3){
      const el = $('#combo');
      el.textContent = 'x'+Combo.n+' streak';
      el.classList.remove('combo--on'); void el.offsetWidth; el.classList.add('combo--on');
      clearTimeout(Combo.timer);
      Combo.timer = setTimeout(()=>el.classList.remove('combo--on'), 1500);
    }
  }
};

/* -------------------------------------------------------------- 9. router */
const Router = {
  boot(){
    window.addEventListener('hashchange', Router.go);
    Router.go();
  },
  go(){
    const code=(location.hash||'').replace('#','').trim().toUpperCase().slice(0,4);
    const inRoom = /^[A-Z0-9]{4}$/.test(code);

    if(inRoom){
      $('#screen-entry').hidden=true;  $('#screen-entry').classList.remove('screen--on');
      $('#screen-room').hidden=false;  $('#screen-room').classList.add('screen--on');
      Room.enter(code);
    } else {
      Room.leave();
      $('#screen-room').hidden=true;   $('#screen-room').classList.remove('screen--on');
      $('#screen-entry').hidden=false; $('#screen-entry').classList.add('screen--on');
      document.documentElement.style.setProperty('--e','.5');
      document.documentElement.style.setProperty('--e-hue','220');
      Entry.recents();
    }
  }
};

/* ------------------------------------------------------------- 10. sheets */
function bootSheets(){
  $('#btn-net-x').addEventListener('click',()=>{ $('#sheet-net').hidden=true; });

  $('#form-net').addEventListener('submit', async e=>{
    e.preventDefault();
    const url=$('#in-url').value.trim(), key=$('#in-key').value.trim();
    if(!url || !key) return UI.toast('Both fields are required', true);
    ls.put(K.url,url); ls.put(K.key,key);
    Cloud.boot();
    if(!sb) return UI.toast('Those credentials did not load', true);
    UI.toast('Cloud sync on');
    $('#sheet-net').hidden=true;
    if(state.code) await Room.enter(state.code);
  });

  $('#btn-net-clear').addEventListener('click',()=>{
    ls.del(K.url); ls.del(K.key);
    $('#in-url').value=''; $('#in-key').value='';
    Cloud.boot();
    UI.toast('Back to on-device mode');
    $('#sheet-net').hidden=true;
  });

  $('#btn-copy-sql').addEventListener('click', e=>{
    e.preventDefault(); e.stopPropagation();
    UI.copy($('#sql-text').textContent,'Schema copied');
  });

  $$('.sheet').forEach(sh=>sh.addEventListener('click', e=>{ if(e.target===sh) sh.hidden=true; }));
  document.addEventListener('keydown', e=>{ if(e.key==='Escape') $$('.sheet').forEach(s=>s.hidden=true); });
}

/* ---------------------------------------------------------------- 11. boot */
Cloud.boot();
Bus.boot();
bootSheets();
Entry.boot();
Room.boot();
Cam.boot();
Router.boot();

})();
