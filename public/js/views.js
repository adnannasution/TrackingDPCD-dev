// ===================================================================
// DPCD MONITORING — VIEWS: S-Curve + Kanban Board
// ===================================================================

// ---------- helpers to read a row's numbers ----------
function readRowStats(row){
    let planPct=getPlanTargetFromRow(row), actPct=getActualProgressFromRow(row);
    const rag=typeof computeRagKey==='function'?computeRagKey(planPct,actPct):'grey';
    const name=typeof getActivityNameFromRow==='function'?getActivityNameFromRow(row):((row.children[1]&&row.children[1].innerText)||'').trim().split('\n').join(' ');
    return { planPct, actPct, rag, name,
        pic:formatPicDisplay(row.getAttribute('data-pic')), blockers:parseBlockers(row.getAttribute('data-blockers')),
        category:row.getAttribute('data-category')||'', priority:row.getAttribute('data-priority')||'',
        nextAction:row.getAttribute('data-next-action')||'', dueDate:row.getAttribute('data-due')||'' };
}
// ===================================================================
// S-CURVE
// ===================================================================
function toggleSCurve(){const c=document.getElementById('scurve-container');const v=c.classList.toggle('show');if(v)renderSCurve();}
function renderSCurve(){
    const canvas=document.getElementById('scurve-canvas'); const ctx=canvas.getContext('2d');
    const meta=document.getElementById('timeline-meta');
    const startM=parseInt(meta.getAttribute('data-start-m')); const startY=parseInt(meta.getAttribute('data-start-y')); const duration=parseInt(meta.getAttribute('data-duration'));
    if(isNaN(startM)||isNaN(duration)||duration<1)return;
    const monthShort=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const labels=[]; let cm=startM,cy=startY;
    for(let i=0;i<duration;i++){labels.push(monthShort[cm]+' '+String(cy).slice(-2));cm++;if(cm>11){cm=0;cy++;}}
    // Distribusi memakai tanggal absolut (canonical) tiap task → akurat ke FULL
    // project. Bulan sebelum window tetap dihitung sbg baseline kumulatif, sehingga
    // saat window digeser ke depan, kurva tetap mencerminkan progres sesungguhnya.
    const winStart=startY*12+startM;
    const rows=document.querySelectorAll('.gantt-row'); let projectCount=0;
    const planByAbs={}, actByAbs={};
    rows.forEach(row=>{
        const c=(typeof getRowCanonical==='function')?getRowCanonical(row):{};
        const hasPlan=c.planStart&&c.planEnd, hasAct=c.actualStart&&c.actualEnd;
        if(!hasPlan&&!hasAct)return;
        projectCount++;
        if(hasPlan){const s=absIndex(c.planStart),e=absIndex(c.planEnd);if(!isNaN(s)&&!isNaN(e)&&e>=s){const n=e-s+1;const share=100/n;for(let m=s;m<=e;m++)planByAbs[m]=(planByAbs[m]||0)+share;}}
        if(hasAct){const actPct=c.actualProgress||0;if(actPct>0){const s=absIndex(c.actualStart),e=absIndex(c.actualEnd);if(!isNaN(s)&&!isNaN(e)&&e>=s){const n=e-s+1;const share=actPct/n;for(let m=s;m<=e;m++)actByAbs[m]=(actByAbs[m]||0)+share;}}}
    });
    const div=Math.max(projectCount,1);
    // Baseline: akumulasi semua bulan sebelum window agar kurva mulai dari nilai benar.
    let pSum=0,aSum=0;
    for(const k in planByAbs){ if(parseInt(k)<winStart) pSum+=planByAbs[k]/div; }
    for(const k in actByAbs){ if(parseInt(k)<winStart) aSum+=actByAbs[k]/div; }
    const planCum=[],actCum=[];
    for(let i=0;i<duration;i++){const m=winStart+i;if(planByAbs[m])pSum+=planByAbs[m]/div;if(actByAbs[m])aSum+=actByAbs[m]/div;planCum.push(Math.min(pSum,100));actCum.push(Math.min(aSum,100));}
    let cutoffIdx=-1;
    const cv=document.getElementById('cfg-cutoff').value;
    if(cv){const cd=new Date(cv);const cM=cd.getMonth(),cY=cd.getFullYear();let mi=parseInt(meta.getAttribute('data-start-m')),yi=parseInt(meta.getAttribute('data-start-y'));for(let i=0;i<duration;i++){if(yi===cY&&mi===cM){cutoffIdx=i;break;}mi++;if(mi>11){mi=0;yi++;}}}
    const dpr=window.devicePixelRatio||1; const rect=canvas.parentElement.getBoundingClientRect();
    canvas.width=rect.width*dpr;canvas.height=300*dpr;canvas.style.width=rect.width+'px';canvas.style.height='300px';
    ctx.scale(dpr,dpr); const W=rect.width,H=300;
    ctx.clearRect(0,0,W,H);
    const padL=45,padR=15,padT=20,padB=50,chartW=W-padL-padR,chartH=H-padT-padB;
    ctx.strokeStyle='#eef1f6';ctx.lineWidth=1;ctx.fillStyle='#8c97a8';ctx.font='11px Inter, sans-serif';ctx.textAlign='right';
    for(let p=0;p<=100;p+=20){const y=padT+chartH-(p/100)*chartH;ctx.beginPath();ctx.moveTo(padL,y);ctx.lineTo(padL+chartW,y);ctx.stroke();ctx.fillText(p+'%',padL-6,y+4);}
    ctx.textAlign='center';ctx.fillStyle='#8c97a8';ctx.font='10px Inter, sans-serif';
    const step=duration<=12?1:(duration<=24?2:3);
    for(let i=0;i<duration;i+=step){const x=padL+(i/(duration-1))*chartW;ctx.save();ctx.translate(x,padT+chartH+12);ctx.rotate(-0.5);ctx.fillText(labels[i],0,0);ctx.restore();}
    function drawLine(data,color,lw,dashed){ctx.strokeStyle=color;ctx.lineWidth=lw;ctx.setLineDash(dashed||[]);ctx.beginPath();for(let i=0;i<data.length;i++){const x=padL+(i/(duration-1))*chartW;const y=padT+chartH-(data[i]/100)*chartH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}ctx.stroke();ctx.setLineDash([]);}
    ctx.beginPath();for(let i=0;i<duration;i++){const x=padL+(i/(duration-1))*chartW;const y=padT+chartH-(planCum[i]/100)*chartH;if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);}
    for(let i=duration-1;i>=0;i--){const x=padL+(i/(duration-1))*chartW;const y=padT+chartH-(actCum[i]/100)*chartH;ctx.lineTo(x,y);}
    ctx.closePath();ctx.fillStyle='rgba(220,38,38,0.06)';ctx.fill();
    drawLine(planCum,'#7ba7c9',2.5);drawLine(actCum,'#0e7c86',2.5);
    planCum.forEach((v,i)=>{const x=padL+(i/(duration-1))*chartW;const y=padT+chartH-(v/100)*chartH;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#7ba7c9';ctx.fill();});
    actCum.forEach((v,i)=>{const x=padL+(i/(duration-1))*chartW;const y=padT+chartH-(v/100)*chartH;ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fillStyle='#0e7c86';ctx.fill();});
    if(cutoffIdx>=0&&cutoffIdx<duration){const cx=padL+(cutoffIdx/(duration-1))*chartW;ctx.strokeStyle='#dc2626';ctx.lineWidth=1.5;ctx.setLineDash([6,4]);ctx.beginPath();ctx.moveTo(cx,padT);ctx.lineTo(cx,padT+chartH);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#dc2626';ctx.font='bold 10px Inter, sans-serif';ctx.textAlign='center';ctx.fillText('Cut-off',cx,padT-5);}
    canvas.onmousemove=function(e){const r2=canvas.getBoundingClientRect();const mx=e.clientX-r2.left;const idx=Math.round(((mx-padL)/chartW)*(duration-1));if(idx<0||idx>=duration){canvas.title='';return;}canvas.title=labels[idx]+'\nPlan: '+planCum[idx].toFixed(1)+'%\nActual: '+actCum[idx].toFixed(1)+'%';};
}

// ===================================================================
// KANBAN BOARD — columns per RAG status
// ===================================================================
const BOARD_COLS = [
    { key:'bg-red',   title:'Delay',         color:'var(--crit)',    c:'#dc2626' },
    { key:'bg-yellow',title:'Slightly Delay',color:'var(--warn)',    c:'#d9890b' },
    { key:'bg-green', title:'On Track',    color:'var(--ontrack)', c:'#15a34a' },
    { key:'bg-blue',  title:'Done',        color:'var(--done)',    c:'#2563eb' },
    { key:'bg-grey',  title:'Belum Mulai', color:'var(--idle)',    c:'#94a3b8' },
];

// Membangun markup satu kartu kanban. Dipakai bersama oleh renderBoard & accordion PIC.
// `color` = warna border kartu (hex), `statusKey` = key RAG ('red'/'bg-red'/dst) untuk cek overdue.
function buildBoardCardHTML(s, color, statusKey){
    const dev = s.actPct - s.planPct;
    const devCls = dev>0?'pos':dev<0?'neg':'eq';
    const devTxt = dev>0?'▲ +'+dev+'%':dev<0?'▼ '+dev+'%':'= 0%';
    const initials = s.pic ? s.pic.trim().split(/[ ;,]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase() : '';
    const picHTML = s.pic ? `<div class="bcf-pic"><span class="avatar">${escapeHTML(initials)}</span><span title="${escapeHTML(s.pic)}">${escapeHTML(s.pic.split(';')[0])}</span></div>` : `<div class="bcf-pic" style="color:var(--ink-3)">PIC —</div>`;
    const tags = [];
    if(s.category) tags.push(`<span class="bc-tag">${escapeHTML(s.category)}</span>`);
    if(s.priority) tags.push(`<span class="bc-tag pri-${s.priority}">${escapeHTML(s.priority)}</span>`);
    const blockerHTML = (s.blockers && s.blockers.length) ? `<div class="board-card-blocker"><span class="bc-blk-lbl">⛔ Blocker</span>${s.blockers.map(b=>`<span class="bc-blk">${escapeHTML(b)}</span>`).join('')}</div>` : '';
    return `<div class="board-card" style="--c:${color}" data-board-card>
                <div class="board-card-name">${escapeHTML(s.name)}</div>
                ${tags.length?`<div class="board-card-meta">${tags.join('')}</div>`:''}
                ${blockerHTML}
                <div class="board-card-bars">
                    <div class="bcb-row"><span class="bcb-lbl">Plan</span><div class="bcb-track"><div class="bcb-fill plan" style="width:${s.planPct}%"></div></div><span class="bcb-val num">${s.planPct}%</span></div>
                    <div class="bcb-row"><span class="bcb-lbl">Act</span><div class="bcb-track"><div class="bcb-fill act" style="width:${s.actPct}%"></div></div><span class="bcb-val num">${s.actPct}%</span></div>
                </div>
                ${s.nextAction?`<div class="board-card-action"><span class="bca-lbl">\u{1F3AF} Aksi</span><span class="bca-txt">${escapeHTML(s.nextAction)}</span></div>`:''}
                ${s.dueDate?`<div class="board-card-due${(typeof isOverdue==='function'&&isOverdue(s.dueDate,statusKey))?' overdue':''}">\u{1F4C5} Due: ${escapeHTML(formatDue(s.dueDate))}${(typeof isOverdue==='function'&&isOverdue(s.dueDate,statusKey))?' • OVERDUE':''}</div>`:''}
                <div class="board-card-foot">${picHTML}<span class="bcf-dev ${devCls} num">${devTxt}</span></div>
            </div>`;
}

function renderBoard(){
    const container = document.getElementById('board-scroll');
    if(!container) return;
    const rows = Array.from(document.querySelectorAll('.gantt-row'));
    // honour active filter (but still show all columns; just dim none)
    const visibleRows = activeFilter==='all' ? rows : rows.filter(r=>{const tl=r.querySelector('.traffic-light');return tl&&tl.classList.contains(activeFilter);});
    container.innerHTML = '';
    let shown = 0;
    BOARD_COLS.forEach(col=>{
        if(activeFilter!=='all' && col.key!==activeFilter) return;
        const colRows = visibleRows.filter(r=>{const tl=r.querySelector('.traffic-light');return tl&&tl.classList.contains(col.key);});
        const colEl = document.createElement('div');
        colEl.className='board-col';
        let cards='';
        colRows.forEach(row=>{
            const s = readRowStats(row);
            if(!s.name) return;
            shown++;
            cards += buildBoardCardHTML(s, col.c, col.key);
        });
        colEl.innerHTML = `
            <div class="board-col-head">
                <span class="board-col-dot" style="background:${col.color}"></span>
                <span class="board-col-title">${col.title}</span>
                <span class="board-col-count num">${colRows.length}</span>
            </div>
            <div class="board-col-body">${cards || '<div class="board-empty">Tidak ada project</div>'}</div>`;
        // Mobile portrait: header bisa diklik untuk lipat/buka kolom.
        // toggleBoardCol no-op secara visual di layar lebar (CSS .collapsed hanya aktif di portrait).
        colEl.querySelector('.board-col-head').addEventListener('click', function(){
            colEl.classList.toggle('collapsed');
        });
        container.appendChild(colEl);
        // wire card clicks to detail modal
        const cardEls = colEl.querySelectorAll('[data-board-card]');
        cardEls.forEach((el,i)=>{ el.onclick = ()=>openProjectDetail(colRows[i]); });
    });
    const cp = document.getElementById('view-count');
    if(cp) cp.textContent = shown + ' project';
}

// ===================================================================
// BLOCKER ANALYSIS — Pareto & Impact + Owner/Aksi (decision support)
// ===================================================================
const RAG_DOT = { red:'#dc2626', yellow:'#d9890b', green:'#15a34a', blue:'#2563eb', grey:'#94a3b8' };

function renderBlocker(){
    const body = document.getElementById('blocker-body');
    if(!body) return;
    // Petakan nama project → baris (untuk drill-down ke detail).
    const rowByName = {};
    document.querySelectorAll('.gantt-row').forEach(row=>{
        const n = (typeof getActivityNameFromRow==='function') ? getActivityNameFromRow(row) : '';
        if(n && !rowByName[n]) rowByName[n] = row;
    });
    const projects = (typeof collectBlockerProjects==='function') ? collectBlockerProjects() : [];
    const agg = (typeof aggregateBlockers==='function') ? aggregateBlockers(projects) : { items:[], totalBlocked:0, useImpact:false };
    const items = agg.items;
    const cp = document.getElementById('view-count');
    if(cp) cp.textContent = items.length + ' kategori · ' + agg.totalBlocked + ' project ter-blok';

    if(!items.length){
        body.innerHTML = '<div class="blk-empty"><span>🛡️</span>Tidak ada blocker tercatat. Tetapkan blocker lewat panel detail project untuk mulai menganalisis bottleneck.</div>';
        return;
    }

    const top = items[0];
    const vital = items.filter(e=>e.vital);
    const maxW = Math.max(1, ...items.map(e=> e.sharePct));

    // 1) KPI ringkas
    const kpiHTML =
        '<div class="blk-kpis">'
        + '<div class="blk-kpi"><div class="blk-kpi-val">'+agg.totalBlocked+'</div><div class="blk-kpi-lbl">Project ter-blok</div></div>'
        + '<div class="blk-kpi"><div class="blk-kpi-val">'+items.length+'</div><div class="blk-kpi-lbl">Kategori blocker aktif</div></div>'
        + '<div class="blk-kpi blk-kpi-top"><div class="blk-kpi-val">'+escapeHTML(top.category)+'</div><div class="blk-kpi-lbl">Blocker paling berdampak</div></div>'
        + '<div class="blk-kpi"><div class="blk-kpi-val">'+vital.length+'</div><div class="blk-kpi-lbl">Vital few (≤80% dampak)</div></div>'
        + '</div>';

    // 2) Pareto (bar + % dampak per blocker, total = 100%)
    const metricLbl = agg.useImpact ? 'Impact (Σ keterlambatan project at-risk)' : 'Frekuensi (jumlah project)';
    const paretoRows = items.map(e=>{
        const w = Math.round(e.sharePct/maxW*100);
        return '<div class="blk-par-row'+(e.vital?' vital':'')+'">'
            + '<span class="blk-par-name" title="'+escapeHTML(e.category)+'">'+escapeHTML(e.category)+'</span>'
            + '<div class="blk-par-bar"><div class="blk-par-fill" style="width:'+w+'%"></div></div>'
            + '<span class="blk-par-val num">'+e.sharePct+'%</span>'
            + '</div>';
    }).join('');
    const paretoHTML =
        '<div class="blk-card"><div class="blk-card-title">Pareto Blocker <span class="blk-card-sub">'+metricLbl+'</span></div>'
        + '<div class="blk-par-legend"><span><span class="blk-dot-vital"></span>Vital few (fokus utama)</span><span class="blk-par-cumlbl">% = dampak (total 100%)</span></div>'
        + '<div class="blk-par-list">'+paretoRows+'</div></div>';

    // 3) Panel rekomendasi
    const recItems = vital.map(e=>'<li><b>'+escapeHTML(e.category)+'</b> → '+escapeHTML(e.owner)+': '+escapeHTML(e.action)+'</li>').join('');
    const recHTML =
        '<div class="blk-card blk-rec"><div class="blk-card-title">🎯 Rekomendasi Fokus</div>'
        + '<p class="blk-rec-lead">Fokuskan penyelesaian pada <b>'+vital.length+' kategori vital few</b> berikut — menyumbang ±80% total dampak keterlambatan:</p>'
        + '<ul class="blk-rec-list">'+recItems+'</ul></div>';

    // 4) Kartu per kategori (diurut by impact)
    const cardsHTML = items.map((e,idx)=>{
        const projHTML = e.projects
            .slice().sort((a,b)=> (b.atRisk?1:0)-(a.atRisk?1:0) || (a.actPct-a.planPct)-(b.actPct-b.planPct))
            .map(p=>{
                const dev = p.actPct - p.planPct;
                const devTxt = dev>0?'▲ +'+dev+'%':dev<0?'▼ '+dev+'%':'= 0%';
                return '<div class="blk-proj" data-proj-name="'+escapeAttr(p.name)+'" role="button" tabindex="0">'
                    + '<span class="blk-proj-dot" style="background:'+(RAG_DOT[p.rag]||RAG_DOT.grey)+'"></span>'
                    + '<span class="blk-proj-name">'+escapeHTML(p.name)+'</span>'
                    + '<span class="blk-proj-dev num '+(dev<0?'neg':dev>0?'pos':'eq')+'">'+devTxt+'</span></div>';
            }).join('');
        return '<div class="blk-card blk-cat-card'+(e.vital?' vital':'')+'">'
            + '<div class="blk-cat-head"><span class="blk-cat-rank">#'+(idx+1)+'</span><span class="blk-cat-name">'+escapeHTML(e.category)+'</span>'
            + (e.vital?'<span class="blk-cat-flag">VITAL</span>':'')+'</div>'
            + '<div class="blk-cat-stats"><span><b class="num">'+e.count+'</b> project</span><span><b class="num">'+e.riskCount+'</b> at-risk</span><span>Impact <b class="num">'+e.sharePct+'%</b></span></div>'
            + '<div class="blk-cat-owner"><span class="blk-tag-lbl">👤 Owner</span> '+escapeHTML(e.owner)+'</div>'
            + '<div class="blk-cat-action"><span class="blk-tag-lbl">🎯 Aksi</span> '+escapeHTML(e.action)+'</div>'
            + '<div class="blk-cat-projs">'+projHTML+'</div>'
            + '</div>';
    }).join('');

    body.innerHTML = kpiHTML
        + '<div class="blk-top-grid">'+paretoHTML+recHTML+'</div>'
        + '<div class="blk-cat-grid">'+cardsHTML+'</div>';

    // Drill-down: klik project → buka detail.
    body.querySelectorAll('.blk-proj').forEach(el=>{
        const open = ()=>{ const row = rowByName[el.dataset.projName]; if(row && typeof openProjectDetail==='function') openProjectDetail(row); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); open(); } });
    });
}

