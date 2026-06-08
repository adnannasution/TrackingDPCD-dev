// ===================================================================
// DPCD MONITORING — EXPORT: PDF print report + PPTX
// ===================================================================

// Collect all project rows into plain objects for reports.
function collectProjects(){
    const out=[];
    document.querySelectorAll('.gantt-row').forEach(row=>{
        const s=readRowStats(row);
        if(!s.name) return;
        const statusCell=row.children[row.children.length-1];
        const status=statusCell?statusCell.innerText.trim():'';
        out.push({ ...s, status, notes:row.getAttribute('data-notes')||'' });
    });
    return out;
}
const RAG_META={
    blue:{label:'Done',color:'2563eb'}, green:{label:'On Track',color:'15a34a'},
    yellow:{label:'Slightly Delay',color:'d9890b'}, red:{label:'Delay',color:'dc2626'}, grey:{label:'Belum Mulai',color:'94a3b8'}
};
function tally(projects){
    const t={total:0,done:0,ontrack:0,warning:0,critical:0,idle:0};
    projects.forEach(p=>{ if(p.rag==='grey'){t.idle++;return;} t.total++;
        if(p.rag==='blue')t.done++; else if(p.rag==='green')t.ontrack++; else if(p.rag==='yellow')t.warning++; else if(p.rag==='red')t.critical++; });
    t.health=t.total===0?0:Math.round((t.done*100+t.ontrack*80+t.warning*50+t.critical*20)/t.total);
    return t;
}

