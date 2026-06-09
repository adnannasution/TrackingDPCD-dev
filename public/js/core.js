// ===================================================================
// DPCD MONITORING — CORE: file I/O, render, gantt, filter, pagination
// ===================================================================
const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthNamesID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
// "Agu '26" dari index bulan timeline
function monthYearShortFromIdx(idx){
    const cfg=getTimelineConfig();
    const d=new Date(cfg.startY, cfg.startM+idx, 1);
    return monthNamesID[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
}
// "Agu'26" dari string tanggal ISO (utk chip prognosa)
function formatMonthYearShort(dStr){
    if(!dStr)return''; const d=new Date(dStr); if(isNaN(d))return dStr;
    return monthNamesID[d.getMonth()] + "'" + String(d.getFullYear()).slice(-2);
}
let currentPage = 1;
const rowsPerPage = 6;
let activeFilter = 'all';
let _weeklyViewKey = null; // null = Live; berisi weekKey saat melihat kondisi minggu lampau (read-only)
let _myAssignments = []; // project IDs assigned to current user
let _currentUserRole = null;
let currentView = 'gantt';
let _detailCurrentRow = null;
let _currentFileHandle = null;
let _appData = null;

// ===================================================================
// MASTER DATA - daftar lookup terkelola (PIC, Blocker, Kategori, Prioritas)
// ===================================================================
const MASTER_DATA_DEFAULTS = {
    pics: ['Reza Rizky','Reza','Adnan','Bang Adnan','Adnan Nasution','Gandhi Nugroho','Ulin Salsabila','Senna Septiawan'],
    blockerCategories: ['Menunggu IT','Pengadaan/Kontrak','Perubahan Lingkup','Revisi FGD','Ketergantungan Vendor','Anggaran','Resource/SDM'],
    categories: ['Digitalisasi','Enhancement','Development','Penelitian','Kajian'],
    priorities: ['High','Medium','Low']
};
// Owner + rekomendasi aksi default per kategori blocker (decision support).
// Dapat di-override oleh admin lewat Master Data (_appData.masterData.blockerMeta).
const BLOCKER_META_DEFAULTS = {
    'Menunggu IT':            { owner:'Manajer IT',           action:'Eskalasi tiket ke tim IT, sepakati target penyelesaian' },
    'Pengadaan/Kontrak':      { owner:'Tim Pengadaan',        action:'Percepat proses procurement / follow-up kontrak' },
    'Perubahan Lingkup':      { owner:'Project Owner',        action:'Konfirmasi scope baru & re-baseline plan' },
    'Revisi FGD':             { owner:'PIC FGD',              action:'Jadwalkan FGD lanjutan & finalisasi hasil' },
    'Ketergantungan Vendor':  { owner:'Vendor Manager',       action:'Follow-up komitmen vendor / SLA' },
    'Anggaran':               { owner:'Finance / Budget Owner', action:'Ajukan / percepat persetujuan anggaran' },
    'Resource/SDM':           { owner:'Resource Manager',     action:'Alokasi tambahan SDM / prioritas ulang' }
};

// Kembalikan masterData lengkap: nilai tersimpan di-merge per-list di atas defaults
function getMasterData(){
    const md = (_appData && _appData.masterData) || {};
    const pick = (key) => (Array.isArray(md[key]) && md[key].length) ? md[key].slice() : MASTER_DATA_DEFAULTS[key].slice();
    const meta = (md.blockerMeta && typeof md.blockerMeta === 'object') ? md.blockerMeta : {};
    return {
        pics: pick('pics'),
        blockerCategories: pick('blockerCategories'),
        categories: pick('categories'),
        priorities: pick('priorities'),
        blockerMeta: Object.assign({}, BLOCKER_META_DEFAULTS, meta)
    };
}
// Owner + aksi untuk satu kategori blocker (fallback "—" bila tak terdefinisi).
function getBlockerMeta(category){
    const md = getMasterData();
    const m = (md.blockerMeta && md.blockerMeta[category]) || {};
    return { owner: (m.owner && String(m.owner).trim()) || '—', action: (m.action && String(m.action).trim()) || '—' };
}

// Normalisasi nilai multi-value (array / string ber-";" / string ber-"|||") → array bersih
function parseMultiValue(raw){
    if (Array.isArray(raw)) return raw.map(v => String(v).trim()).filter(Boolean);
    if (raw == null) return [];
    return String(raw).split(/\s*(?:\|\|\||;)\s*/).map(v => v.trim()).filter(Boolean);
}
function parsePicValue(raw){ return parseMultiValue(raw); }
function parseBlockers(raw){ return parseMultiValue(raw); }
// Untuk tampilan (board card / export): gabung dengan "; "
function formatPicDisplay(raw){ return parsePicValue(raw).join('; '); }

// ===================================================================
// AGREGASI BLOCKER (decision support) — satu sumber kebenaran dipakai
// oleh view Blocker, Executive Summary, Weekly Reminder, PDF & PPTX.
// Input: array of {name, blockers:[], planPct, actPct, rag} (rag = key 'red'/'yellow'/...).
// Output: { items:[{category,count,riskCount,impact,owner,action,projects:[...]}], totalBlocked, cumulative }
// - count     : jumlah project (semua status) yang membawa kategori blocker tsb
// - riskCount : jumlah project at-risk (red/yellow) yang membawanya
// - impact    : Σ max(0, planPct-actPct) dari project at-risk → besaran keterlambatan terasosiasi
// Item diurut by impact desc (fallback count), dengan % kumulatif untuk Pareto (vital few ≤ 80%).
// ===================================================================
function aggregateBlockers(projects){
    const map = {};
    let totalBlocked = 0;
    (projects||[]).forEach(p=>{
        const blks = Array.isArray(p.blockers) ? p.blockers : parseBlockers(p.blockers);
        if(!blks.length) return;
        totalBlocked++;
        const atRisk = (p.rag==='red' || p.rag==='yellow');
        const delay = Math.max(0, (Number(p.planPct)||0) - (Number(p.actPct)||0));
        blks.forEach(b=>{
            const e = map[b] || (map[b] = { category:b, count:0, riskCount:0, impact:0, projects:[] });
            e.count++;
            if(atRisk){ e.riskCount++; e.impact += delay; }
            e.projects.push({ name:p.name, rag:p.rag, planPct:p.planPct, actPct:p.actPct, atRisk });
        });
    });
    const items = Object.keys(map).map(k=>map[k]).sort((a,b)=> b.impact-a.impact || b.count-a.count || a.category.localeCompare(b.category));
    items.forEach(e=>{ const m = getBlockerMeta(e.category); e.owner = m.owner; e.action = m.action; });
    // % kumulatif berbasis impact (fallback count bila semua impact 0)
    const useImpact = items.some(e=>e.impact>0);
    const totalWeight = items.reduce((s,e)=> s + (useImpact ? e.impact : e.count), 0) || 1;
    let run = 0;
    items.forEach(e=>{ run += (useImpact ? e.impact : e.count); e.cumPct = Math.round(run/totalWeight*100); e.vital = (e.cumPct <= 80) || (run - (useImpact?e.impact:e.count) < totalWeight*0.8); });
    // Share dampak per blocker → porsi dari total (jumlah seluruh blocker = 100%).
    // Pakai largest-remainder agar pembulatan tetap menjumlah tepat 100%.
    const rawShares = items.map(e=> (useImpact ? e.impact : e.count)/totalWeight*100);
    const floors = rawShares.map(Math.floor);
    let remainder = 100 - floors.reduce((s,n)=>s+n,0);
    const byFrac = rawShares.map((s,i)=>({ i, frac:s-Math.floor(s) })).sort((a,b)=> b.frac-a.frac);
    items.forEach((e,i)=>{ e.sharePct = floors[i]; });
    for(let k=0; k<remainder && k<byFrac.length; k++){ items[byFrac[k].i].sharePct += 1; }
    return { items, totalBlocked, useImpact };
}
// Kumpulkan ringkasan project (untuk aggregateBlockers) langsung dari baris gantt aktif.
function collectBlockerProjects(){
    const out = [];
    getVisibleRows().forEach(row=>{
        const name = (typeof getActivityNameFromRow==='function') ? getActivityNameFromRow(row) : '';
        if(!name) return;
        const planPct = (typeof getPlanTargetFromRow==='function') ? getPlanTargetFromRow(row) : 0;
        const actPct = (typeof getActualProgressFromRow==='function') ? Math.round(getActualProgressFromRow(row)||0) : 0;
        const rag = (typeof computeRagKey==='function') ? computeRagKey(planPct, actPct) : 'grey';
        out.push({ name, planPct, actPct, rag, blockers: parseBlockers(row.getAttribute('data-blockers')) });
    });
    return out;
}

// ===================================================================
// GANTT PILL HELPERS - one visual bar containing Plan + Actual
// ===================================================================
function clampNum(v, min=0, max=100){ v=parseFloat(v); if(isNaN(v))v=0; return Math.max(min, Math.min(max, v)); }
function readPctFromText(text, kind){
    text = text || '';
    const re = kind === 'actual' ? /Act:\s*(\d+(?:\.\d+)?)%/i : /Target:\s*(\d+(?:\.\d+)?)%/i;
    const m = text.match(re); if(m) return parseFloat(m[1]);
    const s = text.match(/(\d+(?:\.\d+)?)%/); return s ? parseFloat(s[1]) : 0;
}
function getPlanLabelEl(scope){ return scope ? (scope.querySelector('.plan-label') || scope.querySelector('.bar-plan .bar-label')) : null; }
function getActualLabelEl(scope){ return scope ? (scope.querySelector('.actual-label') || scope.querySelector('.bar-actual .bar-label')) : null; }
// Plan "seharusnya" tercapai pada data date (cutoff/hari ini), diasumsikan linear
// sepanjang bar plan. 0 bila belum mulai, 100 bila plan finish sudah lewat →
// degradasi mulus ke perilaku lama (100 - actual) untuk item yang sudah jatuh tempo.
function getPlannedToDate(row){
    // Pakai tanggal absolut (canonical) — independen dari window, jadi status tetap
    // akurat ke FULL project meski bar terselip/tersembunyi di luar window.
    const c=getRowCanonical(row);
    if(!c.planStart||!c.planEnd)return 0;
    const s=absIndex(c.planStart), e=absIndex(c.planEnd);
    if(isNaN(s)||isNaN(e))return 0;
    const startDate=new Date(Math.floor(s/12),((s%12)+12)%12,1);
    const ePlus=e+1; // awal bulan setelah plan selesai (bulan akhir terisi penuh)
    const endDate=new Date(Math.floor(ePlus/12),((ePlus%12)+12)%12,1);
    const span=endDate-startDate;
    if(!(span>0))return 100; // fallback aman
    const now=(typeof getCutoffDate==='function')?getCutoffDate():new Date();
    const frac=(now-startDate)/span;
    if(isNaN(frac))return 100;
    return clampNum(frac,0,1)*100;
}
function getPlanTargetFromRow(row){
    if(!row)return 0;
    const c=getRowCanonical(row);
    if(!c.planStart||!c.planEnd)return 0;
    return Math.round(getPlannedToDate(row));
}
function getActualProgressFromRow(row){
    const l=getActualLabelEl(row);
    if(l) return readPctFromText(l.innerText,'actual');
    if(row&&row.dataset&&row.dataset.actualProgress!==undefined) return parseFloat(row.dataset.actualProgress)||0;
    return 0;
}
function computeRagKey(planPct, actPct){
    planPct=clampNum(planPct,0,100);
    actPct=clampNum(actPct,0,100);
    if(planPct<=0&&actPct<=0)return 'grey';
    if(actPct>=100)return 'blue';
    if(actPct>=planPct)return 'green';
    return (planPct-actPct)>=25?'red':'yellow';
}
function computeRowRagKey(row){
    return computeRagKey(getPlanTargetFromRow(row),getActualProgressFromRow(row));
}
function applyTrafficLight(row){
    const circle=row?row.querySelector('.traffic-light'):null;
    if(!circle)return 'grey';
    const rag=computeRowRagKey(row);
    circle.className='traffic-light bg-'+rag;
    applyPrognosaChip(row,circle,rag);
    return rag;
}
// Chip "Prognosa Selesai" di kolom RAG — hanya untuk status delay (red/yellow).
function applyPrognosaChip(row,circle,rag){
    const col=(circle&&circle.closest('.rag-col'))||(circle&&circle.parentElement);
    if(!col)return;
    let chip=col.querySelector('.prognosa-chip');
    const prog=row?(row.getAttribute('data-prognosa')||''):'';
    if(prog && (rag==='red'||rag==='yellow')){
        if(!chip){ chip=document.createElement('div'); chip.className='prognosa-chip'; col.appendChild(chip); }
        const shortTxt=(typeof formatMonthYearShort==='function')?formatMonthYearShort(prog):prog;
        const fullTxt=(typeof formatDue==='function')?formatDue(prog):prog;
        chip.innerHTML='<span class="prognosa-chip-flag">🏁</span>'+
                       '<span class="prognosa-chip-date">'+escapeHTML(shortTxt)+'</span>';
        chip.title='Prognosa selesai: '+fullTxt;
        chip.style.display='';
    } else if(chip){ chip.style.display='none'; }
}
function recalcAllTrafficLights(){
    document.querySelectorAll('.gantt-row').forEach(row=>applyTrafficLight(row));
    updateSummaryCards();
    const sc=document.getElementById('scurve-container');
    if(sc&&sc.classList.contains('show')&&typeof renderSCurve==='function')renderSCurve();
    refreshActiveView();
}
function syncComboDataFromOuter(bar){
    if(!bar || !bar.classList.contains('bar-combo')) return;
    const left=parseFloat(bar.style.left)||0, width=parseFloat(bar.style.width)||0;
    const plan=bar.querySelector('.bar-plan-track'), actual=bar.querySelector('.bar-actual-track');
    if(plan){ bar.dataset.planLeft = left + width*((parseFloat(plan.style.left)||0)/100); bar.dataset.planWidth = width*((parseFloat(plan.style.width)||0)/100); }
    if(actual){ bar.dataset.actualLeft = left + width*((parseFloat(actual.style.left)||0)/100); bar.dataset.actualWidth = width*((parseFloat(actual.style.width)||0)/100); }
}
// Setelah drag/resize, segarkan tanggal absolut (canonical) di .gantt-row dari
// geometri bar yg baru, agar tetap konsisten saat window diubah.
function syncRowDatesFromBar(bar){
    if(!bar)return;
    const row=bar.closest&&bar.closest('.gantt-row'); if(!row)return;
    const cfg=getTimelineConfig();
    const winStart=cfg.startY*12+cfg.startM;
    const pl=parseFloat(bar.dataset.planLeft)||0, pw=parseFloat(bar.dataset.planWidth)||0;
    const al=parseFloat(bar.dataset.actualLeft)||0, aw=parseFloat(bar.dataset.actualWidth)||0;
    const upd={};
    if(pw>0){ const r=rangeFromMetrics(pl,pw); upd.planStart=absValueFromIndex(winStart+r.start); upd.planEnd=absValueFromIndex(winStart+r.end); bar.dataset.planStart=upd.planStart; bar.dataset.planEnd=upd.planEnd; }
    if(aw>0){ const r=rangeFromMetrics(al,aw); upd.actualStart=absValueFromIndex(winStart+r.start); upd.actualEnd=absValueFromIndex(winStart+r.end); bar.dataset.actualStart=upd.actualStart; bar.dataset.actualEnd=upd.actualEnd; }
    setRowCanonical(row, upd);
}
function readPlanMetrics(row){
    const bar=row.querySelector('.bar-plan'); if(!bar) return {left:0,width:0,target:0};
    if(bar.classList.contains('bar-combo')) syncComboDataFromOuter(bar);
    const left = bar.classList.contains('bar-combo') ? (parseFloat(bar.dataset.planLeft)||0) : (parseFloat(bar.style.left)||0);
    const width = bar.classList.contains('bar-combo') ? (parseFloat(bar.dataset.planWidth)||0) : (parseFloat(bar.style.width)||0);
    return { left, width, target: width > 0 ? 100 : 0 };
}
function readActualMetrics(row){
    const bar=row.querySelector('.bar-actual'); if(!bar) return {left:0,width:0,progress:0};
    if(bar.classList.contains('bar-combo')) syncComboDataFromOuter(bar);
    return { left: bar.classList.contains('bar-combo') ? (parseFloat(bar.dataset.actualLeft)||0) : (parseFloat(bar.style.left)||0), width: bar.classList.contains('bar-combo') ? (parseFloat(bar.dataset.actualWidth)||0) : (parseFloat(bar.style.width)||0), progress: getActualProgressFromRow(row) };
}
function getTimelineConfig(){
    const meta=document.getElementById('timeline-meta');
    let startM=parseInt(meta.getAttribute('data-start-m'));
    let startY=parseInt(meta.getAttribute('data-start-y'));
    let duration=parseInt(meta.getAttribute('data-duration'));
    if(isNaN(startM)) startM=parseInt(document.getElementById('cfg-month').value)||0;
    if(isNaN(startY)) startY=parseInt(document.getElementById('cfg-year').value)||2025;
    if(isNaN(duration)||duration<1) duration=parseInt(document.getElementById('cfg-duration').value)||24;
    return {startM,startY,duration};
}
function monthValueFromIndex(idx){
    const cfg=getTimelineConfig();
    const d=new Date(cfg.startY,cfg.startM+idx,1);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
}
function monthLabelShort(idx){
    const cfg=getTimelineConfig();
    const d=new Date(cfg.startY, cfg.startM+idx, 1);
    return monthNames[d.getMonth()] + " '" + String(d.getFullYear()).slice(-2);
}
function monthIndexFromValue(value){
    const cfg=getTimelineConfig();
    const m=String(value||'').trim().match(/^(\d{4})-(\d{1,2})$/);
    if(!m)return NaN;
    const y=parseInt(m[1]), mo=parseInt(m[2])-1;
    if(mo<0||mo>11)return NaN;
    return (y-cfg.startY)*12+(mo-cfg.startM);
}
function rangeFromMetrics(left,width){
    const cfg=getTimelineConfig();
    const duration=cfg.duration;
    if(!width||width<=0)return {start:0,end:0};
    const start=Math.max(0,Math.min(duration-1,Math.floor((left/100)*duration+0.0001)));
    const end=Math.max(start,Math.min(duration-1,Math.ceil(((left+width)/100)*duration-0.0001)-1));
    return {start,end};
}
function metricsFromRange(startValue,endValue){
    const cfg=getTimelineConfig();
    let startIdx=monthIndexFromValue(startValue), endIdx=monthIndexFromValue(endValue);
    if(isNaN(startIdx)||isNaN(endIdx))return null;
    if(startIdx<0||endIdx<0||startIdx>=cfg.duration||endIdx>=cfg.duration)return null;
    if(endIdx<startIdx)return null;
    return {left:(startIdx/cfg.duration)*100,width:((endIdx-startIdx+1)/cfg.duration)*100};
}
// ---- Tanggal absolut (window-independent) ----
// absIndex/absValueFromIndex memakai indeks bulan absolut y*12+(m-1), TIDAK relatif
// ke window timeline — inilah sumber kebenaran posisi bar agar tidak ikut bergeser
// saat window (bulan/tahun mulai) diubah.
function absIndex(value){
    const m=String(value||'').trim().match(/^(\d{4})-(\d{1,2})$/);
    if(!m)return NaN;
    const y=parseInt(m[1]), mo=parseInt(m[2])-1;
    if(mo<0||mo>11)return NaN;
    return y*12+mo;
}
function absValueFromIndex(absIdx){
    if(isNaN(absIdx))return '';
    const y=Math.floor(absIdx/12), mo=((absIdx%12)+12)%12;
    return y+'-'+String(mo+1).padStart(2,'0');
}
// Hitung posisi bar (%) untuk window saat ini, dengan clipping di tepi kiri/kanan.
function clippedMetricsFromAbs(startValue,endValue,cfg){
    cfg=cfg||getTimelineConfig();
    const barLo=absIndex(startValue);
    const absEnd=absIndex(endValue);
    if(isNaN(barLo)||isNaN(absEnd))return {hidden:true};
    const barHi=absEnd+1; // akhir eksklusif (bulan akhir terisi penuh)
    const winStart=cfg.startY*12+cfg.startM;
    const winEnd=winStart+cfg.duration;
    const visLo=Math.max(barLo,winStart);
    const visHi=Math.min(barHi,winEnd);
    if(visHi<=visLo)return {hidden:true,clipLeft:barHi<=winStart,clipRight:barLo>=winEnd};
    return {
        hidden:false,
        left:((visLo-winStart)/cfg.duration)*100,
        width:((visHi-visLo)/cfg.duration)*100,
        clipLeft:barLo<winStart,
        clipRight:barHi>winEnd,
        trueStartIdx:barLo-winStart,
        trueEndIdx:absEnd-winStart
    };
}
// Migrasi: turunkan tanggal absolut dari persentase lama + config yang berlaku.
function absDatesFromMetrics(left,width,cfg){
    cfg=cfg||getTimelineConfig();
    if(!width||width<=0)return null;
    const r=rangeFromMetrics(left,width);
    const winStart=cfg.startY*12+cfg.startM;
    return {start:absValueFromIndex(winStart+r.start), end:absValueFromIndex(winStart+r.end)};
}
function redrawGanttPill(row, data){
    const grid=row.querySelector('.timeline-grid'); if(!grid)return;
    grid.querySelectorAll('.bar').forEach(el=>el.remove());
    const html=buildGanttPillHTML(data);
    if(html){
        grid.insertAdjacentHTML('afterbegin',html);
        grid.querySelectorAll('.bar-plan, .bar-actual').forEach(bar => {
            initSingleBar(bar);
            bar.addEventListener('click', function(e){
                if(e.detail > 1) return;
                const r = bar.closest('.gantt-row');
                if(r && r.dataset.dragEnabled === 'true') openBarPopover(bar, bar.dataset.barType, r);
            });
        });
    }
    refreshTrafficLight(row);
    updateDateLine();
    syncFrozenColumns();
}
// Simpan tanggal absolut (sumber kebenaran) pada .gantt-row — tetap ada meski bar
// terselip/tersembunyi, sehingga status RAG & S-Curve tetap akurat.
function setRowCanonical(row, c){
    if(!row||!c)return;
    const set=(k,v)=>{ if(v) row.dataset[k]=v; else delete row.dataset[k]; };
    set('planStart', c.planStart); set('planEnd', c.planEnd);
    set('actualStart', c.actualStart); set('actualEnd', c.actualEnd);
    if(c.actualProgress!==undefined && c.actualProgress!==null && c.actualProgress!=='')
        row.dataset.actualProgress=String(c.actualProgress);
}
function getRowCanonical(row){
    if(!row)return {};
    const d=row.dataset;
    return {
        planStart:d.planStart||'', planEnd:d.planEnd||'',
        actualStart:d.actualStart||'', actualEnd:d.actualEnd||'',
        actualProgress:d.actualProgress!==undefined?parseFloat(d.actualProgress)||0:0
    };
}
// Satu jalur rebuild bar dari tanggal absolut — dipakai load, re-window, dan edit.
function redrawGanttPillFromDates(row){
    if(!row)return;
    const c=getRowCanonical(row);
    redrawGanttPill(row,{
        planStart:c.planStart, planEnd:c.planEnd,
        actualStart:c.actualStart, actualEnd:c.actualEnd,
        planTarget:(c.planStart&&c.planEnd)?100:0,
        actualProgress:c.actualProgress
    });
}

function escapeAttr(str){
    return String(str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function monthIndexFromLeft(left){
    const cfg=getTimelineConfig();
    const idx=Math.floor(((parseFloat(left)||0)/100)*cfg.duration+0.0001);
    return Math.max(0,Math.min(cfg.duration-1,idx));
}
function milestoneLeftFromMonth(value){
    const idx=monthIndexFromValue(value);
    const cfg=getTimelineConfig();
    if(isNaN(idx)||idx<0||idx>=cfg.duration)return null;
    return (idx/cfg.duration)*100;
}
function laneFromTop(top){
    top=parseFloat(top)||44;
    if(top<=32)return 0;
    if(top>=58)return 2;
    return 1;
}
function milestoneTopFromLane(lane){
    lane=parseInt(lane); if(isNaN(lane))lane=1;
    return [26,44,62][Math.max(0,Math.min(2,lane))];
}
function getMilestoneData(ms){
    const left=parseFloat(ms.style.left)||0;
    const lane=ms.dataset.lane!==undefined?parseInt(ms.dataset.lane):laneFromTop(ms.style.top);
    const month=ms.dataset.month||monthValueFromIndex(monthIndexFromLeft(left));
    const labelEl=ms.querySelector('.milestone-label');
    return { label:labelEl?labelEl.innerText.trim():'Milestone', month, lane, left, top:parseFloat(ms.style.top)||milestoneTopFromLane(lane) };
}
function buildMilestoneHTML(ms){
    ms=ms||{};
    const lane=ms.lane!==undefined?parseInt(ms.lane):laneFromTop(ms.top);
    const month=ms.month||monthValueFromIndex(monthIndexFromLeft(ms.left||0));
    let left=ms.left;
    if(ms.month){ const monthLeft=milestoneLeftFromMonth(ms.month); if(monthLeft!==null) left=monthLeft; }
    if(isNaN(parseFloat(left))) left=0;
    const top=ms.top!==undefined?parseFloat(ms.top):milestoneTopFromLane(lane);
    const label=ms.label||'Milestone';
    return '<div class="milestone" data-month="'+escapeAttr(month)+'" data-lane="'+lane+'" style="left:'+left+'%;top:'+top+'px;"><div class="milestone-label">'+escapeHTML(label)+'</div><div class="item-del" onclick="this.parentElement.remove()">x</div></div>';
}
function bindMilestone(ms){
    ms.ondblclick=function(e){e.preventDefault();e.stopPropagation();openMilestoneForm(ms.closest('.gantt-row'),ms);};
}
function bindMilestoneDraggable(ms, container, sourceRow) {
    ms.style.cursor = 'grab';
    ms.addEventListener('mousedown', startDrag);
    ms.addEventListener('touchstart', startDrag, { passive: false });

    function startDrag(e) {
        if (container.dataset.dragEnabled !== 'true') return;
        if (e.target.classList.contains('item-del')) return;
        e.preventDefault(); e.stopPropagation();
        const cx0 = e.touches ? e.touches[0].clientX : e.clientX;
        const left0 = parseFloat(ms.style.left) || 0;
        const pw = container.offsetWidth;

        const onMove = (em) => {
            const cx = em.touches ? em.touches[0].clientX : em.clientX;
            const dx = (cx - cx0) / pw * 100;
            const nl = Math.max(0, Math.min(100, left0 + dx));
            ms.style.left = nl + '%';
            const cfg = getTimelineConfig();
            const winStart = cfg.startY * 12 + cfg.startM;
            const idx = Math.round(nl / 100 * cfg.duration);
            ms.dataset.month = absValueFromIndex(winStart + Math.min(idx, cfg.duration - 1));
        };
        const onEnd = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onEnd);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onEnd);
            // Sync back to sourceRow milestone
            const idx = [...container.querySelectorAll('.milestone')].indexOf(ms);
            const srcMs = sourceRow.querySelectorAll('.milestone')[idx];
            if (srcMs) { srcMs.style.left = ms.style.left; srcMs.dataset.month = ms.dataset.month; }
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onEnd);
    }
}
function closeMilestoneForm(){
    const ov=document.getElementById('milestone-form-overlay');
    if(ov)ov.remove();
}
function openMilestoneForm(row, milestone){
    if(!row)return;
    closeMilestoneForm();
    const data=milestone?getMilestoneData(milestone):{label:'Milestone',month:monthValueFromIndex(0),lane:1};
    const overlay=document.createElement('div');
    overlay.className='milestone-form-overlay'; overlay.id='milestone-form-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeMilestoneForm();});
    overlay.innerHTML='<form class="milestone-form-modal"><div class="milestone-form-header"><h3>'+(milestone?'Edit Milestone':'Tambah Milestone')+'</h3><button type="button" onclick="closeMilestoneForm()">&times;</button></div><div class="milestone-form-body"><label>Nama milestone<input id="ms-label" type="text" value="'+escapeAttr(data.label)+'" required></label><label>Bulan milestone<input id="ms-month" type="month" value="'+escapeAttr(data.month)+'" required></label><label>Posisi<select id="ms-lane"><option value="0" '+(data.lane===0?'selected':'')+'>Atas</option><option value="1" '+(data.lane===1?'selected':'')+'>Tengah</option><option value="2" '+(data.lane===2?'selected':'')+'>Bawah</option></select></label></div><div class="milestone-form-footer"><button type="button" class="milestone-btn-secondary" onclick="closeMilestoneForm()">Batal</button><button type="submit" class="milestone-btn-primary">Simpan</button></div></form>';
    document.body.appendChild(overlay);
    const labelInput=overlay.querySelector('#ms-label');
    const monthInput=overlay.querySelector('#ms-month');
    const laneInput=overlay.querySelector('#ms-lane');
    labelInput.focus(); labelInput.select();
    overlay.querySelector('form').onsubmit=function(e){
        e.preventDefault();
        const label=labelInput.value.trim();
        const month=monthInput.value.trim();
        const lane=parseInt(laneInput.value)||0;
        const left=milestoneLeftFromMonth(month);
        if(!label){alert('Nama milestone wajib diisi.');return;}
        if(left===null){alert('Bulan milestone harus berada di periode timeline.');return;}
        const target=milestone||document.createElement('div');
        target.className='milestone';
        target.dataset.month=month;
        target.dataset.lane=String(lane);
        target.style.left=left+'%';
        target.style.top=milestoneTopFromLane(lane)+'px';
        target.innerHTML='<div class="milestone-label">'+escapeHTML(label)+'</div><div class="item-del" onclick="this.parentElement.remove()">x</div>';
        if(!milestone)row.querySelector('.timeline-grid').appendChild(target);
        bindMilestone(target);
        closeMilestoneForm();
        updateDateLine();
        syncFrozenColumns();
    };
}