// ===================================================================
// PIC WORKLOAD — beban tiap PIC + breakdown status
// ===================================================================
const PIC_STATUS_META = [
    { key:'red',    label:'Delay',          cls:'pic-delay',   color:'var(--crit)',    c:'#dc2626' },
    { key:'yellow', label:'Slightly Delay', cls:'pic-slight',  color:'var(--warn)',    c:'#d9890b' },
    { key:'green',  label:'On Track',       cls:'pic-ontrack', color:'var(--ontrack)', c:'#15a34a' },
    { key:'blue',   label:'Done',           cls:'pic-done',    color:'var(--done)',    c:'#2563eb' },
];
const PIC_NO_OWNER = 'Belum ada PIC';

function renderPic(){
    const body = document.getElementById('pic-body');
    if(!body) return;
    const rows = Array.from(document.querySelectorAll('.gantt-row'));
    // Agregasi per PIC. Proyek multi-PIC dihitung ke tiap nama. Status grey diabaikan.
    const map = {};
    const ensure = name => (map[name] || (map[name] = { name, total:0, red:0, yellow:0, green:0, blue:0, rows:{ red:[], yellow:[], green:[], blue:[] } }));
    let totalProjects = 0;
    rows.forEach(row=>{
        const name = getActivityNameFromRow(row);
        if(!name) return;
        const rag = computeRowRagKey(row);
        if(rag === 'grey') return; // belum mulai → tidak dihitung sebagai beban aktif
        totalProjects++;
        const pics = parsePicValue(row.getAttribute('data-pic'));
        const owners = pics.length ? pics : [PIC_NO_OWNER];
        owners.forEach(p=>{ const e = ensure(p); e.total++; if(e[rag]!==undefined){ e[rag]++; e.rows[rag].push(row); } });
    });
    const list = Object.keys(map).map(k=>map[k]).sort((a,b)=>{
        if(a.name===PIC_NO_OWNER) return 1; if(b.name===PIC_NO_OWNER) return -1;
        return b.total-a.total || a.name.localeCompare(b.name);
    });
    if(!list.length){
        body.innerHTML = '<div class="pic-empty">Belum ada project aktif dengan PIC. Tetapkan PIC lewat panel detail project.</div>';
        const cp=document.getElementById('view-count'); if(cp) cp.textContent='0 PIC';
        return;
    }
    const cards = list.map(e=>{
        const initials = e.name===PIC_NO_OWNER ? '—' : e.name.trim().split(/[ ;,]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase();
        const stats = PIC_STATUS_META.map(m=>`<div class="pic-stat ${m.cls}" data-status="${m.key}" role="button" tabindex="0" title="Klik untuk lihat project ${m.label}"><span class="pic-stat-val num">${e[m.key]}</span><span class="pic-stat-lbl">${m.label}</span></div>`).join('');
        return `<div class="pic-card" data-pic-name="${escapeHTML(e.name)}">
            <div class="pic-card-head">
                <span class="pic-avatar">${escapeHTML(initials)}</span>
                <span class="pic-name" title="${escapeHTML(e.name)}">${escapeHTML(e.name)}</span>
                <span class="pic-total num" title="Total project ditangani">${e.total}</span>
            </div>
            <div class="pic-stats">${stats}</div>
            <div class="pic-accordion"><div class="pic-accordion-body"></div></div>
        </div>`;
    }).join('');
    body.innerHTML = `<div class="pic-chart-wrap"><canvas id="pic-chart-canvas"></canvas></div><div class="pic-grid">${cards}</div>`;
    _lastPicList = list;
    wirePicStats(list);
    renderPicChart(list);
    const cp = document.getElementById('view-count');
    if(cp) cp.textContent = list.length + ' PIC · ' + totalProjects + ' project';
}

// Cache list terakhir untuk redraw chart saat resize (tanpa menutup accordion yang terbuka).
let _lastPicList = null;

// Wiring klik kotak status → expand/collapse accordion kanban di dalam kartu PIC.
function wirePicStats(list){
    const byName = {};
    list.forEach(e=>{ byName[e.name] = e; });
    document.querySelectorAll('#pic-body .pic-card').forEach(card=>{
        const e = byName[card.dataset.picName];
        if(!e) return;
        const panel = card.querySelector('.pic-accordion');
        const panelBody = panel.querySelector('.pic-accordion-body');
        card.querySelectorAll('.pic-stat').forEach(stat=>{
            const open = ()=>{
                const status = stat.dataset.status;
                const already = stat.classList.contains('active') && panel.classList.contains('open');
                card.querySelectorAll('.pic-stat').forEach(s=>s.classList.remove('active'));
                if(already){ panel.classList.remove('open'); return; } // klik kotak yang sama → collapse
                stat.classList.add('active');
                renderPicAccordion(panelBody, e.rows[status], status);
                panel.classList.add('open');
            };
            stat.addEventListener('click', open);
            stat.addEventListener('keydown', ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); open(); } });
        });
    });
}