// ===================================================================
// PDF — build a clean landscape report then print
// ===================================================================
function exportPDF(){
    const projects=collectProjects();
    const t=tally(projects);
    const today=new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    const cutoff=document.getElementById('cfg-cutoff').value;
    const rep=document.getElementById('print-report');
    const sourceLabel=(document.getElementById('ds-path-display')||{}).textContent||'PostgreSQL Railway';
    const rowsHTML=projects.map((p,i)=>{
        const meta=RAG_META[p.rag]||RAG_META.grey;
        const dev=p.actPct-p.planPct;
        const devTxt=dev>0?'+'+dev:String(dev);
        return `<tr>
            <td style="text-align:center;color:#8c97a8;">${i+1}</td>
            <td><b>${escapeHTML(p.name)}</b></td>
            <td>${escapeHTML(p.pic)||'—'}</td>
            <td style="text-align:center;">${escapeHTML(p.category)||'—'}</td>
            <td style="text-align:center;">${p.planPct}%</td>
            <td style="text-align:center;"><b>${p.actPct}%</b></td>
            <td style="text-align:center;color:${dev<0?'#dc2626':'#15a34a'};">${devTxt}%</td>
            <td style="text-align:center;"><span style="display:inline-block;padding:1px 7px;border-radius:9px;font-size:8pt;font-weight:700;color:#fff;background:#${meta.color};">${meta.label}</span></td>
            <td style="font-size:8.5pt;color:#333;">${escapeHTML((p.status||'').replace(/\n+/g,' ')).substring(0,220)}${p.blockers&&p.blockers.length?'<div style="margin-top:3px;color:#b91c1c;font-weight:600;">⛔ '+escapeHTML(p.blockers.join(' · '))+'</div>':''}</td>
            <td style="font-size:8.5pt;color:#333;">${p.nextAction?'<b>'+escapeHTML(p.nextAction)+'</b>':'—'}${p.dueDate?'<br><span style="color:'+(isOverdue(p.dueDate,p.rag)?'#dc2626':'#5a6678')+';">Due: '+escapeHTML(formatDue(p.dueDate))+(isOverdue(p.dueDate,p.rag)?' (OVERDUE)':'')+'</span>':''}</td>
        </tr>`;
    }).join('');
    rep.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0E2444;padding-bottom:8px;margin-bottom:12px;">
            <div><div style="font-size:17pt;font-weight:800;color:#0A1A30;">Project Monitoring Digitalisasi DPCD</div>
            <div style="font-size:9.5pt;color:#5a6678;margin-top:2px;">Laporan dibuat ${today}${cutoff?' · Cut-off '+new Date(cutoff).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}):''}</div></div>
            <div style="text-align:right;"><div style="font-weight:800;letter-spacing:1px;color:#0A1A30;">PERTAMINA PATRA NIAGA</div><div style="font-size:7pt;color:#c0392b;font-weight:700;letter-spacing:0.5px;">REFINERY RELIABILITY &amp; ENGINEERING</div></div>
        </div>
        <div style="display:flex;gap:10px;margin-bottom:14px;">
            ${kpiBox('Total Aktif',t.total,'#0E2444')}
            ${kpiBox('Done',t.done,'#2563eb')}
            ${kpiBox('On Track',t.ontrack,'#15a34a')}
            ${kpiBox('Slightly Delay',t.warning,'#d9890b')}
            ${kpiBox('Delay',t.critical,'#dc2626')}
            ${kpiBox('Health Score',t.health,'#0f766e')}
        </div>
        ${blockerSummaryHTML(projects)}
        <table style="width:100%;border-collapse:collapse;font-size:9pt;">
            <thead><tr style="background:#0E2444;color:#fff;">
                <th style="padding:6px 5px;width:22px;">#</th><th style="padding:6px 8px;text-align:left;">Project</th>
                <th style="padding:6px 8px;text-align:left;width:90px;">PIC</th><th style="padding:6px 8px;width:80px;">Kategori</th>
                <th style="padding:6px 5px;width:42px;">Plan</th><th style="padding:6px 5px;width:42px;">Act</th>
                <th style="padding:6px 5px;width:42px;">Dev</th><th style="padding:6px 5px;width:78px;">TLM</th>
                <th style="padding:6px 8px;text-align:left;">Update Terkini</th>
                <th style="padding:6px 8px;text-align:left;width:150px;">Next Action & Due</th>
            </tr></thead>
            <tbody>${rowsHTML}</tbody>
        </table>
        <div style="margin-top:10px;font-size:8pt;color:#8c97a8;text-align:right;">Sumber: ${escapeHTML(sourceLabel)} · Total ${projects.length} project</div>`;
    // zebra + borders
    rep.querySelectorAll('tbody tr').forEach((tr,i)=>{ tr.style.background=i%2?'#f7f9fc':'#fff'; tr.querySelectorAll('td').forEach(td=>{td.style.padding='5px 8px';td.style.borderBottom='1px solid #e2e7ef';td.style.verticalAlign='top';}); });
    window.print();
}
function kpiBox(label,val,color){
    return `<div style="flex:1;border:1px solid #e2e7ef;border-top:3px solid ${color};border-radius:6px;padding:8px 10px;">
        <div style="font-size:8pt;color:#5a6678;font-weight:600;text-transform:uppercase;letter-spacing:0.4px;">${label}</div>
        <div style="font-size:18pt;font-weight:800;color:${color};line-height:1.1;">${val}</div></div>`;
}
// Blok ringkas Top Blocker (Pareto) untuk laporan PDF: bottleneck utama + owner + aksi.
function blockerSummaryHTML(projects){
    if(typeof aggregateBlockers!=='function') return '';
    const agg=aggregateBlockers(projects);
    const top=agg.items.slice(0,6);
    if(!top.length) return '';
    const rows=top.map((e,i)=>`<tr style="${i%2?'background:#fbf3f3;':'background:#fff;'}">
        <td style="padding:4px 8px;border-bottom:1px solid #f0d9d9;"><b>${escapeHTML(e.category)}</b></td>
        <td style="padding:4px 6px;text-align:center;border-bottom:1px solid #f0d9d9;">${e.count}</td>
        <td style="padding:4px 6px;text-align:center;border-bottom:1px solid #f0d9d9;color:#b91c1c;font-weight:700;">${e.sharePct}%</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0d9d9;">${escapeHTML(e.owner)}</td>
        <td style="padding:4px 8px;border-bottom:1px solid #f0d9d9;color:#444;">${escapeHTML(e.action)}</td></tr>`).join('');
    return `<div style="border:1px solid #f0d9d9;border-left:3px solid #dc2626;border-radius:6px;padding:8px 10px;margin-bottom:14px;background:#fffafa;">
        <div style="font-size:9pt;font-weight:800;color:#b91c1c;margin-bottom:5px;">⛔ TOP BLOCKER (PARETO) — Bottleneck Utama & Penanggung Jawab</div>
        <table style="width:100%;border-collapse:collapse;font-size:8.5pt;">
            <thead><tr style="color:#7a2020;text-align:left;"><th style="padding:3px 8px;">Kategori</th><th style="padding:3px 6px;text-align:center;">Project</th><th style="padding:3px 6px;text-align:center;">Impact</th><th style="padding:3px 8px;">Owner</th><th style="padding:3px 8px;">Rekomendasi Aksi</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
}