function closeBarForm(){
    const ov=document.getElementById('bar-form-overlay');
    if(ov)ov.remove();
}
function openBarForm(row,type){
    if(!row)return;
    closeBarForm();
    const isPlan=type==='plan';
    // Default form dari tanggal ASLI (canonical), bukan dari persen terpotong, agar
    // saat edit bar yg terselip tetap menampilkan tanggal mulai/selesai sebenarnya.
    const c=getRowCanonical(row);
    const fallback=monthValueFromIndex(0);
    const defStart=(isPlan?c.planStart:c.actualStart)||fallback;
    const defEnd=(isPlan?c.planEnd:c.actualEnd)||fallback;
    const title=isPlan?'Edit Plan':'Edit Actual';
    const subtitle=isPlan?'Plan finish otomatis 100%.':'Actual membutuhkan progress fisik.';
    const progressHTML=isPlan?'':'<label>Progress Actual (%)<input id="bar-progress" type="number" min="0" max="100" value="'+escapeAttr(c.actualProgress||0)+'" required></label>';
    const overlay=document.createElement('div');
    overlay.className='milestone-form-overlay'; overlay.id='bar-form-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeBarForm();});
    overlay.innerHTML='<form class="milestone-form-modal bar-form-modal"><div class="milestone-form-header"><div><h3>'+title+'</h3><p class="bar-form-subtitle">'+subtitle+'</p></div><button type="button" onclick="closeBarForm()">&times;</button></div><div class="milestone-form-body"><label>'+(isPlan?'Plan mulai':'Actual mulai')+'<input id="bar-start" type="month" value="'+escapeAttr(defStart)+'" required></label><label>'+(isPlan?'Plan selesai':'Actual selesai')+'<input id="bar-end" type="month" value="'+escapeAttr(defEnd)+'" required></label>'+progressHTML+'</div><div class="milestone-form-footer"><button type="button" class="milestone-btn-secondary" onclick="closeBarForm()">Batal</button><button type="submit" class="milestone-btn-primary">Simpan</button></div></form>';
    document.body.appendChild(overlay);
    const startInput=overlay.querySelector('#bar-start');
    const endInput=overlay.querySelector('#bar-end');
    const progressInput=overlay.querySelector('#bar-progress');
    startInput.focus();
    overlay.querySelector('form').onsubmit=function(e){
        e.preventDefault();
        const sIdx=absIndex(startInput.value), eIdx=absIndex(endInput.value);
        // Di luar window kini VALID (akan ter-clip); cukup cek bulan & urutan.
        if(isNaN(sIdx)||isNaN(eIdx)){alert('Bulan tidak valid.');return;}
        if(eIdx<sIdx){alert('Bulan selesai tidak boleh sebelum bulan mulai.');return;}
        const cur=getRowCanonical(row);
        if(isPlan){
            setRowCanonical(row,{planStart:startInput.value,planEnd:endInput.value,actualStart:cur.actualStart,actualEnd:cur.actualEnd,actualProgress:cur.actualProgress});
        }else{
            const progress=clampNum(progressInput.value,0,100);
            setRowCanonical(row,{planStart:cur.planStart,planEnd:cur.planEnd,actualStart:startInput.value,actualEnd:endInput.value,actualProgress:progress});
        }
        redrawGanttPillFromDates(row);
        closeBarForm();
    };
}