// Isi accordion: daftar kartu kanban untuk satu PIC + satu status. Reuse buildBoardCardHTML.
function renderPicAccordion(panelBody, rows, statusKey){
    if(!rows || !rows.length){ panelBody.innerHTML = '<div class="board-empty">Tidak ada project</div>'; return; }
    const meta = PIC_STATUS_META.find(m=>m.key===statusKey);
    const color = meta ? meta.c : '#94a3b8';
    panelBody.innerHTML = rows.map(row=>buildBoardCardHTML(readRowStats(row), color, statusKey)).join('');
    panelBody.querySelectorAll('[data-board-card]').forEach((el,i)=>{ el.onclick = ()=>openProjectDetail(rows[i]); });
}

// Stacked bar chart per PIC (Canvas). X = nama PIC, segmen = jumlah tiap status.
function renderPicChart(list){
    const canvas = document.getElementById('pic-chart-canvas');
    if(!canvas || !list || !list.length) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const H = 280;
    canvas.width = rect.width*dpr; canvas.height = H*dpr;
    canvas.style.width = rect.width+'px'; canvas.style.height = H+'px';
    ctx.setTransform(1,0,0,1,0,0); ctx.scale(dpr,dpr);
    const W = rect.width;
    ctx.clearRect(0,0,W,H);
    const padL=36, padR=14, padT=16, padB=58, chartW=W-padL-padR, chartH=H-padT-padB;
    const maxTotal = Math.max(1, ...list.map(e=>e.total));
    // skala sumbu Y: bulatkan ke kelipatan yang rapi
    const niceStep = (m)=>{ const raw=m/4; const pow=Math.pow(10,Math.floor(Math.log10(raw))); const n=raw/pow; const f=n<=1?1:n<=2?2:n<=5?5:10; return Math.max(1,f*pow); };
    const step = niceStep(maxTotal);
    const yMax = Math.ceil(maxTotal/step)*step;
    // grid + label Y
    ctx.strokeStyle='#eef1f6'; ctx.lineWidth=1; ctx.fillStyle='#8c97a8'; ctx.font='11px Inter, sans-serif'; ctx.textAlign='right';
    for(let v=0; v<=yMax; v+=step){ const y=padT+chartH-(v/yMax)*chartH; ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(padL+chartW,y); ctx.stroke(); ctx.fillText(String(v), padL-6, y+4); }
    // bar geometry
    const n=list.length;
    const band=chartW/n;
    const barW=Math.min(46, band*0.6);
    list.forEach((e,i)=>{
        const cx=padL+band*i+band/2;
        const x=cx-barW/2;
        let yTop=padT+chartH;
        PIC_STATUS_META.forEach(m=>{
            const val=e[m.key]||0; if(val<=0) return;
            const h=(val/yMax)*chartH;
            yTop-=h;
            ctx.fillStyle=m.c;
            ctx.fillRect(x, yTop, barW, h);
        });
        // total di atas bar
        const totalH=(e.total/yMax)*chartH;
        ctx.fillStyle='#374151'; ctx.font='bold 11px Inter, sans-serif'; ctx.textAlign='center';
        if(e.total>0) ctx.fillText(String(e.total), cx, padT+chartH-totalH-5);
        // label X (nama PIC), dirotasi bila ramai
        ctx.fillStyle='#475569'; ctx.font='10px Inter, sans-serif';
        const label=e.name.length>14?e.name.slice(0,13)+'…':e.name;
        ctx.save(); ctx.translate(cx, padT+chartH+12);
        if(n>5){ ctx.rotate(-0.5); ctx.textAlign='right'; ctx.fillText(label,0,0); }
        else { ctx.textAlign='center'; ctx.fillText(label,0,4); }
        ctx.restore();
    });
}