// ===================================================================
// PPTX — lazy-load PptxGenJS, build a deck
// ===================================================================
function loadPptxLib(){
    return new Promise((res,rej)=>{
        if(window.PptxGenJS){res();return;}
        const s=document.createElement('script');
        s.src='https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
        s.onload=()=>res(); s.onerror=()=>rej(new Error('Gagal memuat library PPTX'));
        document.head.appendChild(s);
    });
}

async function exportPPTX(){
    showToast('⏳ Menyiapkan PPTX...');
    try{ await loadPptxLib(); }catch(e){ alert(e.message+'\nPastikan ada koneksi internet.'); return; }
    const projects=collectProjects();
    const t=tally(projects);
    const today=new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    const cutoff=document.getElementById('cfg-cutoff').value;

    const NAVY='0A1A30', NAVY2='0E2444', INK='172033', INK2='5A6678', LINE='E2E7EF';
    const pptx=new PptxGenJS();
    pptx.defineLayout({name:'W',width:13.333,height:7.5});
    pptx.layout='W';
    pptx.theme={ headFontFace:'Arial', bodyFontFace:'Arial' };

    // ---- Slide 1: Title ----
    let s=pptx.addSlide(); s.background={color:NAVY};
    s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:0.18,fill:{color:'2F6FED'}});
    s.addText('PROJECT MONITORING',{x:0.8,y:2.2,w:11.7,h:0.5,fontSize:18,color:'7FA8E6',bold:true,charSpacing:3});
    s.addText('Digitalisasi DPCD',{x:0.78,y:2.65,w:11.7,h:1.0,fontSize:46,color:'FFFFFF',bold:true});
    s.addText('Refinery Reliability & Engineering',{x:0.8,y:3.7,w:11.7,h:0.5,fontSize:16,color:'A9C0DB'});
    s.addText([
        {text:'Laporan per ',options:{color:'8FA3BD'}},
        {text:today,options:{color:'FFFFFF',bold:true}},
        ...(cutoff?[{text:'   ·   Cut-off ',options:{color:'8FA3BD'}},{text:new Date(cutoff).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'}),options:{color:'FFFFFF',bold:true}}]:[])
    ],{x:0.8,y:5.6,w:11.7,h:0.4,fontSize:13});
    s.addText('PERTAMINA PATRA NIAGA  ·  REFINERY RELIABILITY & ENGINEERING',{x:0.8,y:6.7,w:11.7,h:0.3,fontSize:10,color:'5E7A9E',charSpacing:1});

    // ---- Slide 2: Executive overview ----
    s=pptx.addSlide(); s.background={color:'F4F6F9'};
    slideHeader(pptx,s,'Executive Overview',today,NAVY2,INK2);
    const cards=[
        {l:'Total Aktif',v:t.total,c:NAVY2},{l:'Done',v:t.done,c:'2563EB'},{l:'On Track',v:t.ontrack,c:'15A34A'},
        {l:'Slightly Delay',v:t.warning,c:'D9890B'},{l:'Delay',v:t.critical,c:'DC2626'}
    ];
    const cw=2.28, gap=0.18, startX=0.55;
    cards.forEach((c,i)=>{
        const x=startX+i*(cw+gap);
        s.addShape(pptx.ShapeType.roundRect,{x,y:1.4,w:cw,h:1.5,rectRadius:0.08,fill:{color:'FFFFFF'},line:{color:LINE,width:1}});
        s.addShape(pptx.ShapeType.rect,{x,y:1.4,w:cw,h:0.08,fill:{color:c.c}});
        s.addText(String(c.v),{x,y:1.62,w:cw,h:0.85,fontSize:40,bold:true,color:c.c,align:'center'});
        s.addText(c.l,{x,y:2.5,w:cw,h:0.3,fontSize:11,color:INK2,align:'center',bold:true});
    });
    // health score bar
    s.addShape(pptx.ShapeType.roundRect,{x:0.55,y:3.2,w:6.1,h:2.0,rectRadius:0.08,fill:{color:'FFFFFF'},line:{color:LINE,width:1}});
    s.addText('PORTFOLIO HEALTH SCORE',{x:0.8,y:3.45,w:5.6,h:0.3,fontSize:11,bold:true,color:INK2,charSpacing:1});
    const hColor=t.health>=80?'15A34A':t.health>=60?'D9890B':'DC2626';
    const hLabel=t.health>=80?'Excellent':t.health>=60?'Good':t.health>=40?'Fair':'Poor';
    s.addText([{text:String(t.health),options:{fontSize:54,bold:true,color:hColor}},{text:' /100',options:{fontSize:20,color:INK2}}],{x:0.8,y:3.8,w:5.6,h:1.0,align:'left'});
    s.addText(hLabel,{x:0.8,y:4.75,w:5.6,h:0.3,fontSize:14,bold:true,color:hColor});
    s.addShape(pptx.ShapeType.roundRect,{x:3.4,y:4.78,w:3.0,h:0.28,rectRadius:0.14,fill:{color:'EEF1F6'}});
    s.addShape(pptx.ShapeType.roundRect,{x:3.4,y:4.78,w:Math.max(0.3,3.0*t.health/100),h:0.28,rectRadius:0.14,fill:{color:hColor}});
    // narrative
    s.addShape(pptx.ShapeType.roundRect,{x:6.85,y:3.2,w:5.93,h:2.0,rectRadius:0.08,fill:{color:'FFFFFF'},line:{color:LINE,width:1}});
    s.addText('RINGKASAN',{x:7.1,y:3.45,w:5.4,h:0.3,fontSize:11,bold:true,color:INK2,charSpacing:1});
    const narr=`Dari ${t.total} active project: ${t.done} selesai, ${t.ontrack} on track, ${t.warning} slightly delay, ${t.critical} delay.`+
        (t.critical>0?` Terdapat ${t.critical} project berstatus delay (keterlambatan ≥25%) yang memerlukan eskalasi.`:'')+
        (t.idle>0?` ${t.idle} project belum dimulai.`:'');
    s.addText(narr,{x:7.1,y:3.8,w:5.43,h:1.3,fontSize:13,color:INK,lineSpacingMultiple:1.2,valign:'top'});
    // distribution bar
    s.addShape(pptx.ShapeType.roundRect,{x:0.55,y:5.45,w:12.23,h:1.35,rectRadius:0.08,fill:{color:'FFFFFF'},line:{color:LINE,width:1}});
    s.addText('DISTRIBUSI STATUS',{x:0.8,y:5.62,w:5,h:0.3,fontSize:11,bold:true,color:INK2,charSpacing:1});
    const segs=[{v:t.done,c:'2563EB'},{v:t.ontrack,c:'15A34A'},{v:t.warning,c:'D9890B'},{v:t.critical,c:'DC2626'}];
    const totSeg=segs.reduce((a,b)=>a+b.v,0)||1; let sx=0.8; const totalW=11.9;
    segs.forEach(seg=>{ if(seg.v===0)return; const w=totalW*seg.v/totSeg; s.addShape(pptx.ShapeType.rect,{x:sx,y:6.05,w,h:0.42,fill:{color:seg.c}}); s.addText(String(seg.v),{x:sx,y:6.05,w,h:0.42,fontSize:12,bold:true,color:'FFFFFF',align:'center',valign:'middle'}); sx+=w; });

    // ---- Slide: Blocker Analysis (Pareto + owner/aksi) ----
    if(typeof aggregateBlockers==='function'){
        const blkAgg=aggregateBlockers(projects);
        const blkTop=blkAgg.items.slice(0,10);
        s=pptx.addSlide(); s.background={color:'F4F6F9'};
        slideHeader(pptx,s,'Blocker Analysis',today,NAVY2,INK2);
        if(!blkTop.length){
            s.addText('Tidak ada blocker tercatat pada project aktif.',{x:0.55,y:1.6,w:12.23,h:0.5,fontSize:13,color:INK2,italic:true});
        } else {
            s.addText('Bottleneck utama diurut berdasarkan dampak keterlambatan (impact). Tindak lanjuti kategori teratas bersama owner-nya.',{x:0.55,y:1.25,w:12.23,h:0.3,fontSize:11,color:INK2});
            const bHead=['Kategori','Project','At-Risk','Impact','Owner','Rekomendasi Aksi'].map(h=>({text:h,options:{bold:true,color:'FFFFFF',fill:{color:NAVY2},align:(h==='Kategori'||h==='Owner'||h==='Rekomendasi Aksi')?'left':'center',valign:'middle',fontSize:11}}));
            const bBody=blkTop.map(e=>[
                {text:e.category,options:{align:'left',color:INK,bold:true}},
                {text:String(e.count),options:{align:'center',color:INK2}},
                {text:String(e.riskCount),options:{align:'center',color:INK2}},
                {text:e.sharePct+'%',options:{align:'center',color:'DC2626',bold:true}},
                {text:e.owner,options:{align:'left',color:INK2}},
                {text:e.action,options:{align:'left',color:INK2,fontSize:9}}
            ]);
            s.addTable([bHead,...bBody],{
                x:0.55,y:1.65,w:12.23,colW:[2.55,0.95,1.0,0.95,2.4,4.38],
                margin:0.06, border:{type:'solid',color:LINE,pt:0.5}, fontSize:10, fontFace:'Arial',
                rowH:0.46, valign:'middle', autoPage:false, fill:{color:'FFFFFF'}, color:INK, fit:'shrink'
            });
        }
    }

    // ---- Slides 3+: Project table (chunked) ----
    const perSlide=12;
    for(let i=0;i<projects.length;i+=perSlide){
        const chunk=projects.slice(i,i+perSlide);
        s=pptx.addSlide(); s.background={color:'F4F6F9'};
        slideHeader(pptx,s,'Project Status'+(projects.length>perSlide?` (${Math.floor(i/perSlide)+1}/${Math.ceil(projects.length/perSlide)})`:''),today,NAVY2,INK2);
        const head=['#','Project','PIC','Plan','Act','Dev','TLM','Update Terkini'].map(h=>({text:h,options:{bold:true,color:'FFFFFF',fill:{color:NAVY2},align:(h==='Project'||h==='PIC'||h==='Update Terkini')?'left':'center',valign:'middle',fontSize:11}}));
        const body=chunk.map((p,j)=>{
            const meta=RAG_META[p.rag]||RAG_META.grey; const dev=p.actPct-p.planPct;
            return [
                {text:String(i+j+1),options:{align:'center',color:INK2}},
                {text:p.name,options:{align:'left',color:INK,bold:true}},
                {text:p.pic||'—',options:{align:'left',color:INK2}},
                {text:p.planPct+'%',options:{align:'center',color:INK2}},
                {text:p.actPct+'%',options:{align:'center',color:INK,bold:true}},
                {text:(dev>0?'+':'')+dev+'%',options:{align:'center',color:dev<0?'DC2626':'15A34A',bold:true}},
                {text:meta.label,options:{align:'center',color:'FFFFFF',bold:true,fill:{color:meta.color},fontSize:9}},
                {text:(p.status||'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().substring(0,160)||'—',options:{align:'left',color:INK2,fontSize:8}}
            ];
        });
        const tableX=0.55, tableW=12.05;
        s.addTable([head,...body],{
            x:tableX,y:1.35,w:tableW,colW:[0.38,3.40,1.55,0.70,0.70,0.72,1.40,3.20],
            margin:0.06,
            border:{type:'solid',color:LINE,pt:0.5}, fontSize:9.4, fontFace:'Arial',
            rowH:0.42, valign:'middle', autoPage:false,
            fill:{color:'FFFFFF'}, color:INK,
            fit:'shrink'
        });
    }

    // ---- Risk slides: Critical (red) then Watch List (yellow), paginated ----
    function addRiskSlides(ragKey, baseTitle){
        const list=projects.filter(p=>p.rag===ragKey).map(p=>({...p,dev:p.planPct-p.actPct})).sort((a,b)=>b.dev-a.dev);
        const perSlide=9;
        const pages=Math.max(1,Math.ceil(list.length/perSlide));
        for(let pg=0; pg<pages; pg++){
            const chunk=list.slice(pg*perSlide,(pg+1)*perSlide);
            s=pptx.addSlide(); s.background={color:'F4F6F9'};
            slideHeader(pptx,s,baseTitle+(pages>1?(' ('+(pg+1)+'/'+pages+')'):''),today,NAVY2,INK2);
            if(chunk.length===0){
                s.addText('Tidak ada project pada kategori ini.',{x:0.55,y:1.6,w:12.23,h:0.5,fontSize:13,color:INK2,italic:true});
                continue;
            }
            let y=1.45;
            chunk.forEach(r=>{
                const meta=RAG_META[r.rag];
                s.addShape(pptx.ShapeType.roundRect,{x:0.55,y,w:12.23,h:0.56,rectRadius:0.05,fill:{color:'FFFFFF'},line:{color:LINE,width:1}});
                s.addShape(pptx.ShapeType.rect,{x:0.55,y,w:0.09,h:0.56,fill:{color:meta.color}});
                const _due=r.dueDate?('Due '+formatDue(r.dueDate)+(isOverdue(r.dueDate,r.rag)?' (OVERDUE)':'')):'';
                const _act=r.nextAction?('Aksi: '+r.nextAction):'';
                s.addText([{text:r.name,options:{fontSize:12,color:INK,bold:true}},...((_act||_due)?[{text:'  '+[_act,_due].filter(Boolean).join('  ·  '),options:{fontSize:9,color:(isOverdue(r.dueDate,r.rag)?'DC2626':INK2),bold:false}}]:[])],{x:0.8,y,w:8.2,h:0.56,valign:'middle'});
                s.addText('Plan '+r.planPct+'% · Act '+r.actPct+'%',{x:9.0,y,w:2.3,h:0.56,fontSize:11,color:INK2,valign:'middle',align:'right'});
                s.addText('-'+r.dev+'%',{x:11.4,y,w:1.35,h:0.56,fontSize:13,color:meta.color,bold:true,valign:'middle',align:'center'});
                y+=0.66;
            });
        }
    }
    addRiskSlides('red','Critical — Delay');
    addRiskSlides('yellow','Watch List — Slightly Delay');

    const fname='Monitoring_DPCD_'+new Date().toISOString().slice(0,10)+'.pptx';
    pptx.writeFile({fileName:fname}).then(()=>showToast('📊 PPTX berhasil diexport: '+fname)).catch(e=>alert('Gagal export PPTX: '+e.message));
}

function slideHeader(pptx,s,title,today,navy,ink2){
    s.addShape(pptx.ShapeType.rect,{x:0,y:0,w:13.333,h:0.12,fill:{color:'2F6FED'}});
    s.addText(title,{x:0.55,y:0.32,w:9,h:0.6,fontSize:24,bold:true,color:navy});
    s.addText([{text:'Monitoring Digitalisasi DPCD  ·  ',options:{color:ink2}},{text:today,options:{color:ink2,bold:true}}],{x:0.55,y:0.92,w:9,h:0.3,fontSize:11});
    s.addText('PERTAMINA PATRA NIAGA',{x:8.3,y:0.4,w:4.45,h:0.4,fontSize:13,bold:true,color:navy,align:'right',charSpacing:1});
    s.addText('REFINERY RELIABILITY & ENGINEERING',{x:8.3,y:0.78,w:4.45,h:0.25,fontSize:7,color:'C0392B',align:'right',bold:true,charSpacing:0.5});
}