function editPlanData(row){
    openBarForm(row,'plan');
}
function editActualData(row){
    openBarForm(row,'actual');
}
function buildGanttPillHTML(proj){
    proj = proj || {};
    const cfg = getTimelineConfig();
    const hasDates = !!(proj.planStart||proj.planEnd||proj.actualStart||proj.actualEnd);
    let pLeft=0, pWidth=0, aLeft=0, aWidth=0, planClip=null, actualClip=null;
    if(hasDates){
        const pc=(proj.planStart&&proj.planEnd)?clippedMetricsFromAbs(proj.planStart,proj.planEnd,cfg):{hidden:true};
        const ac=(proj.actualStart&&proj.actualEnd)?clippedMetricsFromAbs(proj.actualStart,proj.actualEnd,cfg):{hidden:true};
        if(!pc.hidden){ pLeft=pc.left; pWidth=pc.width; planClip=pc; }
        if(!ac.hidden){ aLeft=ac.left; aWidth=ac.width; actualClip=ac; }
    } else {
        pLeft=clampNum(proj.planLeft,0,100); pWidth=clampNum(proj.planWidth,0,100);
        aLeft=clampNum(proj.actualLeft,0,100); aWidth=clampNum(proj.actualWidth,0,100);
    }
    const aProgress = clampNum(proj.actualProgress,0,100);
    const hasPlan = pWidth>0, hasActual = aWidth>0;
    if(!hasPlan && !hasActual) return '';
    let html = '';
    if(hasPlan){
        const clipL = planClip&&planClip.clipLeft ? ' bar-clip-left':'';
        const clipR = planClip&&planClip.clipRight ? ' bar-clip-right':'';
        html += `<div class="bar bar-plan${clipL}${clipR}" data-bar-type="plan"
            data-plan-start="${escapeAttr(proj.planStart||'')}" data-plan-end="${escapeAttr(proj.planEnd||'')}"
            style="left:${pLeft}%;width:${pWidth}%">
            <span class="bar-label plan-label">Plan</span>
            <div class="resize-handle"></div>
        </div>`;
    }
    if(hasActual){
        const clipL = actualClip&&actualClip.clipLeft ? ' bar-clip-left':'';
        const clipR = actualClip&&actualClip.clipRight ? ' bar-clip-right':'';
        html += `<div class="bar bar-actual${clipL}${clipR}" data-bar-type="actual"
            data-actual-start="${escapeAttr(proj.actualStart||'')}" data-actual-end="${escapeAttr(proj.actualEnd||'')}"
            style="left:${aLeft}%;width:${aWidth}%">
            <div class="bar-fill" style="width:${aProgress}%"></div>
            <span class="bar-label actual-label" ondblclick="event.stopPropagation();updateProgress(this.closest('.bar'))">Act: ${aProgress}%</span>
            <div class="resize-handle"></div>
        </div>`;
    }
    return html;
}