// ===================================================================
// PROGNOSA & FORECAST — prognosa penyelesaian sebagai decision support
// ===================================================================
// Prognosa = estimasi tanggal selesai untuk project delay. View ini mengubah
// estimasi tsb menjadi roadmap pemulihan + menyoroti gap (delay tanpa prognosa),
// prognosa yang sudah terlewat, dan prognosa yang melewati due date.
const PROG_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

// Selisih hari (b - a) berbasis tanggal murni (abaikan jam). null bila tak valid.
function prognosaDaysBetween(a, b){
    const da = new Date(a), db = new Date(b);
    if(isNaN(da)||isNaN(db)) return null;
    da.setHours(0,0,0,0); db.setHours(0,0,0,0);
    return Math.round((db - da)/86400000);
}

function renderPrognosa(){
    const body = document.getElementById('prognosa-body');
    if(!body) return;
    const cutoff = getCutoffDate();
    const rowByName = {};
    const projects = [];
    document.querySelectorAll('.gantt-row').forEach(row=>{
        const name = getActivityNameFromRow(row);
        if(!name) return;
        if(!rowByName[name]) rowByName[name] = row;
        const rag = computeRowRagKey(row);
        const atRisk = (rag==='red' || rag==='yellow');
        const prognosa = row.getAttribute('data-prognosa') || '';
        // Relevan hanya untuk project delay, atau project apa pun yang sudah punya prognosa.
        if(!atRisk && !prognosa) return;
        const planPct = getPlanTargetFromRow(row);
        const actPct = Math.round(getActualProgressFromRow(row) || 0);
        const dueDate = row.getAttribute('data-due') || '';
        const p = { name, rag, atRisk, prognosa, planPct, actPct, dueDate,
            pic: formatPicDisplay(row.getAttribute('data-pic')) };
        if(prognosa){
            p.progDays = prognosaDaysBetween(cutoff, prognosa);            // <0 = sudah terlewat
            p.missed = (p.progDays !== null && p.progDays < 0);
            p.health = p.missed ? 'missed' : (p.progDays !== null && p.progDays <= 30 ? 'soon' : 'scheduled');
            p.slipDays = dueDate ? prognosaDaysBetween(dueDate, prognosa) : null; // >0 = lewat due date
        }
        projects.push(p);
    });

    const atRisk = projects.filter(p=>p.atRisk);
    const withProg = projects.filter(p=>p.prognosa);
    const atRiskWithProg = atRisk.filter(p=>p.prognosa);
    const noProg = atRisk.filter(p=>!p.prognosa);
    const missed = withProg.filter(p=>p.missed);
    const slipped = withProg.filter(p=>p.slipDays !== null && p.slipDays > 0);
    const coverage = atRisk.length ? Math.round(atRiskWithProg.length/atRisk.length*100) : 0;

    const cp = document.getElementById('view-count');
    if(cp) cp.textContent = atRisk.length + ' project delay · ' + coverage + '% ada prognosa';

    if(!atRisk.length && !withProg.length){
        body.innerHTML = '<div class="prog-empty"><span>🏁</span>Belum ada project berstatus delay. Prognosa penyelesaian akan muncul di sini begitu ada project yang perlu estimasi pemulihan.</div>';
        return;
    }

    // 1) KPI ringkas
    const kpiHTML = '<div class="blk-kpis">'
        + '<div class="blk-kpi"><div class="blk-kpi-val">'+atRisk.length+'</div><div class="blk-kpi-lbl">Project delay</div></div>'
        + '<div class="blk-kpi"><div class="blk-kpi-val" style="color:var(--ontrack)">'+atRiskWithProg.length+'</div><div class="blk-kpi-lbl">Sudah ada prognosa</div></div>'
        + '<div class="blk-kpi"><div class="blk-kpi-val" style="color:'+(noProg.length?'var(--warn)':'var(--ink)')+'">'+noProg.length+'</div><div class="blk-kpi-lbl">Belum ada prognosa</div></div>'
        + '<div class="blk-kpi"><div class="blk-kpi-val" style="color:'+(missed.length?'var(--crit)':'var(--ink)')+'">'+missed.length+'</div><div class="blk-kpi-lbl">Prognosa terlewat</div></div>'
        + '</div>';

    // 2) Cakupan prognosa + rekomendasi
    const noProgList = noProg.length
        ? noProg.slice().sort((a,b)=>(a.actPct-a.planPct)-(b.actPct-b.planPct)).map(p=>progChip(p)).join('')
        : '<div class="prog-allset">✅ Semua project delay sudah punya prognosa penyelesaian.</div>';
    const coverageHTML = '<div class="blk-card">'
        + '<div class="blk-card-title">Cakupan Prognosa <span class="blk-card-sub">'+atRiskWithProg.length+' / '+atRisk.length+' project delay</span></div>'
        + '<div class="prog-cov"><div class="prog-cov-ring" style="--pct:'+coverage+'"><span>'+coverage+'%</span></div>'
        + '<div class="prog-cov-side"><div class="prog-cov-line"><b>'+noProg.length+'</b> project delay belum punya estimasi selesai</div>'
        + '<div class="prog-cov-chips">'+noProgList+'</div></div></div></div>';

    const insights = [];
    if(noProg.length) insights.push('<li><b>'+noProg.length+' project</b> belum punya prognosa — tetapkan estimasi selesai lewat panel detail agar pemulihan bisa dipantau.</li>');
    if(missed.length) insights.push('<li><b>'+missed.length+' prognosa terlewat</b> namun project belum selesai — perlu re-baseline jadwal atau eskalasi.</li>');
    if(slipped.length) insights.push('<li><b>'+slipped.length+' project</b> diprognosakan selesai <b>melewati due date</b> — konfirmasi dampaknya ke komitmen.</li>');
    if(!insights.length) insights.push('<li>Seluruh prognosa masih dalam jalur. Pantau project dengan estimasi terdekat agar tetap tercapai.</li>');
    const insightHTML = '<div class="blk-card blk-rec"><div class="blk-card-title">🎯 Rekomendasi Fokus</div><ul class="blk-rec-list">'+insights.join('')+'</ul></div>';

    // 3) Roadmap pemulihan — prognosa selesai dikelompokkan per bulan (kronologis)
    let roadmapHTML = '';
    if(withProg.length){
        const groups = {};
        withProg.forEach(p=>{
            const d = new Date(p.prognosa); if(isNaN(d)) return;
            const k = d.getFullYear()+'-'+String(d.getMonth()).padStart(2,'0');
            (groups[k] || (groups[k] = { y:d.getFullYear(), m:d.getMonth(), items:[] })).items.push(p);
        });
        const cols = Object.keys(groups).sort().map(k=>{
            const g = groups[k];
            const chips = g.items.slice().sort((a,b)=> new Date(a.prognosa)-new Date(b.prognosa)).map(p=>progChip(p,true)).join('');
            return '<div class="prog-rm-col"><div class="prog-rm-month">'+PROG_MONTHS[g.m]+' '+g.y+'<span class="prog-rm-count num">'+g.items.length+'</span></div><div class="prog-rm-items">'+chips+'</div></div>';
        }).join('');
        roadmapHTML = '<div class="blk-card"><div class="blk-card-title">Roadmap Pemulihan <span class="blk-card-sub">prognosa selesai per bulan</span></div><div class="prog-rm-scroll">'+cols+'</div></div>';
    }

    // 4) Kartu kesehatan forecast per project (urut: terlewat → mendesak → terjadwal)
    let cardsHTML = '';
    if(withProg.length){
        const order = { missed:0, soon:1, scheduled:2 };
        cardsHTML = '<div class="prog-card-grid">'
            + withProg.slice().sort((a,b)=> (order[a.health]-order[b.health]) || (new Date(a.prognosa)-new Date(b.prognosa))).map(p=>progCard(p)).join('')
            + '</div>';
    }

    body.innerHTML = kpiHTML + '<div class="blk-top-grid">'+coverageHTML+insightHTML+'</div>' + roadmapHTML + cardsHTML;

    // Drill-down: klik chip/kartu → buka detail project.
    body.querySelectorAll('[data-proj-name]').forEach(el=>{
        const open = ()=>{ const row = rowByName[el.dataset.projName]; if(row && typeof openProjectDetail==='function') openProjectDetail(row); };
        el.addEventListener('click', open);
        el.addEventListener('keydown', ev=>{ if(ev.key==='Enter'||ev.key===' '){ ev.preventDefault(); open(); } });
    });
}