// ===================================================================
// VIEW SWITCHER
// ===================================================================
function setView(view) {
    currentView = view;
    document.querySelectorAll('.segmented button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    const gantt = document.getElementById('gantt-wrap');
    const board = document.getElementById('board-container');
    const calendar = document.getElementById('calendar-container');
    const pic = document.getElementById('pic-container');
    const blocker = document.getElementById('blocker-container');
    const prognosa = document.getElementById('prognosa-container');
    // Chrome khas Gantt/Board (KPI cards, legend, S-Curve, filter) — disembunyikan di Calendar & PIC.
    const ganttBoardChrome = ['summary-cards', 'filter-banner', 'scurve-container', 'legend-row'];
    const showGbChrome = (view === 'gantt' || view === 'board');
    ganttBoardChrome.forEach(id => {
        const el = document.getElementById(id) || document.querySelector('.' + id);
        if (el) el.style.display = showGbChrome ? '' : 'none';
    });
    // View header (judul + count) tampil untuk semua kecuali Calendar.
    const vh = document.querySelector('.view-head');
    if (vh) vh.style.display = (view === 'calendar') ? 'none' : '';
    gantt.style.display = (view === 'gantt') ? 'block' : 'none';
    board.classList.toggle('show', view === 'board');
    if (calendar) calendar.classList.toggle('show', view === 'calendar');
    if (pic) pic.classList.toggle('show', view === 'pic');
    if (blocker) blocker.classList.toggle('show', view === 'blocker');
    if (prognosa) prognosa.classList.toggle('show', view === 'prognosa');
    if (view === 'board') {
        renderBoard();
    } else if (view === 'calendar') {
        if (typeof renderCalendar === 'function') renderCalendar();
    } else if (view === 'pic') {
        if (typeof renderPic === 'function') renderPic();
    } else if (view === 'blocker') {
        if (typeof renderBlocker === 'function') renderBlocker();
    } else if (view === 'prognosa') {
        if (typeof renderPrognosa === 'function') renderPrognosa();
    } else {
        updateDateLine();
    }
    const titleEl = document.getElementById('view-title');
    if (titleEl) titleEl.textContent = view === 'board' ? 'Status Board' : view === 'pic' ? 'Beban PIC' : view === 'blocker' ? 'Analisis Blocker' : view === 'prognosa' ? 'Prognosa & Forecast' : 'Project Timeline';
}
function refreshActiveView() {
    if (currentView === 'board') renderBoard();
    else if (currentView === 'calendar' && typeof renderCalendar === 'function') renderCalendar();
    else if (currentView === 'pic' && typeof renderPic === 'function') renderPic();
    else if (currentView === 'blocker' && typeof renderBlocker === 'function') renderBlocker();
    else if (currentView === 'prognosa' && typeof renderPrognosa === 'function') renderPrognosa();
}

function toggleConfig() {
    document.getElementById('config-panel').classList.toggle('open');
    document.getElementById('config-toggle').classList.toggle('open');
}
function syncFrozenColumns() {
    const table=document.getElementById('gantt-table');
    if(!table)return;
    const apply=()=>table.style.setProperty('--gantt-scroll-x', table.scrollLeft+'px');
    if(!table.dataset.frozenScrollBound){
        table.addEventListener('scroll', apply, {passive:true});
        table.dataset.frozenScrollBound='1';
    }
    apply();
}

// ===================================================================
// DATABASE API - LOAD / SAVE STATE
// ===================================================================

async function readStateFromApi(){
    const res = await Auth.apiFetch('/api/state', { cache: 'no-store' });
    if(!res || !res.ok){
        const err = res ? await readApiError(res) : 'Sesi tidak valid';
        throw new Error(err || ('HTTP ' + (res ? res.status : 401)));
    }
    return res.json();
}

async function writeStateToApi(data){
    const res = await Auth.apiFetch('/api/state', {
        method: 'PUT',
        body: JSON.stringify(data)
    });
    if(!res) return { unauthorized: true };
    if(res.status === 403) return { forbidden: true };
    if(!res.ok){
        const err = await readApiError(res);
        throw new Error(err || ('HTTP ' + res.status));
    }
    return res.json();
}

async function readApiError(res){
    try{
        const body = await res.json();
        return body.error || body.message || '';
    }catch(e){ return ''; }
}

async function reloadFromDatabase(){
    try{
        setDsStatus('idle','Memuat data dari database...');
        const result = await readStateFromApi();
        // handle both {data, updatedAt} shape and raw state shape
        const stateData = result && result.data !== undefined ? result.data : result;
        _appData = stateData;
        renderDashboardFromData(_appData);
        setOptionalText('ds-path-display', 'PostgreSQL Railway');
        const ts = result && result.updatedAt ? new Date(result.updatedAt).toLocaleString('id-ID') : null;
        setDsStatus('connected', ts ? ('Terhubung - ' + ts) : 'Terhubung ke database');
        showOptionalElement('btn-save-json-ds');
        showOptionalElement('btn-reload-ds');
        showToast('Data terbaru dimuat dari database');
    }catch(err){
        setDsStatus('disconnected','Gagal memuat database');
        showToast('Gagal memuat data: ' + err.message);
        throw err;
    }
}

async function saveToDatabase(){
    if(_weeklyViewKey){ showToast('Mode lihat riwayat — keluar ke Terkini untuk mengedit'); return; }

    const user = Auth.getUser();
    if(!user){ showToast('Silakan login ulang'); Auth.logout(); return; }
    if(!Auth.canManage()){
        showToast('Hanya Admin atau Manager yang bisa menyimpan perubahan');
        return;
    }

    try{
        captureSnapshot();
        const data = serializeCurrentState();
        setDsStatus('idle','Menyimpan ke database...');
        const result = await writeStateToApi(data);

        if(result.unauthorized){ showToast('Sesi habis, silakan login ulang'); Auth.logout(); return; }
        if(result.forbidden){ showToast('Anda tidak memiliki akses untuk menyimpan'); return; }

        _appData = result.data || data;
        setOptionalText('ds-path-display', 'PostgreSQL Railway');
        setDsStatus('connected', result.updatedAt ? ('Tersimpan - ' + new Date(result.updatedAt).toLocaleString('id-ID')) : 'Tersimpan ke database');
        showToast('Data berhasil disimpan oleh ' + (result.updatedBy || user.full_name));
        populateWeeklyFilter();
    }catch(err){
        setDsStatus('disconnected','Gagal menyimpan database');
        alert('Gagal menyimpan: ' + err.message);
    }
}

async function reloadJSON(){ return reloadFromDatabase(); }
async function saveToJSON(){ return saveToDatabase(); }

function downloadJSON() {
    captureSnapshot();
    const json = JSON.stringify(serializeCurrentState(), null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup_dpcd_' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    showToast('Backup JSON didownload');
}

function setDsStatus(type, text) {
    const el = document.getElementById('ds-status');
    if(!el) return;
    el.className = 'ds-status ' + type;
    setOptionalText('ds-status-text', text);
}

function setOptionalText(id, text){
    const el = document.getElementById(id);
    if(el) el.textContent = text;
}

function showOptionalElement(id){
    const el = document.getElementById(id);
    if(el) el.style.display = '';
}

function getLocalTodayISO(){
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
// Full local timestamp (YYYY-MM-DD HH:MM:SS) — disimpan di meta.lastUpdated.
function getLocalTimestamp(){
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}
// Tampilkan lastUpdated secara ramah. Kompatibel dengan data lama (tanggal saja).
function formatLastUpdated(value){
    if(!value) return '';
    const d = new Date(String(value).replace(' ', 'T'));
    if(isNaN(d)) return String(value);
    const hasTime = /\d{1,2}:\d{2}/.test(String(value));
    const datePart = d.toLocaleDateString('id-ID', { day:'numeric', month:'long', year:'numeric' });
    if(!hasTime) return datePart;
    const timePart = d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    return datePart + ' ' + timePart;
}

// ===================================================================
// SERIALIZE — DOM → JSON
// ===================================================================
function serializeCurrentState() {
    const meta = document.getElementById('timeline-meta');
    const startMonth = parseInt(meta.getAttribute('data-start-m') || 0);
    const startYear = parseInt(meta.getAttribute('data-start-y') || 2025);
    const duration = parseInt(meta.getAttribute('data-duration') || 24);
    const cutoff = document.getElementById('cfg-cutoff').value || '';
    const projects = [];
    document.querySelectorAll('.gantt-row').forEach((row, idx) => {
        const name = getActivityNameFromRow(row);
        const planMetrics = readPlanMetrics(row);
        let planLeft=planMetrics.left, planWidth=planMetrics.width, planTarget=planMetrics.target;
        const actualMetrics = readActualMetrics(row);
        let actualLeft=actualMetrics.left, actualWidth=actualMetrics.width, actualProgress=actualMetrics.progress;
        // Sumber kebenaran: tanggal absolut (canonical). Persen tetap disimpan utk
        // back-compat tetapi diturunkan ulang dari tanggal saat load.
        const _can=getRowCanonical(row);
        const rag = computeRowRagKey(row);
        const statusCell = row.children[4];
        const status = statusCell ? statusCell.innerText.trim() : '';
        const milestones = [];
        row.querySelectorAll('.milestone').forEach(ms => {
            const data = getMilestoneData(ms);
            milestones.push({ label: data.label, month: data.month, lane: data.lane, left: data.left, top: data.top });
        });
        projects.push({
            id: idx+1, name, planLeft, planWidth, planTarget, actualLeft, actualWidth, actualProgress, rag, status,
            planStart: _can.planStart||'', planEnd: _can.planEnd||'', actualStart: _can.actualStart||'', actualEnd: _can.actualEnd||'',
            pic: parsePicValue(row.getAttribute('data-pic')), blockers: parseBlockers(row.getAttribute('data-blockers')),
            category: row.getAttribute('data-category')||'',
            priority: row.getAttribute('data-priority')||'',
            department: row.getAttribute('data-dept')||'',
            notes: row.getAttribute('data-notes')||'',
            links: (row.getAttribute('data-links')||'').split('|||').filter(Boolean),
            nextAction: row.getAttribute('data-next-action')||'', dueDate: row.getAttribute('data-due')||'',
            prognosa: row.getAttribute('data-prognosa')||'', milestones
        });
    });
    const events = (typeof getCalendarEvents === 'function') ? getCalendarEvents() : (_appData && _appData.meta && _appData.meta.events) || [];
    // Snapshot mingguan: bawa terus riwayat yang ada (sumber: _appData), lalu upsert
    // bucket minggu berjalan dari kondisi terkini. Saat mode lihat-riwayat aktif,
    // JANGAN upsert (projects di DOM adalah data historis) — cukup teruskan apa adanya.
    const baseSnaps = (_appData && Array.isArray(_appData.weeklySnapshots)) ? _appData.weeklySnapshots : [];
    const weeklySnapshots = _weeklyViewKey ? baseSnaps : upsertWeeklySnapshot(baseSnaps, projects);
    return { meta: { startMonth, startYear, duration, cutoff, lastUpdated: getLocalTimestamp(), events }, projects, masterData: getMasterData(), history: getHistory(), weeklySnapshots };
}

// ===================================================================
// RENDER — JSON → DOM
// ===================================================================
function renderDashboardFromData(data, cutoffOverride) {
    if (!data) return;
    const { meta, projects, history } = data;
    document.getElementById('cfg-month').value = meta.startMonth || 0;
    document.getElementById('cfg-year').value = meta.startYear || 2025;
    document.getElementById('cfg-duration').value = meta.duration || 24;
    // cutoffOverride dipakai mode "as of minggu" agar garis merah & semua
    // perhitungan plan-target/RAG mundur ke tanggal minggu terpilih.
    document.getElementById('cfg-cutoff').value = cutoffOverride || getLocalTodayISO();
    const metaEl = document.getElementById('timeline-meta');
    metaEl.setAttribute('data-start-m', meta.startMonth || 0);
    metaEl.setAttribute('data-start-y', meta.startYear || 2025);
    metaEl.setAttribute('data-duration', meta.duration || 24);
    document.documentElement.style.setProperty('--total-columns', meta.duration || 24);
    if (meta.lastUpdated) document.getElementById('last-updated').textContent = 'Update terakhir: ' + formatLastUpdated(meta.lastUpdated);
    if (typeof setCalendarEvents === 'function') setCalendarEvents(Array.isArray(meta.events) ? meta.events : []);
    if (history) setHistory(history);
    const container = document.getElementById('rows-container');
    container.innerHTML = '';
    (projects || []).forEach(proj => container.appendChild(createRowFromData(proj)));
    generateTimeline(true);
    updatePagination();
    setTimeout(updateDateLine, 100);
    recalcAllTrafficLights();
    initDetailButtons();
    populateWeeklyFilter();
}

function createRowFromData(proj) {
    const row = document.createElement('div');
    row.className = 'gantt-row';
    const _picArr = parsePicValue(proj.pic); if (_picArr.length) row.setAttribute('data-pic', _picArr.join('|||'));
    const _blkArr = parseBlockers(proj.blockers); if (_blkArr.length) row.setAttribute('data-blockers', _blkArr.join('|||'));
    if (proj.category) row.setAttribute('data-category', proj.category);
    if (proj.priority) row.setAttribute('data-priority', proj.priority);
    if (proj.department) row.setAttribute('data-dept', proj.department);
    if (proj.notes) row.setAttribute('data-notes', proj.notes);
    if (proj.nextAction) row.setAttribute('data-next-action', proj.nextAction);
    if (proj.dueDate) row.setAttribute('data-due', proj.dueDate);
    if (proj.prognosa) row.setAttribute('data-prognosa', proj.prognosa);
    if (proj.links && proj.links.length) row.setAttribute('data-links', proj.links.join('|||'));
    // Migrasi: data lama hanya punya persentase → turunkan tanggal absolut dgn
    // config yg sudah berlaku (#timeline-meta di-set sebelum baris dibuat).
    const _cfg=getTimelineConfig();
    if(!proj.planStart && proj.planWidth>0){
        const d=absDatesFromMetrics(proj.planLeft, proj.planWidth, _cfg);
        if(d){ proj.planStart=d.start; proj.planEnd=d.end; }
    }
    if(!proj.actualStart && proj.actualWidth>0){
        const d=absDatesFromMetrics(proj.actualLeft, proj.actualWidth, _cfg);
        if(d){ proj.actualStart=d.start; proj.actualEnd=d.end; }
    }
    setRowCanonical(row, {planStart:proj.planStart, planEnd:proj.planEnd, actualStart:proj.actualStart, actualEnd:proj.actualEnd, actualProgress:proj.actualProgress});
    const combinedBarHTML = buildGanttPillHTML(proj);
    let msHTML = '';
    (proj.milestones || []).forEach(ms => {
        msHTML += buildMilestoneHTML(ms);
    });
    const ragClass = 'bg-grey';
    const statusHTML = escapeHTML(proj.status || '').replace(/\n/g, '<br>');
    const _role = (_currentUserRole || (Auth.getUser() && Auth.getUser().role) || 'member');
    const _projId = String(proj.id || '');
    const _isAssigned = _myAssignments.includes(_projId);
    const _canEdit = (_role === 'admin' || _role === 'manager');
    const _canUpdateProgress = _canEdit || (_role === 'member' && _isAssigned);

    const zoomBtn = `<button class="icon-btn btn-zoom" onclick="openRowFocus(this)" title="Fokus & Edit Timeline"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg></button>`;
    const actionColHTML = _canEdit ? `
        <div class="action-col">
            <button class="icon-btn btn-p" onclick="addItemToRow(this,'plan')" title="Edit data Plan">&#128197;</button>
            <button class="icon-btn btn-a" onclick="addItemToRow(this,'actual')" title="Edit data Actual">&#9889;</button>
            <button class="icon-btn btn-m" onclick="addItemToRow(this,'milestone')" title="Tambah Milestone">&#9670;</button>
            ${zoomBtn}
            <button class="icon-btn btn-d" onclick="deleteRow(this)" title="Hapus baris"><svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>` : _canUpdateProgress ? `
        <div class="action-col">
            <button class="icon-btn btn-a" onclick="openMemberProgressModal(this)" title="Update Progress" style="background:#e8f5e9;color:#2e7d32">✏️</button>
            ${zoomBtn}
        </div>` : `
        <div class="action-col" title="Read-only">
            ${zoomBtn}
        </div>`;

    row.innerHTML = actionColHTML +
        `<div class="editable-cell activity-cell" data-placeholder="Nama Projek..." style="position:relative;"><div class="activity-name-text" contenteditable="true" data-placeholder="Nama Projek...">${escapeHTML(proj.name)}</div></div>
        <div class="timeline-grid">${combinedBarHTML}${msHTML}</div>
        <div class="rag-col"><div class="traffic-light ${ragClass}"></div></div>
        <div class="editable-cell" contenteditable="true" data-placeholder="Update Status...">${statusHTML}</div>`;
    row.querySelectorAll('.bar, .milestone').forEach(el => {
        initInteract(el); // bars → initSingleBar; milestones → drag+date sync
        if (el.classList.contains('bar-plan') || el.classList.contains('bar-actual')) {
            el.addEventListener('click', function(e){
                if(e.detail > 1) return;
                const r = el.closest('.gantt-row');
                if(r && r.dataset.dragEnabled === 'true') openBarPopover(el, el.dataset.barType, r);
            });
        }
    });
    // Lock editing for members on non-assigned projects
    if (!_canEdit && !_canUpdateProgress) {
        row.querySelectorAll('[contenteditable]').forEach(el => {
            el.removeAttribute('contenteditable');
            el.style.cursor = 'default';
        });
    } else if (_role === 'member' && _canUpdateProgress) {
        // member can only update via modal, not inline edit
        row.querySelectorAll('[contenteditable]').forEach(el => {
            el.removeAttribute('contenteditable');
            el.style.cursor = 'default';
        });
    }
    return row;
}

// ===================================================================
// TIMELINE GENERATION
// ===================================================================
function generateTimeline(isLoad=false) {
    let startM, startY, duration;
    const meta = document.getElementById('timeline-meta');
    if (isLoad) {
        startM = parseInt(meta.getAttribute('data-start-m')||0);
        startY = parseInt(meta.getAttribute('data-start-y')||2025);
        duration = parseInt(meta.getAttribute('data-duration')||24);
        if (isNaN(startM)) return;
    } else {
        startM = parseInt(document.getElementById('cfg-month').value);
        startY = parseInt(document.getElementById('cfg-year').value);
        duration = parseInt(document.getElementById('cfg-duration').value);
        if (duration < 1) return alert('Min 1 bulan');
        meta.setAttribute('data-start-m', startM);
        meta.setAttribute('data-start-y', startY);
        meta.setAttribute('data-duration', duration);
    }
    document.documentElement.style.setProperty('--total-columns', duration);
    const hdr = document.getElementById('header-content');
    hdr.innerHTML = '';
    let cm=startM, cy=startY, spanCount=0, yearStart=cy;
    for (let i=0; i<duration; i++) {
        if (cm===0 && i!==0) {
            const yd=document.createElement('div'); yd.className='year-cell'; yd.innerText=yearStart; yd.style.gridColumn=`span ${spanCount}`; hdr.appendChild(yd);
            spanCount=0; yearStart=cy;
        }
        spanCount++;
        if (i===duration-1) { const yd=document.createElement('div'); yd.className='year-cell'; yd.innerText=yearStart; yd.style.gridColumn=`span ${spanCount}`; hdr.appendChild(yd); }
        cm++; if(cm>11){cm=0;cy++;}
    }
    cm=startM;
    for (let i=0; i<duration; i++) {
        const md=document.createElement('div'); md.className='month-cell'; md.innerText=monthNames[cm]; hdr.appendChild(md);
        cm++; if(cm>11) cm=0;
    }
    // Re-window: saat user klik "Update Timeline", bar diposisikan ulang dari tanggal
    // absolutnya (clip di kiri/sembunyikan bila di luar window) — tidak ikut bergeser.
    // Saat isLoad, bar sudah dirender oleh createRowFromData, jadi dilewati.
    if(!isLoad){
        document.querySelectorAll('.gantt-row').forEach(row=>{
            redrawGanttPillFromDates(row);
            row.querySelectorAll('.milestone').forEach(ms=>{
                const left=milestoneLeftFromMonth(ms.dataset.month);
                if(left===null){ ms.style.display='none'; }
                else { ms.style.display=''; ms.style.left=left+'%'; }
            });
        });
        if(typeof recalcAllTrafficLights==='function') recalcAllTrafficLights();
    }
    updateDateLine();
    syncFrozenColumns();
}

// ===================================================================
// PAGINATION & FILTER
// ===================================================================
// Returns all rows visible for current dept filter (used by ALL views)
function getVisibleRows() {
    const all = Array.from(document.querySelectorAll('.gantt-row'));
    if (!_deptFilter) return all;
    return all.filter(row => (row.dataset.dept || '') === _deptFilter);
}

function getFilteredRows() {
    let all = getVisibleRows();
    if (activeFilter==='all') return all;
    return all.filter(row => { const tl=row.querySelector('.traffic-light'); return tl && tl.classList.contains(activeFilter); });
}
function updatePagination() {
    const allRows = document.querySelectorAll('.gantt-row');
    const filtered = getFilteredRows();
    const totalPages = Math.ceil(filtered.length/rowsPerPage)||1;
    if (currentPage>totalPages) currentPage=totalPages;
    if (currentPage<1) currentPage=1;
    allRows.forEach(r=>r.style.display='none');
    filtered.forEach((r,i)=>{ if(i>=(currentPage-1)*rowsPerPage && i<currentPage*rowsPerPage) r.style.display='grid'; });
    document.getElementById('page-info').innerText=`Halaman ${currentPage} / ${totalPages}`;
    document.getElementById('btn-prev').disabled=(currentPage===1);
    document.getElementById('btn-next').disabled=(currentPage===totalPages);
    const cp = document.getElementById('view-count');
    if (cp) cp.textContent = filtered.length + ' project';
    updateDateLineHeight();
    syncFrozenColumns();
}
function changePage(d) { currentPage+=d; updatePagination(); }

function filterByCard(filter) {
    const filterLabels={'all':'Semua','bg-blue':'Done','bg-green':'On Track','bg-yellow':'Slightly Delay','bg-red':'Delay'};
    const cardMap={'all':'.card-total','bg-blue':'.card-done','bg-green':'.card-ontrack','bg-yellow':'.card-warning','bg-red':'.card-critical'};
    activeFilter=(activeFilter===filter||filter==='all')?'all':filter;
    document.querySelectorAll('.summary-card').forEach(c=>c.classList.remove('card-active'));
    if(activeFilter!=='all'){const s=cardMap[activeFilter];if(s){const c=document.querySelector(s);if(c)c.classList.add('card-active');}}
    const banner=document.getElementById('filter-banner');
    if(activeFilter!=='all'){document.getElementById('filter-banner-text').textContent='Filter aktif: '+(filterLabels[activeFilter]||activeFilter)+' ('+getFilteredRows().length+' project)';banner.classList.add('show');}
    else banner.classList.remove('show');
    currentPage=1; updatePagination(); refreshActiveView();
}

let _deptFilter = '';
function filterByDept(deptName) {
    _deptFilter = deptName || '';
    activeFilter = 'all';
    document.querySelectorAll('.summary-card').forEach(c => c.classList.remove('card-active'));
    const banner = document.getElementById('filter-banner');
    if(_deptFilter) {
        document.getElementById('filter-banner-text').textContent = 'Bagian: ' + _deptFilter;
        banner.classList.add('show');
    } else {
        banner.classList.remove('show');
    }
    currentPage = 1; updatePagination(); refreshActiveView();
}

// ===================================================================
// ROW MANAGEMENT
// ===================================================================


function focusEditableCell(cell){
    const editor=cell&&cell.classList&&cell.classList.contains('activity-name-text')?cell:(cell?cell.querySelector('.activity-name-text'):null);
    const target=editor||cell;
    if(!target)return;
    target.focus();
    const sel=window.getSelection&&window.getSelection();
    if(!sel)return;
    const range=document.createRange();
    range.selectNodeContents(target);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
}
function getActivityNameFromRow(row){
    const cell=row&&row.children?row.children[1]:null;
    if(!cell)return'';
    const editor=cell.querySelector('.activity-name-text');
    const text=editor?editor.innerText:cell.innerText;
    return text.trim().replace(/\n+/g,' ');
}

function addNewRow() {
    if(_weeklyViewKey){ showToast('Mode lihat riwayat — keluar ke Terkini untuk mengedit'); return; }
    const meta=document.getElementById('timeline-meta');
    if(!meta.getAttribute('data-duration')){alert('Klik Update Timeline dulu!');return;}
    const container=document.getElementById('rows-container');
    const rowDiv=document.createElement('div'); rowDiv.className='gantt-row';
    rowDiv.innerHTML=`
        <div class="action-col">
            <button class="icon-btn btn-p" onclick="addItemToRow(this,'plan')" title="Edit data Plan">&#128197;</button>
            <button class="icon-btn btn-a" onclick="addItemToRow(this,'actual')" title="Edit data Actual">&#9889;</button>
            <button class="icon-btn btn-m" onclick="addItemToRow(this,'milestone')" title="Tambah Milestone">&#9670;</button>
            <button class="icon-btn btn-d" onclick="deleteRow(this)" title="Hapus baris"><svg class="btn-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 15H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg></button>
        </div>
        <div class="editable-cell activity-cell" data-placeholder="Nama Projek..." style="position:relative;"><div class="activity-name-text" contenteditable="true" data-placeholder="Nama Projek..."></div></div>
        <div class="timeline-grid"></div>
        <div class="rag-col"><div class="traffic-light bg-grey"></div></div>
        <div class="editable-cell" contenteditable="true" data-placeholder="Update Status..."></div>`;
    container.appendChild(rowDiv);
    if (currentView === 'gantt') { const total=document.querySelectorAll('.gantt-row').length; currentPage=Math.ceil(total/rowsPerPage); }
    updatePagination();
    initDetailButtons();
    initGridDraw(rowDiv);
    refreshActiveView();
    setTimeout(()=>focusEditableCell(rowDiv.children[1]),0);
}
function deleteRow(btn) {
    if(confirm('Hapus baris ini?')){ btn.closest('.gantt-row').remove(); updatePagination(); updateSummaryCards(); refreshActiveView(); }
}

// ── Member: add own project ───────────────────────────────────────────────────
function openMemberAddProject() {
    const user = Auth.getUser();
    if (!user) return;
    const ov = document.createElement('div');
    ov.className = 'detail-overlay'; ov.id = 'member-add-ov';
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.innerHTML = `
    <div class="detail-modal" style="max-width:480px;border-radius:16px;overflow:hidden;padding:0">
        <div style="background:#0a2240;padding:20px 24px;display:flex;align-items:center;justify-content:space-between">
            <div>
                <div style="font-size:16px;font-weight:700;color:white">Tambah Project</div>
                <div style="font-size:12px;color:rgba(255,255,255,0.6);margin-top:2px">Project akan otomatis di-assign ke ${escapeHTML(user.full_name||user.username)}</div>
            </div>
            <button onclick="document.getElementById('member-add-ov').remove()" style="background:rgba(255,255,255,0.1);border:none;color:white;width:30px;height:30px;border-radius:8px;font-size:18px;cursor:pointer">&times;</button>
        </div>
        <div style="padding:20px 24px;display:flex;flex-direction:column;gap:14px">
            <div class="mdr-field">
                <label>Nama Project <span class="req">*</span></label>
                <input type="text" id="map-name" placeholder="Masukkan nama project…" style="padding:10px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:14px;outline:none" onfocus="this.style.borderColor='#00a99d'" onblur="this.style.borderColor='#dde3ec'">
            </div>
            <div class="mdr-field">
                <label>Deskripsi / Scope</label>
                <input type="text" id="map-desc" placeholder="Ringkasan project (opsional)…" style="padding:10px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:14px;outline:none" onfocus="this.style.borderColor='#00a99d'" onblur="this.style.borderColor='#dde3ec'">
            </div>
        </div>
        <div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e8edf5;display:flex;justify-content:flex-end;gap:10px">
            <button onclick="document.getElementById('member-add-ov').remove()" style="padding:9px 18px;border:1.5px solid #dde3ec;background:white;border-radius:8px;font-size:13px;cursor:pointer">Batal</button>
            <button onclick="submitMemberAddProject()" style="padding:9px 20px;background:linear-gradient(135deg,#00a99d,#0a7c86);color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Buat Project</button>
        </div>
    </div>`;
    document.body.appendChild(ov);
    setTimeout(() => document.getElementById('map-name')?.focus(), 50);
}

async function submitMemberAddProject() {
    const name = (document.getElementById('map-name')?.value || '').trim();
    if (!name) { alert('Nama project wajib diisi.'); return; }
    const user = Auth.getUser();
    if (!user) return;

    // Build a minimal project object
    const projId = 'proj_' + Date.now();
    const proj = {
        id: projId,
        name,
        department: user.dept_name || '',
        pics: [user.full_name || user.username],
        category: '', priority: 'Medium',
        actualProgress: 0, planProgress: 0,
        notes: document.getElementById('map-desc')?.value?.trim() || ''
    };

    try {
        const res = await Auth.apiFetch('/api/state/project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: proj })
        });
        if (!res || !res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Gagal');
        }
        const data = await res.json();
        document.getElementById('member-add-ov')?.remove();
        _myAssignments.push(data.projectId || projId);
        await reloadFromDatabase();
        showToast('Project berhasil dibuat dan di-assign ke ' + (user.full_name || user.username) + '!');
    } catch(e) {
        alert('Gagal membuat project: ' + e.message);
    }
}

// ===================================================================
// TRAFFIC LIGHT & SUMMARY
// ===================================================================
function refreshTrafficLight(row) {
    applyTrafficLight(row);
    updateSummaryCards();
    const sc=document.getElementById('scurve-container');
    if(sc&&sc.classList.contains('show')&&typeof renderSCurve==='function')renderSCurve();
    refreshActiveView();
}

function updateSummaryCards() {
    const rows = getVisibleRows();
    let total=0,done=0,ontrack=0,warning=0,critical=0;
    rows.forEach(row=>{
        const tl=row.querySelector('.traffic-light'); if(!tl||tl.classList.contains('bg-grey')) return;
        total++;
        if(tl.classList.contains('bg-blue'))done++;
        else if(tl.classList.contains('bg-green'))ontrack++;
        else if(tl.classList.contains('bg-yellow'))warning++;
        else if(tl.classList.contains('bg-red'))critical++;
    });
    document.getElementById('card-total').textContent=total;
    document.getElementById('card-done').textContent=done;
    document.getElementById('card-ontrack').textContent=ontrack;
    document.getElementById('card-warning').textContent=warning;
    document.getElementById('card-critical').textContent=critical;
    const pct = n => total ? Math.round(n/total*100)+'% portfolio' : '—';
    setFoot('foot-done', pct(done)); setFoot('foot-ontrack', pct(ontrack));
    setFoot('foot-warning', pct(warning)); setFoot('foot-critical', pct(critical));
    const grey = rows.length - total;
    setFoot('foot-total', grey>0 ? (grey + ' belum mulai') : 'aktif semua');
}
function setFoot(id,txt){ const e=document.getElementById(id); if(e) e.textContent=txt; }

// ===================================================================
// DATE LINE (cut-off marker)
// ===================================================================
function updateDateLineHeight() {
    const table=document.getElementById('gantt-table'); const line=document.getElementById('auto-date-line');
    if(line && table){const hdr=table.querySelector('.gantt-header'); const rows=document.getElementById('rows-container'); const h=(hdr?hdr.offsetHeight:0)+(rows?rows.offsetHeight:0); line.style.height=h+'px';}
}
function updateDateLine() {
    const meta=document.getElementById('timeline-meta');
    const startM=parseInt(meta.getAttribute('data-start-m')); const startY=parseInt(meta.getAttribute('data-start-y')); const duration=parseInt(meta.getAttribute('data-duration'));
    if(isNaN(startM)) return;
    const startDate=new Date(startY,startM,1); const endDate=new Date(startY,startM+duration,1);
    const cutoffInput=document.getElementById('cfg-cutoff').value;
    const today=cutoffInput?new Date(cutoffInput):new Date();
    const line=document.getElementById('auto-date-line'); const label=document.getElementById('date-label');
    if(!line)return;
    label.innerText=today.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'});
    if(today>=startDate&&today<=endDate){
        const totalTime=endDate-startDate; const elapsed=today-startDate; const pct=(elapsed/totalTime)*100;
        const gridHeader=document.getElementById('header-content');
        if(gridHeader){const gw=gridHeader.offsetWidth; const offsetLeft=gridHeader.offsetLeft; line.style.left=(offsetLeft+(gw*(pct/100)))+'px'; line.style.display='block';}
    } else { line.style.display='none'; }
    updateDateLineHeight();
}

// ===================================================================
// BAR / MILESTONE INTERACTION
// ===================================================================
function addItemToRow(btn, type) {
    const row=btn.closest('.gantt-row');
    if(type==='milestone'){
        // Spawn milestone at center of timeline, ready to drag immediately
        const grid=row.querySelector('.timeline-grid'); if(!grid)return;
        const cfg=getTimelineConfig();
        const midIdx=Math.floor(cfg.duration/2);
        const winStart=cfg.startY*12+cfg.startM;
        const month=absValueFromIndex(winStart+midIdx);
        const left=milestoneLeftFromMonth(month);
        const ms=document.createElement('div');
        ms.className='milestone';
        ms.dataset.month=month;
        ms.dataset.lane='1';
        ms.style.left=(left!==null?left:50)+'%';
        ms.innerHTML=`<div class="milestone-label">Milestone</div><div class="item-del" onclick="this.parentElement.remove()">x</div>`;
        grid.appendChild(ms);
        initInteract(ms);
        return;
    }
    if(type==='plan') editPlanData(row); else editActualData(row);
}
function updatePlanTarget(bar) {
    const label=getPlanLabelEl(bar); if(label)label.innerText='Plan';
    const row=bar&&bar.closest?bar.closest('.gantt-row'):null;
    if(row)refreshTrafficLight(row);
}
function updateProgress(bar) {
    const row=bar&&bar.closest?bar.closest('.gantt-row'):null;
    if(row)openBarForm(row,'actual');
}
function initInteract(el) {
    if (!el.classList.contains('milestone')) { initSingleBar(el); return; }
    // Milestone: dblclick → edit form; drag → move + sync date
    el.addEventListener('dblclick', e => { e.preventDefault(); e.stopPropagation(); openMilestoneForm(el.closest('.gantt-row'), el); });
    const startDrag=(e)=>{
        const rowEl=el.closest('.gantt-row'); if(rowEl && rowEl.dataset.dragEnabled!=='true')return;
        if(e.target.classList.contains('item-del')) return;
        e.preventDefault(); e.stopPropagation();
        const clientX=e.touches?e.touches[0].clientX:e.clientX;
        const parentWidth=el.parentElement.offsetWidth;
        const left0=parseFloat(el.style.left)||0;
        const cx0=clientX;
        const syncMonth=()=>{
            const cfg=getTimelineConfig();
            const winStart=cfg.startY*12+cfg.startM;
            const idx=Math.round(parseFloat(el.style.left)/100*cfg.duration);
            el.dataset.month=absValueFromIndex(winStart+Math.max(0,Math.min(cfg.duration-1,idx)));
        };
        const onMove=(em)=>{
            const cx=em.touches?em.touches[0].clientX:em.clientX;
            const dx=(cx-cx0)/parentWidth*100;
            el.style.left=Math.max(0,Math.min(100,left0+dx))+'%';
            syncMonth();
        };
        const onEnd=()=>{
            syncMonth();
            document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onEnd);
            document.removeEventListener('touchmove',onMove);document.removeEventListener('touchend',onEnd);
        };
        document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onEnd);
        document.addEventListener('touchmove',onMove,{passive:false});document.addEventListener('touchend',onEnd);
    };
    el.addEventListener('mousedown',startDrag); el.addEventListener('touchstart',startDrag,{passive:false});
}

function initSingleBar(el, rowOverride) {
    const handle = el.querySelector('.resize-handle');
    const isClipped = () => el.classList.contains('bar-clip-left') || el.classList.contains('bar-clip-right');

    const syncDates = () => {
        const row = rowOverride || el.closest('.gantt-row'); if (!row) return;
        const left = parseFloat(el.style.left) || 0;
        const width = parseFloat(el.style.width) || 0;
        if (width <= 0) return;
        const cfg = getTimelineConfig();
        const winStart = cfg.startY * 12 + cfg.startM;
        const r = rangeFromMetrics(left, width);
        const start = absValueFromIndex(winStart + r.start);
        const end   = absValueFromIndex(winStart + r.end);
        const type = el.dataset.barType || (el.classList.contains('bar-actual') ? 'actual' : 'plan');
        const c = getRowCanonical(row) || {};
        if (type === 'actual') { c.actualStart = start; c.actualEnd = end; el.dataset.actualStart = start; el.dataset.actualEnd = end; }
        else                   { c.planStart   = start; c.planEnd   = end; el.dataset.planStart   = start; el.dataset.planEnd   = end; }
        setRowCanonical(row, c);
        // update actual label text
        if (type === 'actual') {
            const lbl = el.querySelector('.actual-label');
            if (lbl) lbl.textContent = 'Act: ' + (c.actualProgress||0) + '%';
        }
        refreshTrafficLight(row);
        // sync popover footer inputs if row-focus is open
        const rfRow = document.getElementById('rf-grid') && document.getElementById('rf-grid')._sourceRow;
        if (rfRow === row) {
            const s = id => document.getElementById(id);
            if (type === 'actual') { if(s('rf-act-start')) s('rf-act-start').value=start; if(s('rf-act-end')) s('rf-act-end').value=end; }
            else                   { if(s('rf-plan-start')) s('rf-plan-start').value=start; if(s('rf-plan-end')) s('rf-plan-end').value=end; }
        }
    };

    // Drag (move whole bar)
    const startDrag = (e) => {
        const rowEl = rowOverride || el.closest('.gantt-row'); if (!rowEl || rowEl.dataset.dragEnabled !== 'true') return;
        if (isClipped()) return;
        if (e.target === handle) return;
        e.preventDefault(); e.stopPropagation();
        const cx0 = e.touches ? e.touches[0].clientX : e.clientX;
        const left0 = parseFloat(el.style.left) || 0;
        const pw = el.parentElement.offsetWidth;
        const onMove = (em) => {
            const cx = em.touches ? em.touches[0].clientX : em.clientX;
            const dx = (cx - cx0) / pw * 100;
            const w = parseFloat(el.style.width) || 0;
            el.style.left = Math.max(0, Math.min(100 - w, left0 + dx)) + '%';
        };
        const onEnd = () => { syncDates(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); };
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd);
        document.addEventListener('touchmove', onMove, {passive:false}); document.addEventListener('touchend', onEnd);
    };
    el.addEventListener('mousedown', startDrag); el.addEventListener('touchstart', startDrag, {passive:false});

    // Resize (right edge)
    if (handle) {
        const startResize = (e) => {
            const rowEl = rowOverride || el.closest('.gantt-row'); if (!rowEl || rowEl.dataset.dragEnabled !== 'true') return;
            if (isClipped()) return;
            e.preventDefault(); e.stopPropagation();
            const cx0 = e.touches ? e.touches[0].clientX : e.clientX;
            const w0 = el.offsetWidth;
            const pw = el.parentElement.offsetWidth;
            const minW = pw / (getTimelineConfig().duration || 24); // min 1 month
            const onMove = (em) => {
                const cx = em.touches ? em.touches[0].clientX : em.clientX;
                const nw = Math.max(minW, w0 + (cx - cx0));
                el.style.width = (nw / pw * 100) + '%';
            };
            const onEnd = () => { syncDates(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onEnd); document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onEnd); };
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchmove', onMove, {passive:false}); document.addEventListener('touchend', onEnd);
        };
        handle.addEventListener('mousedown', startResize); handle.addEventListener('touchstart', startResize, {passive:false});
    }
}