// Chip ringkas untuk daftar cakupan & roadmap. withDate → tampilkan tanggal prognosa.
function progChip(p, withDate){
    const dot = RAG_DOT[p.rag] || RAG_DOT.grey;
    const date = (withDate && p.prognosa) ? '<span class="prog-chip-date">'+escapeHTML(formatDue(p.prognosa))+'</span>' : '';
    const cls = p.health ? ' prog-h-'+p.health : '';
    return '<div class="prog-chip'+cls+'" data-proj-name="'+escapeAttr(p.name)+'" role="button" tabindex="0">'
        + '<span class="prog-chip-dot" style="background:'+dot+'"></span>'
        + '<span class="prog-chip-name" title="'+escapeAttr(p.name)+'">'+escapeHTML(p.name)+'</span>'+date+'</div>';
}

// Kartu detail kesehatan forecast untuk satu project.
function progCard(p){
    const dev = p.actPct - p.planPct;
    const devTxt = dev>0?'▲ +'+dev+'%':dev<0?'▼ '+dev+'%':'= 0%';
    const HEALTH = { missed:{lbl:'Terlewat'}, soon:{lbl:'Mendesak'}, scheduled:{lbl:'Terjadwal'} };
    const h = HEALTH[p.health] || HEALTH.scheduled;
    const when = p.progDays===null ? '' : (p.progDays<0 ? Math.abs(p.progDays)+' hari lalu' : p.progDays===0 ? 'hari ini' : 'dalam '+p.progDays+' hari');
    const dueHTML = p.dueDate
        ? '<div class="prog-card-due">📅 Due: '+escapeHTML(formatDue(p.dueDate))+(p.slipDays!==null&&p.slipDays>0?' <span class="prog-slip">geser +'+p.slipDays+' hari</span>':'')+'</div>'
        : '';
    const picHTML = p.pic ? '<span class="prog-card-pic">👤 '+escapeHTML(p.pic.split(';')[0])+'</span>' : '<span class="prog-card-pic" style="color:var(--ink-3)">PIC —</span>';
    return '<div class="prog-card prog-h-'+p.health+'" data-proj-name="'+escapeAttr(p.name)+'" role="button" tabindex="0">'
        + '<div class="prog-card-head"><span class="prog-card-dot" style="background:'+(RAG_DOT[p.rag]||RAG_DOT.grey)+'"></span><span class="prog-card-name">'+escapeHTML(p.name)+'</span><span class="prog-badge prog-b-'+p.health+'">'+h.lbl+'</span></div>'
        + '<div class="prog-card-finish">🏁 Prognosa: <b>'+escapeHTML(formatDue(p.prognosa))+'</b>'+(when?' <span class="prog-when">'+when+'</span>':'')+'</div>'
        + dueHTML
        + '<div class="prog-card-bars"><div class="bcb-row"><span class="bcb-lbl">Plan</span><div class="bcb-track"><div class="bcb-fill plan" style="width:'+p.planPct+'%"></div></div><span class="bcb-val num">'+p.planPct+'%</span></div>'
        + '<div class="bcb-row"><span class="bcb-lbl">Act</span><div class="bcb-track"><div class="bcb-fill act" style="width:'+p.actPct+'%"></div></div><span class="bcb-val num">'+p.actPct+'%</span></div></div>'
        + '<div class="prog-card-foot">'+picHTML+'<span class="bcf-dev '+(dev<0?'neg':dev>0?'pos':'eq')+' num">'+devTxt+'</span></div>'
        + '</div>';
}