// ===================================================================
// ROW FOCUS — fullscreen single-row Gantt editor
// ===================================================================
function openRowFocus(btn) {
    const row = btn.closest('.gantt-row');
    const name = (row.querySelector('.activity-name-text') || {}).innerText || '(Tanpa Nama)';
    const canEdit = row.dataset.dragEnabled !== undefined;
    const cfg = getTimelineConfig();
    const c = getRowCanonical(row) || {};

    // Build month header labels
    let monthLabels = '';
    let cm = cfg.startM, cy = cfg.startY;
    const mNames = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    for (let i = 0; i < cfg.duration; i++) {
        const isYear = (i === 0 || cm === 0);
        monthLabels += `<div class="rf-mcell${isYear?' rf-year-start':''}">${isYear?cy+' · ':''}<span>${mNames[cm]}</span></div>`;
        cm++; if (cm > 11) { cm = 0; cy++; }
    }

    const ov = document.createElement('div');
    ov.id = 'row-focus-ov';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(10,34,64,0.75);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(3px);animation:dtFadeIn 0.2s ease';
    ov.addEventListener('click', e => { if (e.target === ov) closeRowFocus(); });

    ov.innerHTML = `
    <div style="background:white;border-radius:16px;width:100%;max-width:1100px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(10,34,64,0.3)">
        <div style="background:#0a2240;padding:16px 20px;display:flex;align-items:center;gap:14px;flex-shrink:0">
            <div style="flex:1;min-width:0">
                <div style="font-size:15px;font-weight:700;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHTML(name)}</div>
                <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px">Drag area atas → Plan &nbsp;|&nbsp; Drag area bawah → Actual &nbsp;|&nbsp; Drag bar untuk geser &nbsp;|&nbsp; Klik bar → Edit tanggal</div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0">
                <button onclick="rfUnlockToggle()" id="rf-lock-btn" style="padding:7px 14px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:8px;font-size:12px;cursor:pointer;font-weight:500">🔓 Aktif</button>
                <button onclick="closeRowFocus()" style="background:rgba(255,255,255,0.1);border:none;color:white;width:32px;height:32px;border-radius:8px;font-size:18px;cursor:pointer">&times;</button>
            </div>
        </div>
        <!-- Month header -->
        <div style="overflow-x:auto;flex-shrink:0;border-bottom:1px solid #e8edf5">
            <div id="rf-header" style="display:grid;grid-template-columns:repeat(${cfg.duration},1fr);min-width:800px;background:#f8fafc"></div>
        </div>
        <!-- Big timeline area -->
        <div style="overflow-x:auto;flex:1;min-height:200px">
            <div id="rf-grid" style="position:relative;min-width:800px;height:100%;min-height:200px;background-image:linear-gradient(to right,#e8edf5 1px,transparent 1px);background-size:calc(100%/${cfg.duration}) 100%;cursor:crosshair"></div>
        </div>
        <!-- Footer controls -->
        <div style="padding:14px 20px;background:#f8fafc;border-top:1px solid #e8edf5;display:flex;align-items:center;gap:10px;flex-shrink:0;flex-wrap:wrap">
            <span style="font-size:12px;color:#6b7a8d;font-weight:500">Quick set:</span>
            <div style="display:flex;gap:6px;align-items:center">
                <label style="font-size:12px;color:#6b7a8d">Plan</label>
                <input type="month" id="rf-plan-start" value="${c.planStart||''}" style="padding:5px 8px;border:1.5px solid #dde3ec;border-radius:7px;font-size:12px;outline:none" oninput="rfApplyDates()">
                <span style="color:#9ca3af;font-size:11px">→</span>
                <input type="month" id="rf-plan-end" value="${c.planEnd||''}" style="padding:5px 8px;border:1.5px solid #dde3ec;border-radius:7px;font-size:12px;outline:none" oninput="rfApplyDates()">
            </div>
            <div style="display:flex;gap:6px;align-items:center">
                <label style="font-size:12px;color:#6b7a8d">Actual</label>
                <input type="month" id="rf-act-start" value="${c.actualStart||''}" style="padding:5px 8px;border:1.5px solid #dde3ec;border-radius:7px;font-size:12px;outline:none" oninput="rfApplyDates()">
                <span style="color:#9ca3af;font-size:11px">→</span>
                <input type="month" id="rf-act-end" value="${c.actualEnd||''}" style="padding:5px 8px;border:1.5px solid #dde3ec;border-radius:7px;font-size:12px;outline:none" oninput="rfApplyDates()">
            </div>
            <div style="display:flex;gap:6px;align-items:center;margin-left:auto">
                <label style="font-size:12px;color:#6b7a8d">Actual %</label>
                <input type="range" id="rf-progress" min="0" max="100" value="${c.actualProgress||0}" style="width:100px" oninput="document.getElementById('rf-pval').textContent=this.value+'%';rfApplyDates()">
                <span id="rf-pval" style="font-size:12px;font-weight:600;color:#0e7c86;min-width:34px">${c.actualProgress||0}%</span>
            </div>
        </div>
    </div>`;

    document.body.appendChild(ov);

    // Fill header
    document.getElementById('rf-header').innerHTML = monthLabels;

    // Clone row's timeline content into big grid
    const rfGrid = document.getElementById('rf-grid');
    rfGrid._sourceRow = row;
    rfGrid.dataset.dragEnabled = 'true';
    // rfGrid acts as both the gantt-row and timeline-grid for focus mode
    rfGrid.dataset.planStart = c.planStart||'';
    rfGrid.dataset.planEnd   = c.planEnd||'';
    rfGrid.dataset.actualStart = c.actualStart||'';
    rfGrid.dataset.actualEnd   = c.actualEnd||'';
    rfGrid.dataset.actualProgress = String(c.actualProgress||0);

    rfRedraw();
}

function rfRedraw() {
    const rfGrid = document.getElementById('rf-grid');
    if (!rfGrid) return;
    const sourceRow = rfGrid._sourceRow;
    const c = getRowCanonical(sourceRow) || {};

    // Remove old bars/milestones (keep grid structure)
    rfGrid.querySelectorAll('.bar, .milestone').forEach(el => el.remove());

    const html = buildGanttPillHTML(c);
    if (html) {
        rfGrid.insertAdjacentHTML('afterbegin', html);
        rfGrid.querySelectorAll('.bar-plan, .bar-actual').forEach(bar => {
            initSingleBar(bar, rfGrid);
            bar.addEventListener('click', e => {
                if (e.detail > 1) return;
                openBarPopover(bar, bar.dataset.barType, sourceRow);
            });
        });
    }

    // Also clone milestones from source row — make them draggable in focus modal
    sourceRow.querySelectorAll('.milestone').forEach(ms => {
        const clone = ms.cloneNode(true);
        clone.style.position = 'absolute';
        rfGrid.appendChild(clone);
        bindMilestoneDraggable(clone, rfGrid, sourceRow);
    });

    // Drag-to-create directly on rfGrid
    rfGrid.dataset.drawInit = '';
    initGridDrawDirect(rfGrid, sourceRow);

    // Patch sync on mouseup to update footer inputs
    const patchSync = () => {
        const c2 = getRowCanonical(sourceRow) || {};
        const s = id => document.getElementById(id);
        if(s('rf-plan-start')) s('rf-plan-start').value = c2.planStart||'';
        if(s('rf-plan-end'))   s('rf-plan-end').value   = c2.planEnd||'';
        if(s('rf-act-start'))  s('rf-act-start').value  = c2.actualStart||'';
        if(s('rf-act-end'))    s('rf-act-end').value    = c2.actualEnd||'';
    };
    if (rfGrid._patchSync) document.removeEventListener('mouseup', rfGrid._patchSync);
    document.addEventListener('mouseup', patchSync);
    rfGrid._patchSync = patchSync;
}

function rfApplyDates() {
    const rfGrid = document.getElementById('rf-grid');
    if (!rfGrid) return;
    const sourceRow = rfGrid._sourceRow;
    const get = id => (document.getElementById(id)||{}).value||'';
    const existing = getRowCanonical(sourceRow) || {};
    if (get('rf-plan-start')) existing.planStart = get('rf-plan-start');
    if (get('rf-plan-end'))   existing.planEnd   = get('rf-plan-end');
    if (get('rf-act-start'))  existing.actualStart = get('rf-act-start');
    if (get('rf-act-end'))    existing.actualEnd   = get('rf-act-end');
    const prog = document.getElementById('rf-progress');
    if (prog) existing.actualProgress = parseInt(prog.value)||0;
    setRowCanonical(sourceRow, existing);
    redrawGanttPillFromDates(sourceRow);
    rfRedraw();
}

function rfUnlockToggle() {
    const rfGrid = document.getElementById('rf-grid');
    if (!rfGrid) return;
    const on = rfGrid.dataset.dragEnabled === 'true';
    rfGrid.dataset.dragEnabled = on ? 'false' : 'true';
    const btn = document.getElementById('rf-lock-btn');
    if (btn) { btn.textContent = on ? '🔒 Kunci' : '🔓 Aktif'; }
    rfRedraw();
}

function closeRowFocus() {
    const ov = document.getElementById('row-focus-ov');
    if (!ov) return;
    const rfGrid = document.getElementById('rf-grid');
    if (rfGrid && rfGrid._patchSync) document.removeEventListener('mouseup', rfGrid._patchSync);
    closeBarPopover();
    ov.remove();
}

// Variant of initGridDraw for rfGrid (focus modal) — grid IS the row container.
function initGridDrawDirect(rfGrid, sourceRow) {
    if (rfGrid.dataset.drawInit === '1') return;
    rfGrid.dataset.drawInit = '1';

    let ghost = null, startPct = 0, drawType = 'plan', clickOnly = true;

    const pctFromEvent = (e) => {
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = rfGrid.getBoundingClientRect();
        return Math.max(0, Math.min(100, (cx - rect.left) / rect.width * 100));
    };

    const zoneFromEvent = (e) => {
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = rfGrid.getBoundingClientRect();
        return (cy - rect.top) / rect.height < 0.5 ? 'plan' : 'actual';
    };

    const pctToAbsDate = (pct) => {
        const cfg = getTimelineConfig();
        const idx = Math.round(pct / 100 * cfg.duration);
        const clamped = Math.max(0, Math.min(cfg.duration - 1, idx));
        const winStart = cfg.startY * 12 + cfg.startM;
        return absValueFromIndex(winStart + clamped);
    };

    const onDown = (e) => {
        if (rfGrid.dataset.dragEnabled !== 'true') return;
        if (e.target !== rfGrid && e.target.closest('.bar, .milestone')) return;
        e.preventDefault();
        clickOnly = true;
        drawType = zoneFromEvent(e);
        startPct = pctFromEvent(e);

        ghost = document.createElement('div');
        ghost.className = 'draw-ghost draw-ghost-' + drawType;
        const isActual = drawType === 'actual';
        ghost.style.cssText = `position:absolute;top:${isActual?'58%':'8%'};height:30%;left:${startPct}%;width:0.5%;pointer-events:none;border-radius:6px;opacity:0.75;z-index:5;background:${isActual?'#0e7c86':'#7ba7c9'};box-shadow:0 2px 6px rgba(0,0,0,0.15);`;
        rfGrid.appendChild(ghost);

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    const onMove = (e) => {
        if (!ghost) return;
        clickOnly = false;
        const cur = pctFromEvent(e);
        const left = Math.min(startPct, cur);
        const width = Math.abs(cur - startPct);
        ghost.style.left = left + '%';
        ghost.style.width = Math.max(width, 0.5) + '%';
    };

    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        if (!ghost) return;
        ghost.remove(); ghost = null;

        const endPct = pctFromEvent(e);
        if (clickOnly || Math.abs(endPct - startPct) < 1) return;

        const leftPct = Math.min(startPct, endPct);
        const rightPct = Math.max(startPct, endPct);
        const startDate = pctToAbsDate(leftPct);
        const endDate = pctToAbsDate(rightPct);

        const existing = getRowCanonical(sourceRow) || {};
        if (drawType === 'plan') {
            existing.planStart = startDate;
            existing.planEnd = endDate;
        } else {
            existing.actualStart = startDate;
            existing.actualEnd = endDate;
        }
        setRowCanonical(sourceRow, existing);
        redrawGanttPillFromDates(sourceRow);
        rfRedraw();
        // Open popover for fine-tuning
        const barSel = drawType === 'actual' ? '.bar-actual' : '.bar-plan';
        const bar = rfGrid.querySelector(barSel);
        if (bar) openBarPopover(bar, drawType, sourceRow);
    };

    rfGrid.addEventListener('mousedown', onDown);
    rfGrid.addEventListener('touchstart', onDown, { passive: false });
}

// ===================================================================
// DRAG-TO-CREATE: draw Plan/Actual bar by dragging on empty timeline grid
// Top half of grid → Plan, Bottom half → Actual. Click → Milestone.
// Click existing bar → open quick-edit popover.
// ===================================================================
function initGridDraw(row) {
    const grid = row.querySelector('.timeline-grid');
    if (!grid || grid.dataset.drawInit === '1') return;
    grid.dataset.drawInit = '1';

    let ghost = null, startPct = 0, drawType = 'plan', clickOnly = true;

    const pctFromEvent = (e) => {
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = grid.getBoundingClientRect();
        return Math.max(0, Math.min(100, (cx - rect.left) / rect.width * 100));
    };

    const zoneFromEvent = (e) => {
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = grid.getBoundingClientRect();
        return (cy - rect.top) / rect.height < 0.5 ? 'plan' : 'actual';
    };

    const pctToAbsDate = (pct) => {
        const cfg = getTimelineConfig();
        const idx = Math.round(pct / 100 * cfg.duration);
        const clamped = Math.max(0, Math.min(cfg.duration - 1, idx));
        const winStart = cfg.startY * 12 + cfg.startM;
        return absValueFromIndex(winStart + clamped);
    };

    const onDown = (e) => {
        if (row.dataset.dragEnabled !== 'true') return;
        if (e.target !== grid && e.target.closest('.bar, .milestone')) return;
        e.preventDefault();
        clickOnly = true;
        drawType = zoneFromEvent(e);
        startPct = pctFromEvent(e);

        ghost = document.createElement('div');
        ghost.className = 'draw-ghost draw-ghost-' + drawType;
        const isActual = drawType === 'actual';
        ghost.style.cssText = `position:absolute;top:${isActual?'58%':'8%'};height:30%;left:${startPct}%;width:0.5%;pointer-events:none;border-radius:6px;opacity:0.75;z-index:5;background:${isActual?'#0e7c86':'#7ba7c9'};box-shadow:0 2px 6px rgba(0,0,0,0.15);`;
        grid.appendChild(ghost);

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    const onMove = (e) => {
        if (!ghost) return;
        clickOnly = false;
        const cur = pctFromEvent(e);
        const left = Math.min(startPct, cur);
        const width = Math.abs(cur - startPct);
        ghost.style.left = left + '%';
        ghost.style.width = Math.max(width, 0.5) + '%';
    };

    const onUp = (e) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
        if (!ghost) return;
        ghost.remove(); ghost = null;

        const endPct = pctFromEvent(e);

        if (clickOnly || Math.abs(endPct - startPct) < 1) {
            // Too short — ignore, milestone stays button-only
            return;
        }

        const leftPct = Math.min(startPct, endPct);
        const rightPct = Math.max(startPct, endPct);
        const startDate = pctToAbsDate(leftPct);
        const endDate = pctToAbsDate(rightPct);

        const existing = getRowCanonical(row) || {};
        if (drawType === 'plan') {
            existing.planStart = startDate;
            existing.planEnd = endDate;
        } else {
            existing.actualStart = startDate;
            existing.actualEnd = endDate;
        }
        setRowCanonical(row, existing);
        redrawGanttPillFromDates(row);
        // Open popover immediately so user can fine-tune
        const barSel = drawType === 'actual' ? '.bar-actual' : '.bar-plan';
        const bar = grid.querySelector(barSel);
        if (bar) openBarPopover(bar, drawType, row);
    };

    grid.addEventListener('mousedown', onDown);
    grid.addEventListener('touchstart', onDown, { passive: false });
}

// ── Bar click → quick-edit popover ────────────────────────────────────────────
function openBarPopover(bar, barType, row) {
    closeBarPopover();
    if (!row) row = bar.closest('.gantt-row');
    const c = getRowCanonical(row) || {};

    if (!barType) barType = bar.dataset.barType || (bar.classList.contains('bar-actual') ? 'actual' : 'plan');

    const isActual = barType === 'actual';
    const startVal = isActual ? (c.actualStart || '') : (c.planStart || '');
    const endVal   = isActual ? (c.actualEnd   || '') : (c.planEnd   || '');

    const fmtMonth = (v) => {
        if (!v) return '';
        const m = String(v).match(/^(\d{4})-(\d{1,2})$/);
        if (!m) return v;
        const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
        return names[parseInt(m[2])-1] + ' ' + m[1];
    };

    const pop = document.createElement('div');
    pop.id = 'bar-popover';
    pop.style.cssText = `position:fixed;z-index:9999;background:white;border-radius:12px;box-shadow:0 8px 32px rgba(10,34,64,0.18);padding:0;width:400px;animation:dtFadeIn 0.15s ease;`;

    pop.innerHTML = `
    <div style="background:${isActual?'linear-gradient(135deg,#0e7c86,#0a5f6a)':'linear-gradient(135deg,#1a5f8a,#0a2240)'};padding:12px 16px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between">
        <div style="color:white">
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;opacity:0.75">${isActual?'Actual Bar':'Plan Bar'}</div>
            <div id="bpop-range" style="font-size:13px;font-weight:600;margin-top:2px">${fmtMonth(startVal)} → ${fmtMonth(endVal)}</div>
        </div>
        <button onclick="closeBarPopover()" style="background:rgba(255,255,255,0.15);border:none;color:white;width:26px;height:26px;border-radius:6px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center">&times;</button>
    </div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div>
                <label style="font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:4px">Mulai</label>
                <input type="month" id="bpop-start" value="${startVal}" style="width:100%;padding:7px 10px;border:1.5px solid #dde3ec;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box" oninput="bpopUpdate()">
            </div>
            <div>
                <label style="font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:4px">Selesai</label>
                <input type="month" id="bpop-end" value="${endVal}" style="width:100%;padding:7px 10px;border:1.5px solid #dde3ec;border-radius:8px;font-size:13px;outline:none;box-sizing:border-box" oninput="bpopUpdate()">
            </div>
        </div>
        <div style="display:flex;gap:6px">
            <button onclick="bpopShift(-1)" title="Geser mundur 1 bulan" style="flex:1;padding:7px;border:1.5px solid #dde3ec;background:white;border-radius:8px;font-size:12px;cursor:pointer">← 1 bln</button>
            <button onclick="bpopShift(1)"  title="Geser maju 1 bulan"  style="flex:1;padding:7px;border:1.5px solid #dde3ec;background:white;border-radius:8px;font-size:12px;cursor:pointer">1 bln →</button>
            <button onclick="bpopApply()" style="flex:2;padding:7px 14px;background:${isActual?'#0e7c86':'#0a2240'};color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Terapkan</button>
        </div>
        ${isActual ? `<div>
            <label style="font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px;display:block;margin-bottom:4px">Progress Aktual (%)</label>
            <div style="display:flex;align-items:center;gap:8px">
                <input type="range" id="bpop-progress" min="0" max="100" value="${c.actualProgress||0}" style="flex:1" oninput="document.getElementById('bpop-progress-val').textContent=this.value+'%'">
                <span id="bpop-progress-val" style="font-size:13px;font-weight:600;color:#0e7c86;min-width:36px">${c.actualProgress||0}%</span>
            </div>
        </div>` : ''}
    </div>`;

    // Position near bar
    const barRect = bar.getBoundingClientRect();
    document.body.appendChild(pop);
    const popH = pop.offsetHeight;
    let top = barRect.bottom + 6;
    if (top + popH > window.innerHeight - 10) top = barRect.top - popH - 6;
    let left = barRect.left + barRect.width / 2 - 200;
    left = Math.max(8, Math.min(left, window.innerWidth - 408));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';

    pop._row = row;
    pop._barType = barType;

    // Close on outside click
    setTimeout(() => document.addEventListener('mousedown', _bpopOutside), 0);
}

function _bpopOutside(e) {
    const pop = document.getElementById('bar-popover');
    if (pop && !pop.contains(e.target)) { closeBarPopover(); }
}
function closeBarPopover() {
    const pop = document.getElementById('bar-popover');
    if (pop) pop.remove();
    document.removeEventListener('mousedown', _bpopOutside);
}

function bpopUpdate() {
    const s = document.getElementById('bpop-start')?.value || '';
    const en = document.getElementById('bpop-end')?.value || '';
    const fmtMonth = (v) => {
        if (!v) return '—';
        const m = String(v).match(/^(\d{4})-(\d{1,2})$/);
        if (!m) return v;
        const names = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
        return names[parseInt(m[2])-1] + ' ' + m[1];
    };
    const rangeEl = document.getElementById('bpop-range');
    if (rangeEl) rangeEl.textContent = fmtMonth(s) + ' → ' + fmtMonth(en);
}

function bpopShift(months) {
    const shiftDate = (val, delta) => {
        const m = String(val||'').match(/^(\d{4})-(\d{1,2})$/);
        if (!m) return val;
        let y = parseInt(m[1]), mo = parseInt(m[2]) - 1;
        mo += delta; y += Math.floor(mo / 12); mo = ((mo % 12) + 12) % 12;
        return y + '-' + String(mo + 1).padStart(2, '0');
    };
    const sEl = document.getElementById('bpop-start');
    const eEl = document.getElementById('bpop-end');
    if (sEl) sEl.value = shiftDate(sEl.value, months);
    if (eEl) eEl.value = shiftDate(eEl.value, months);
    bpopUpdate();
}

function bpopApply() {
    const pop = document.getElementById('bar-popover');
    if (!pop) return;
    const row = pop._row;
    const barType = pop._barType;
    const startVal = document.getElementById('bpop-start')?.value;
    const endVal   = document.getElementById('bpop-end')?.value;
    if (!startVal || !endVal) { alert('Isi tanggal mulai dan selesai.'); return; }

    const existing = getRowCanonical(row) || {};
    if (barType === 'actual') {
        existing.actualStart = startVal;
        existing.actualEnd   = endVal;
        const prog = document.getElementById('bpop-progress');
        if (prog) existing.actualProgress = parseInt(prog.value) || 0;
    } else {
        existing.planStart = startVal;
        existing.planEnd   = endVal;
    }
    setRowCanonical(row, existing);
    redrawGanttPillFromDates(row);
    closeBarPopover();
}

// ===================================================================
// UTILITIES
// ===================================================================
function escapeHTML(str){ if(!str)return''; const div=document.createElement('div'); div.appendChild(document.createTextNode(str)); return div.innerHTML; }
function getCutoffDate(){ const cv=(document.getElementById('cfg-cutoff')||{}).value; const d=cv?new Date(cv):new Date(); d.setHours(0,0,0,0); return d; }
function isOverdue(dueStr, ragKey){ if(!dueStr)return false; if(ragKey==='blue'||ragKey==='bg-blue')return false; const d=new Date(dueStr); if(isNaN(d))return false; d.setHours(0,0,0,0); return d < getCutoffDate(); }
function formatDue(dueStr){ if(!dueStr)return''; const d=new Date(dueStr); if(isNaN(d))return dueStr; return d.toLocaleDateString('id-ID',{day:'numeric',month:'short',year:'numeric'}); }
function showToast(msg){
    const t=document.createElement('div');
    t.style.cssText='position:fixed;bottom:24px;right:24px;background:#0E2444;color:#fff;padding:12px 20px;border-radius:9px;font-size:0.85rem;font-weight:500;z-index:99999;box-shadow:0 8px 28px rgba(10,26,48,0.35);animation:dtFadeIn 0.2s ease;max-width:360px;';
    t.textContent=msg; document.body.appendChild(t);
    setTimeout(()=>{t.style.opacity='0';t.style.transition='opacity 0.3s';setTimeout(()=>t.remove(),300);},3200);
}

// ===================================================================
// VERSION HISTORY storage
// ===================================================================
function getHistory(){try{return JSON.parse(sessionStorage.getItem('dpcd-history')||'[]');}catch(e){return[];}}
function setHistory(h){sessionStorage.setItem('dpcd-history',JSON.stringify(h));}
function captureSnapshot(){
    const rows=document.querySelectorAll('.gantt-row'); const projects=[];
    rows.forEach(row=>{
        const name=getActivityNameFromRow(row).substring(0,60);
        if(!name)return;
        let planPct=0,actPct=0,rag='grey';
        planPct=getPlanTargetFromRow(row);
        actPct=getActualProgressFromRow(row);
        rag=computeRagKey(planPct,actPct);
        projects.push({n:name,p:planPct,a:actPct,r:rag});
    });
    const snapshot={ts:Date.now(),d:new Date().toLocaleString('id-ID',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),projects};
    const history=getHistory(); history.unshift(snapshot); if(history.length>50)history.length=50; setHistory(history);
}

// ===================================================================
// WEEKLY "AS OF" SNAPSHOTS & FILTER
// ===================================================================
// Kunci bucket per minggu kalender (ISO week) — sortable & unik.
function isoWeekKey(date){
    const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
    const day=d.getUTCDay()||7; // Senin=1 .. Minggu=7
    d.setUTCDate(d.getUTCDate()+4-day); // Kamis minggu ini
    const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
    const weekNo=Math.ceil((((d-yearStart)/86400000)+1)/7);
    return d.getUTCFullYear()+'-W'+String(weekNo).padStart(2,'0');
}
// Label ramah: "Minggu N <Bulan>" (week-of-month) — sesuai maksud "week1-june".
function weeklyLabelFull(date){
    const monthsFull=["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
    const n=Math.ceil(date.getDate()/7);
    return 'Minggu '+n+' '+monthsFull[date.getMonth()];
}
// Upsert bucket minggu berjalan dari kondisi terkini (latest-save-wins per weekKey).
function upsertWeeklySnapshot(baseArray, projects){
    const arr=Array.isArray(baseArray)?baseArray.slice():[];
    const now=new Date();
    const weekKey=isoWeekKey(now);
    const snapProjects={};
    (projects||[]).forEach(p=>{
        if(!p||!p.name)return;
        snapProjects[p.name]={
            actualProgress: p.actualProgress||0,
            actualStart: p.actualStart||'',
            actualEnd: p.actualEnd||'',
            status: p.status||''
        };
    });
    const bucket={ weekKey, label: weeklyLabelFull(now), asOfDate: getLocalTodayISO(), capturedAt: getLocalTimestamp(), projects: snapProjects };
    const idx=arr.findIndex(s=>s && s.weekKey===weekKey);
    if(idx>=0) arr[idx]=bucket; else arr.push(bucket);
    return arr;
}
function getWeeklySnapshots(){ return (_appData && Array.isArray(_appData.weeklySnapshots)) ? _appData.weeklySnapshots : []; }
// Isi dropdown #weekly-filter: Live + daftar minggu (terbaru dulu).
function populateWeeklyFilter(){
    const sel=document.getElementById('weekly-filter');
    if(!sel)return;
    const prev=sel.value;
    const snaps=getWeeklySnapshots().slice().sort((a,b)=> (a.weekKey<b.weekKey?1:a.weekKey>b.weekKey?-1:0));
    let html='<option value="__live__">Terkini (Live)</option>';
    snaps.forEach(s=>{ html+='<option value="'+escapeHTML(s.weekKey)+'">'+escapeHTML(s.label||s.weekKey)+'</option>'; });
    sel.innerHTML=html;
    if(prev && Array.prototype.some.call(sel.options,o=>o.value===prev)) sel.value=prev;
    else sel.value = _weeklyViewKey || '__live__';
}
function onWeeklyFilterChange(value){
    if(!value || value==='__live__') exitWeeklyView();
    else enterWeeklyView(value);
}
// Render kondisi "as of minggu": clone state live, overlay nilai historis,
// set cutoff ke tanggal minggu itu, lalu render read-only.
function enterWeeklyView(weekKey){
    const snap=getWeeklySnapshots().find(s=>s && s.weekKey===weekKey);
    const sel=document.getElementById('weekly-filter');
    if(!snap){ showToast('Snapshot minggu tidak ditemukan'); if(sel)sel.value=(_weeklyViewKey||'__live__'); return; }
    if(!_appData){ showToast('Data belum dimuat'); if(sel)sel.value='__live__'; return; }
    const view=JSON.parse(JSON.stringify(_appData));
    (view.projects||[]).forEach(p=>{
        const sp=snap.projects && snap.projects[p.name];
        if(sp){
            p.actualProgress=sp.actualProgress||0;
            p.actualStart=sp.actualStart||'';
            p.actualEnd=sp.actualEnd||'';
            p.status=sp.status||'';
        } else {
            // Proyek belum eksis pada minggu itu → tampil "Belum Mulai".
            p.actualProgress=0; p.actualStart=''; p.actualEnd='';
        }
    });
    _weeklyViewKey=weekKey;
    renderDashboardFromData(view, snap.asOfDate);
    setWeeklyReadOnly(true, snap.label||weekKey);
    if(activeFilter && activeFilter!=='all') updatePagination();
    if(sel) sel.value=weekKey;
}
function exitWeeklyView(){
    const wasView=_weeklyViewKey;
    _weeklyViewKey=null;
    setWeeklyReadOnly(false);
    if(wasView && _appData) renderDashboardFromData(_appData);
    const sel=document.getElementById('weekly-filter'); if(sel)sel.value='__live__';
}
// Kunci editing/drag/save + banner saat melihat kondisi minggu lampau.
function setWeeklyReadOnly(on, label){
    const tbl=document.getElementById('gantt-table');
    if(tbl) tbl.classList.toggle('weekly-readonly', !!on);
    document.body.classList.toggle('weekly-view-active', !!on);
    let banner=document.getElementById('weekly-view-banner');
    if(on){
        if(!banner){
            banner=document.createElement('div');
            banner.id='weekly-view-banner';
            banner.className='weekly-view-banner';
            const wrap=document.getElementById('gantt-wrap');
            if(wrap && wrap.parentNode) wrap.parentNode.insertBefore(banner, wrap);
            else document.body.appendChild(banner);
        }
        banner.innerHTML='📅 Menampilkan kondisi: <strong>'+escapeHTML(label||'')+'</strong> <span>(read-only)</span> '+
            '<button type="button" onclick="onWeeklyFilterChange(\'__live__\')">✕ Kembali ke Terkini</button>';
        banner.style.display='flex';
    } else if(banner){
        banner.style.display='none';
    }
    document.querySelectorAll('#rows-container [contenteditable]').forEach(el=>{
        if(on){ if(el.getAttribute('contenteditable')==='true'){ el.setAttribute('data-weekly-ce','1'); el.setAttribute('contenteditable','false'); } }
        else { if(el.getAttribute('data-weekly-ce')==='1'){ el.setAttribute('contenteditable','true'); el.removeAttribute('data-weekly-ce'); } }
    });
}

// ===================================================================
// DETAIL buttons
// ===================================================================
function initDetailButtons(){
    document.querySelectorAll('.gantt-row').forEach(row=>{
        // Wire drag-to-create on timeline grid
        initGridDraw(row);
        const nameCell=row.children[1];if(!nameCell||nameCell.querySelector('.detail-icon-btn'))return;
        nameCell.style.position='relative';
        const btn=document.createElement('button');
        btn.type='button';
        btn.className='detail-icon-btn';
        btn.setAttribute('contenteditable','false');
        btn.contentEditable='false';
        btn.tabIndex=-1;
        btn.textContent='i';
        btn.title='Lihat Detail Project';
        btn.onmousedown=function(e){e.preventDefault();e.stopPropagation();};
        btn.onclick=function(e){e.preventDefault();e.stopPropagation();openProjectDetail(row);};
        nameCell.appendChild(btn);
        const lockBtn=document.createElement('button');
        lockBtn.type='button';
        lockBtn.className='drag-lock-btn';
        lockBtn.setAttribute('contenteditable','false');
        lockBtn.contentEditable='false';
        lockBtn.tabIndex=-1;
        lockBtn.textContent='🔒';
        lockBtn.title='Aktifkan geser Gantt';
        lockBtn.onmousedown=function(e){e.preventDefault();e.stopPropagation();};
        lockBtn.onclick=function(e){
            e.preventDefault();e.stopPropagation();
            const on=row.dataset.dragEnabled==='true';
            row.dataset.dragEnabled=on?'false':'true';
            lockBtn.classList.toggle('active',!on);
            lockBtn.textContent=on?'🔒':'🔓';
            lockBtn.title=on?'Aktifkan geser Gantt':'Kunci geser Gantt';
        };
        nameCell.appendChild(lockBtn);
    });
}

// ===================================================================
// INIT — keyboard + auto-load
// ===================================================================
document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
        const d=document.getElementById('detail-overlay');if(d){closeProjectDetail();return;}
        const r=document.getElementById('weekly-reminder');if(r)r.remove();
        const ex=document.getElementById('exec-overlay');if(ex)ex.remove();
        const hi=document.getElementById('history-overlay');if(hi)hi.remove();
    }
});

let _autoReloadTimer = null;
function scheduleAutoReload(){if(_autoReloadTimer){clearInterval(_autoReloadTimer);_autoReloadTimer=null;}}
async function loadFromJSON(){ return reloadFromDatabase(); }
async function reloadFromStorage(){ return reloadFromDatabase(); }
async function saveHandleToStorage(){ showToast('Data sudah tersambung ke database'); }

function openMemberProgressModal(btn) {
    const row = btn.closest('.gantt-row');
    if (!row) return;
    // Get current values from row
    const nameEl = row.querySelector('.activity-name-text');
    const statusEl = row.querySelector('.editable-cell:not(.activity-cell)');
    const tlEl = row.querySelector('.traffic-light');
    const currentProgress = parseInt(row.getAttribute('data-actual-progress') || '0');
    const currentStatus = statusEl ? statusEl.innerText.trim() : '';
    const currentRag = tlEl ? (tlEl.className.replace('traffic-light','').trim() || 'bg-grey') : 'bg-grey';
    const projName = nameEl ? nameEl.innerText.trim() : 'Project';

    // Find project id from serialized state
    const state = serializeCurrentState();
    const idx = state.projects ? state.projects.findIndex(p => p.name === projName) : -1;
    const projId = idx >= 0 ? String(state.projects[idx].id) : null;
    if (!projId) { showToast('Tidak dapat menemukan ID proyek'); return; }

    const overlay = document.createElement('div');
    overlay.id = 'member-progress-overlay';
    overlay.className = 'milestone-form-overlay';
    overlay.innerHTML = `
        <div class="milestone-form-modal" role="dialog" style="max-width:420px">
            <div class="milestone-form-header">
                <div><h3>Update Progress</h3><p class="bar-form-subtitle">${escapeHTML(projName)}</p></div>
                <button type="button" class="save-auth-x" onclick="document.getElementById('member-progress-overlay').remove()">×</button>
            </div>
            <div class="milestone-form-body">
                <label style="display:block;margin-bottom:14px">
                    <span style="font-size:13px;font-weight:600;color:#1a2332;display:block;margin-bottom:6px">Progress Aktual (%)</span>
                    <input type="range" id="mpm-progress" min="0" max="100" value="${currentProgress}" style="width:100%;accent-color:#00a99d" oninput="document.getElementById('mpm-pval').textContent=this.value+'%'">
                    <span id="mpm-pval" style="font-size:14px;font-weight:700;color:#00a99d">${currentProgress}%</span>
                </label>
                <label style="display:block;margin-bottom:14px">
                    <span style="font-size:13px;font-weight:600;color:#1a2332;display:block;margin-bottom:6px">Status TLM</span>
                    <select id="mpm-rag" style="width:100%;padding:8px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:14px">
                        <option value="bg-blue" ${currentRag==='bg-blue'?'selected':''}>🔵 Done</option>
                        <option value="bg-green" ${currentRag==='bg-green'?'selected':''}>🟢 On Track</option>
                        <option value="bg-yellow" ${currentRag==='bg-yellow'?'selected':''}>🟡 Slightly Delay</option>
                        <option value="bg-red" ${currentRag==='bg-red'?'selected':''}>🔴 Delay</option>
                        <option value="bg-grey" ${currentRag==='bg-grey'?'selected':''}>⚪ Belum Mulai</option>
                    </select>
                </label>
                <label style="display:block">
                    <span style="font-size:13px;font-weight:600;color:#1a2332;display:block;margin-bottom:6px">Catatan / Kendala</span>
                    <textarea id="mpm-notes" rows="3" style="width:100%;padding:8px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:14px;font-family:inherit;resize:vertical" placeholder="Update status, kendala, rencana...">${escapeHTML(currentStatus)}</textarea>
                </label>
            </div>
            <div class="milestone-form-footer" style="gap:10px">
                <button type="button" class="milestone-btn-secondary" onclick="document.getElementById('member-progress-overlay').remove()">Batal</button>
                <button type="button" class="milestone-btn-primary" onclick="submitMemberProgress('${escapeAttr(projId)}')">Simpan Progress</button>
            </div>
        </div>`;
    document.body.appendChild(overlay);
}

async function submitMemberProgress(projId) {
    const progress = parseInt(document.getElementById('mpm-progress').value);
    const rag = document.getElementById('mpm-rag').value;
    const notes = document.getElementById('mpm-notes').value.trim();

    const btn = document.querySelector('#member-progress-overlay .milestone-btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Menyimpan...'; }

    try {
        const res = await Auth.apiFetch('/api/state/project/' + projId, {
            method: 'PATCH',
            body: JSON.stringify({ actual_progress: progress, rag, notes })
        });
        if (!res || !res.ok) {
            const err = await res?.json();
            throw new Error(err?.error || 'Gagal menyimpan');
        }
        document.getElementById('member-progress-overlay').remove();
        showToast('Progress berhasil diperbarui');
        await reloadFromDatabase();
    } catch (e) {
        alert('Error: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Simpan Progress'; }
    }
}

async function loadMyAssignments() {
    try {
        const res = await Auth.apiFetch('/api/my-assignments');
        if (res && res.ok) {
            _myAssignments = await res.json();
        }
    } catch (e) { /* ignore */ }
    const user = Auth.getUser();
    _currentUserRole = user ? user.role : 'member';
    // Auto-lock dept filter for manager/member based on their dept
    if (user && (user.role === 'manager' || user.role === 'member') && user.dept_name) {
        _deptFilter = user.dept_name;
        const sel = document.getElementById('dept-filter');
        if (sel) {
            let found = false;
            for (const opt of sel.options) {
                if (opt.value === user.dept_name) { sel.value = user.dept_name; found = true; break; }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = user.dept_name; opt.textContent = user.dept_name;
                sel.appendChild(opt); sel.value = user.dept_name;
            }
        }
    }
}

window.onload=async function(){
    try{
        await loadMyAssignments();
        await reloadFromDatabase();
    }
    catch(e){ updateSummaryCards(); updatePagination(); }
    syncFrozenColumns();
};
window.onresize=function(){
    if(currentView==='gantt') { updateDateLine(); syncFrozenColumns(); }
    else if(currentView==='pic' && typeof renderPicChart==='function') { renderPicChart(typeof _lastPicList!=='undefined'?(_lastPicList||[]):[]); }
};
