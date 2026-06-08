// ===================================================================
// DPCD MONITORING — MODALS: history, reminder, executive, detail
// ===================================================================

// ===================================================================
// VERSION HISTORY
// ===================================================================
function showVersionHistory(){
    const history=getHistory();
    const overlay=document.createElement('div'); overlay.className='history-overlay'; overlay.id='history-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
    let bodyHTML='';
    if(history.length===0){bodyHTML='<div class="history-empty"><span>🗂️</span>Belum ada history.<br>Klik <b>"Simpan DB"</b> untuk mulai merekam snapshot.</div>';}
    else{
        history.forEach((snap,idx)=>{
            const prev=idx<history.length-1?history[idx+1]:null;
            let doneC=0,onC=0,warnC=0,critC=0;
            snap.projects.forEach(p=>{if(p.r==='blue')doneC++;else if(p.r==='green')onC++;else if(p.r==='yellow')warnC++;else if(p.r==='red')critC++;});
            let tableRows='';
            snap.projects.forEach(proj=>{
                let trend='',trendClass='ht-new';
                if(prev){const pp=prev.projects.find(p=>p.n===proj.n);if(pp){const d=proj.a-pp.a;if(d>0){trend='▲ +'+d+'%';trendClass='ht-up';}else if(d<0){trend='▼ '+d+'%';trendClass='ht-down';}else{trend='• Same';trendClass='ht-same';}}else{trend='★ New';trendClass='ht-new';}}else{trend='-';trendClass='ht-same';}
                const ragColors={blue:'#2563eb',green:'#15a34a',yellow:'#d9890b',red:'#dc2626',grey:'#94a3b8'};
                tableRows+=`<tr><td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHTML(proj.n)}</td><td class="num">${proj.p}%</td><td class="num"><b>${proj.a}%</b></td><td><span class="ht-rag" style="background:${ragColors[proj.r]}"></span></td><td><span class="ht-trend ${trendClass}">${trend}</span></td></tr>`;
            });
            bodyHTML+=`<div class="history-snapshot"><div class="history-snap-header" onclick="this.nextElementSibling.classList.toggle('open')"><div class="history-snap-date">${idx===0?'🟢 ':''}${snap.d}${idx===0?' (Terbaru)':''}</div><div class="history-snap-summary">${doneC?`<span class="hs-badge hs-done">${doneC} Done</span>`:''}${onC?`<span class="hs-badge hs-ontrack">${onC} On Track</span>`:''}${warnC?`<span class="hs-badge hs-warning">${warnC} Slightly Delay</span>`:''}${critC?`<span class="hs-badge hs-critical">${critC} Delay</span>`:''}<span style="color:var(--ink-3);font-size:0.72rem;">${snap.projects.length} project</span></div></div><div class="history-snap-body${idx===0?' open':''}"><table class="history-table"><thead><tr><th>Project</th><th>Plan</th><th>Actual</th><th>TLM</th><th>Trend</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>`;
        });
    }
    overlay.innerHTML=`<div class="history-modal"><div class="history-header"><h2>Version History / Changelog</h2><button class="history-btn-x" onclick="document.getElementById('history-overlay').remove()">&times;</button></div><div class="history-body">${bodyHTML}</div><div class="history-footer"><div class="history-count">${history.length} snapshot tersimpan</div><div style="display:flex;gap:8px;">${history.length>0?`<button class="history-btn-clear" onclick="if(confirm('Hapus semua history?')){setHistory([]);document.getElementById('history-overlay').remove();showVersionHistory();}">Hapus Semua</button>`:''}<button class="history-btn-close" onclick="document.getElementById('history-overlay').remove()">Tutup</button></div></div></div>`;
    document.body.appendChild(overlay);
}

// ===================================================================
// WEEKLY REMINDER
// ===================================================================
function showWeeklyReminder(){
    const rows=document.querySelectorAll('.gantt-row'); const redItems=[]; const yellowItems=[];
    const dateStr=new Date().toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
    rows.forEach(row=>{
        const tl=row.querySelector('.traffic-light'); if(!tl)return;
        const isRed=tl.classList.contains('bg-red'); const isYellow=tl.classList.contains('bg-yellow');
        if(!isRed&&!isYellow)return;
        const name=typeof getActivityNameFromRow==='function'?(getActivityNameFromRow(row)||'(No name)'):'(No name)';
        let planPct='-'; const planVal=getPlanTargetFromRow(row); if(planVal)planPct=planVal+'%';
        let actPct='-'; const actVal=getActualProgressFromRow(row); if(actVal||actVal===0)actPct=actVal+'%';
        const statusCell=row.children[row.children.length-1];
        const statusText=statusCell?statusCell.innerText.trim().substring(0,200):'';
        const _sClean=statusText.replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();const statusWA=_sClean.substring(0,140)+(_sClean.length>140?'...':'');
        const nextAction=(row.getAttribute('data-next-action')||'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim();
        const dueRaw=row.getAttribute('data-due')||'';
        const ragKey=isRed?'bg-red':'bg-yellow';
        const dueTxt=dueRaw?(formatDue(dueRaw)+((typeof isOverdue==='function'&&isOverdue(dueRaw,ragKey))?' (OVERDUE)':'')):'';
        const blockers=(typeof parseBlockers==='function')?parseBlockers(row.getAttribute('data-blockers')):[];
        const item={name,planPct,actPct,statusText,statusWA,nextAction,dueTxt,blockers};
        if(isRed)redItems.push(item); else yellowItems.push(item);
    });
    const overlay=document.createElement('div'); overlay.className='reminder-overlay'; overlay.id='weekly-reminder';
    overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
    let bodyHTML=''; let waText='Team DPCD ysh,\nBerikut ini reminder monitoring project tracking per '+dateStr+' sbb :\n';
    if(redItems.length===0&&yellowItems.length===0){bodyHTML='<div class="reminder-empty">✅ Semua project on track. Tidak ada yang perlu perhatian khusus minggu ini.</div>';waText+='\n✅ Semua project on track.\n';}
    else{
        let itemNo=1;
        if(redItems.length>0){
            bodyHTML+=`<div class="reminder-section-title section-red">Delay (${redItems.length} project)</div>`;
            waText+=`\n🔴 *Delay (${redItems.length} project)*\n`;
            redItems.forEach(it=>{bodyHTML+=`<div class="reminder-item" style="border-left-color:var(--crit)"><div class="reminder-item-name">${escapeHTML(it.name)}</div><div class="reminder-item-metrics"><span>Plan Target: <b>${it.planPct}</b></span><span>Actual: <b>${it.actPct}</b></span></div>${it.statusText?`<div class="reminder-item-status">${escapeHTML(it.statusText)}</div>`:''}${it.blockers&&it.blockers.length?`<div class="reminder-item-blocker">⛔ <b>Blocker:</b> ${it.blockers.map(b=>escapeHTML(b)).join(' · ')}</div>`:''}${it.nextAction?`<div class="reminder-item-action">\u{1F3AF} <b>Aksi:</b> ${escapeHTML(it.nextAction)}</div>`:''}${it.dueTxt?`<div class="reminder-item-due${it.dueTxt.includes('OVERDUE')?' overdue':''}">\u{1F4C5} <b>Due:</b> ${escapeHTML(it.dueTxt)}</div>`:''}</div>`;waText+=`\n${itemNo}. *${it.name}*\n📊 Plan: ${it.planPct} | Actual: ${it.actPct}\n${it.statusWA?'📝 '+it.statusWA+'\n':''}${it.blockers&&it.blockers.length?'⛔ Blocker: '+it.blockers.join(' · ')+'\n':''}${it.nextAction?'🎯 Aksi: '+it.nextAction+'\n':''}${it.dueTxt?'📅 Due: '+it.dueTxt+'\n':''}`;itemNo++;});
        }
        if(yellowItems.length>0){
            bodyHTML+=`<div class="reminder-section-title section-yellow">Slightly Delay (${yellowItems.length} project)</div>`;
            waText+=`\n🟡 *Slightly Delay (${yellowItems.length} project)*\n`;
            yellowItems.forEach(it=>{bodyHTML+=`<div class="reminder-item" style="border-left-color:var(--warn)"><div class="reminder-item-name">${escapeHTML(it.name)}</div><div class="reminder-item-metrics"><span>Plan Target: <b>${it.planPct}</b></span><span>Actual: <b>${it.actPct}</b></span></div>${it.statusText?`<div class="reminder-item-status">${escapeHTML(it.statusText)}</div>`:''}${it.blockers&&it.blockers.length?`<div class="reminder-item-blocker">⛔ <b>Blocker:</b> ${it.blockers.map(b=>escapeHTML(b)).join(' · ')}</div>`:''}${it.nextAction?`<div class="reminder-item-action">\u{1F3AF} <b>Aksi:</b> ${escapeHTML(it.nextAction)}</div>`:''}${it.dueTxt?`<div class="reminder-item-due${it.dueTxt.includes('OVERDUE')?' overdue':''}">\u{1F4C5} <b>Due:</b> ${escapeHTML(it.dueTxt)}</div>`:''}</div>`;waText+=`\n${itemNo}. *${it.name}*\n📊 Plan: ${it.planPct} | Actual: ${it.actPct}\n${it.statusWA?'📝 '+it.statusWA+'\n':''}${it.blockers&&it.blockers.length?'⛔ Blocker: '+it.blockers.join(' · ')+'\n':''}${it.nextAction?'🎯 Aksi: '+it.nextAction+'\n':''}${it.dueTxt?'📅 Due: '+it.dueTxt+'\n':''}`;itemNo++;});
        }
    }
    // Ringkasan Top Blocker (Pareto) — bottleneck utama + owner penyelesai.
    if(typeof aggregateBlockers==='function' && typeof collectBlockerProjects==='function'){
        const agg=aggregateBlockers(collectBlockerProjects());
        const top=agg.items.slice(0,3);
        if(top.length){
            bodyHTML+=`<div class="reminder-section-title section-blocker">⛔ Top Blocker (bottleneck utama)</div>`;
            waText+=`\n⛔ *Top Blocker (bottleneck utama)*\n`;
            top.forEach((e,i)=>{
                bodyHTML+=`<div class="reminder-item reminder-blocker-item"><div class="reminder-item-name">${escapeHTML(e.category)} <span class="rbi-count">${e.count} project · impact ${e.sharePct}%</span></div><div class="reminder-item-action">👤 <b>Owner:</b> ${escapeHTML(e.owner)}</div><div class="reminder-item-action">🎯 <b>Aksi:</b> ${escapeHTML(e.action)}</div></div>`;
                waText+=`\n${i+1}. *${e.category}* (${e.count} project, impact ${e.sharePct}%)\n👤 Owner: ${e.owner}\n🎯 Aksi: ${e.action}\n`;
            });
        }
    }
    waText+='\nMohon perhatian dan tindak lanjutnya.\n\nTerima Kasih\nSalam kompak dan sehat selalu 🙏';
    window._reminderWAText=waText;
    overlay.innerHTML=`<div class="reminder-modal"><div class="reminder-header"><h2>Weekly Status Reminder</h2><button class="reminder-close" onclick="document.getElementById('weekly-reminder').remove()">&times;</button></div><div class="reminder-body"><div style="font-size:0.78rem;color:var(--ink-3);margin-bottom:10px;">${dateStr}</div>${bodyHTML}</div><div class="reminder-footer"><button class="btn-copy-wa" onclick="copyToWA()">📋 Copy ke WhatsApp</button><button class="btn-close-reminder" onclick="document.getElementById('weekly-reminder').remove()">Tutup</button></div></div>`;
    document.body.appendChild(overlay);
}
function copyToWA(){
    const text=window._reminderWAText||'';
    navigator.clipboard.writeText(text).then(()=>{const btn=document.querySelector('.btn-copy-wa');if(btn){const o=btn.innerHTML;btn.innerHTML='✅ Copied!';btn.style.backgroundColor='#178544';setTimeout(()=>{btn.innerHTML=o;btn.style.backgroundColor='#1faa54';},2000);}}).catch(()=>{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.opacity='0';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);});
}

// ===================================================================
// EXECUTIVE SUMMARY
// ===================================================================

function getRowProjectName(row){
    if(typeof getActivityNameFromRow==='function')return getActivityNameFromRow(row);
    const nameCell=row&&row.children?row.children[1]:null;
    return nameCell?nameCell.innerText.trim().split('\n').join(' '):'';
}
function getRowPlanPct(row){
    if(typeof getPlannedToDate==='function')return Math.round(getPlannedToDate(row));
    if(typeof getPlanTargetFromRow==='function')return getPlanTargetFromRow(row)||0;
    if(typeof readPlanMetrics==='function'){
        const pm=readPlanMetrics(row);
        return pm.width>0?100:0;
    }
    return 0;
}
function getRowActualPct(row){
    if(typeof readActualMetrics==='function'){
        const am=readActualMetrics(row);
        return Math.round(am.progress||0);
    }
    const v=typeof getActualProgressFromRow==='function'?getActualProgressFromRow(row):0;
    return Math.round(v||0);
}
function getRowRag(row){
    const byKey={
        grey:{color:'#94a3b8',label:'Not Started',key:'grey'},
        blue:{color:'#2563eb',label:'Done',key:'blue'},
        green:{color:'#15a34a',label:'On Track',key:'green'},
        yellow:{color:'#d9890b',label:'Slightly Delay',key:'yellow'},
        red:{color:'#dc2626',label:'Delay',key:'red'}
    };
    if(row&&typeof computeRagKey==='function'){
        const plan=typeof getRowPlanPct==='function'?getRowPlanPct(row):getPlanTargetFromRow(row);
        const act=typeof getRowActualPct==='function'?getRowActualPct(row):getActualProgressFromRow(row);
        return byKey[computeRagKey(plan,act)]||byKey.grey;
    }
    let rag=byKey.grey;
    const tl=row?row.querySelector('.traffic-light'):null;
    if(tl){
        if(tl.classList.contains('bg-blue'))rag=byKey.blue;
        else if(tl.classList.contains('bg-green'))rag=byKey.green;
        else if(tl.classList.contains('bg-yellow'))rag=byKey.yellow;
        else if(tl.classList.contains('bg-red'))rag=byKey.red;
    }
    return rag;
}

function truncateText(text,max){
    text=String(text||'').trim().replace(/\s+/g,' ');
    return text.length>max?text.slice(0,max-1)+'...':text;
}
function showExecutiveSummary(){
    const rows=Array.from(document.querySelectorAll('.gantt-row'));
    const projects=[];
    rows.forEach(row=>{
        const name=getRowProjectName(row);
        if(!name)return;
        const rag=getRowRag(row);
        const planPct=getRowPlanPct(row);
        const actPct=getRowActualPct(row);
        const statusCell=row.children[row.children.length-1];
        const status=statusCell?statusCell.innerText.trim():'';
        const active=rag.key!=='grey'||planPct>0||actPct>0;
        if(!active)return;
        projects.push({name,rag,planPct,actPct,gap:actPct-planPct,status,priority:row.getAttribute('data-priority')||'',pic:row.getAttribute('data-pic')||'',blockers:(typeof parseBlockers==='function'?parseBlockers(row.getAttribute('data-blockers')):[]),prognosa:row.getAttribute('data-prognosa')||''});
    });
    const total=projects.length;
    const done=projects.filter(p=>p.rag.key==='blue').length;
    const ontrack=projects.filter(p=>p.rag.key==='green').length;
    const warning=projects.filter(p=>p.rag.key==='yellow').length;
    const critical=projects.filter(p=>p.rag.key==='red').length;
    const atRisk=warning+critical;
    const avgActual=total?Math.round(projects.reduce((s,p)=>s+p.actPct,0)/total):0;
    const healthScore=total?Math.round(((done*1)+(ontrack*0.85)+(warning*0.45)+(critical*0.12))/total*100):0;
    const healthLabel=!total?'Belum ada project aktif':critical>0?'Perlu eskalasi':warning>0?'Perlu monitoring':'Terkendali';
    const dateStr=new Date().toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
    const risks=projects.filter(p=>p.rag.key==='yellow'||p.rag.key==='red').sort((a,b)=>{
        const rank={red:0,yellow:1,green:2,blue:3,grey:4};
        return rank[a.rag.key]-rank[b.rag.key] || a.gap-b.gap || a.name.localeCompare(b.name);
    });
    const doneProjects=projects.filter(p=>p.rag.key==='blue').slice(0,5);
    const immediate=critical>0?'Eskalasi '+critical+' project delay dan pastikan owner menutup blocker minggu ini.':warning>0?'Monitor '+warning+' project slightly delay agar tidak masuk status delay.':'Pertahankan cadence eksekusi dan dokumentasikan pembelajaran project done.';
    const narrative1=total?'Portfolio DPCD memiliki '+total+' project aktif; '+(done+ontrack)+' project berada dalam status done/on track dan '+atRisk+' project membutuhkan perhatian manajemen.':'Belum ada project aktif untuk diringkas.';
    const narrative2=total?'Rata-rata actual progress berada di '+avgActual+'%. Health score portfolio saat ini '+healthScore+'%, dikategorikan '+healthLabel.toLowerCase()+'.':'';
    const riskHTML=risks.length?risks.slice(0,6).map(p=>{
        const cls=p.rag.key==='red'?'crit':'warn';
        const gapText=p.gap<0?'Behind '+Math.abs(p.gap)+'%':p.gap>0?'Ahead '+p.gap+'%':'On target';
        const progHTML=p.prognosa?'<div class="exec-risk-prognosa">🏁 Prognosa selesai: '+escapeHTML(typeof formatDue==='function'?formatDue(p.prognosa):p.prognosa)+'</div>':'';
        const blkHTML=(p.blockers&&p.blockers.length)?'<div class="exec-risk-blockers">⛔ '+p.blockers.map(b=>escapeHTML(b)).join(' · ')+'</div>':'';
        return '<div class="exec-risk-item '+cls+'"><div class="exec-risk-name">'+escapeHTML(p.name)+'</div><div class="exec-risk-badge '+(p.rag.key==='red'?'red':'yellow')+'">'+escapeHTML(p.rag.label)+'</div><div class="exec-risk-meta">Actual '+p.actPct+'% | Plan '+p.planPct+'% | '+gapText+'</div>'+(p.status?'<div class="exec-risk-status">'+escapeHTML(truncateText(p.status,150))+'</div>':'')+blkHTML+progHTML+'</div>';
    }).join(''):'<div class="exec-empty">Tidak ada project yang membutuhkan perhatian khusus.</div>';
    // Analitik blocker pada project delay (red/yellow) — pakai util agregasi bersama (Pareto/Impact).
    const blkSource=projects.filter(p=>p.rag.key==='red'||p.rag.key==='yellow').map(p=>({name:p.name,rag:p.rag.key,planPct:p.planPct,actPct:p.actPct,blockers:p.blockers}));
    const aggEx=(typeof aggregateBlockers==='function')?aggregateBlockers(blkSource):{items:[],useImpact:false};
    const blkItems=aggEx.items;
    const maxBlk=blkItems.length?Math.max(...blkItems.map(e=>aggEx.useImpact?e.impact:e.count)):0;
    const blockerHTML=blkItems.length?blkItems.map(e=>{
        const w=maxBlk?Math.round((aggEx.useImpact?e.impact:e.count)/maxBlk*100):0;
        return '<div class="exec-blocker-item"><span class="exec-blocker-name" title="Owner: '+escapeAttr(e.owner)+' — '+escapeAttr(e.action)+'">'+escapeHTML(e.category)+'</span><div class="exec-blocker-bar"><div class="exec-blocker-fill" style="width:'+w+'%"></div></div><b class="exec-blocker-count">'+e.count+'</b></div>';
    }).join(''):'<div class="exec-empty">Tidak ada blocker tercatat pada project delay.</div>';
    const doneHTML=doneProjects.length?doneProjects.map(p=>'<div class="exec-done-item"><span class="exec-done-check">OK</span><span>'+escapeHTML(p.name)+'</span></div>').join(''):'<div class="exec-empty">Belum ada project selesai.</div>';
    const mixLegend=[['Done',done,'#6aa9ff'],['On Track',ontrack,'#5fd38a'],['Slightly Delay',warning,'#ffd43b'],['Delay',critical,'#ff7b7b']].map(x=>'<div class="exec-donut-legend-item"><span class="edl-dot" style="background:'+x[2]+'"></span><span>'+x[0]+'</span><b>'+x[1]+'</b></div>').join('');
    const overlay=document.createElement('div');overlay.className='exec-overlay';overlay.id='exec-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)overlay.remove();});
    overlay.innerHTML='<div class="exec-modal"><div class="exec-top-bar"><div><h2>Executive Summary DPCD</h2><div class="exec-date">Portfolio readout | '+dateStr+'</div></div><button class="exec-top-close" onclick="document.getElementById(\'exec-overlay\').remove()">&times;</button></div><div class="exec-body"><div class="exec-grid"><div class="exec-score-card"><div class="exec-card exec-health-card"><div class="exec-card-title">Portfolio Health</div><div class="exec-gauge-wrap"><canvas id="exec-gauge" width="320" height="190"></canvas><div class="exec-gauge-val">'+healthScore+'%</div></div><div class="exec-gauge-label">'+escapeHTML(healthLabel)+'</div><div class="exec-stats-row"><div class="exec-stat"><div class="exec-stat-val">'+total+'</div><div class="exec-stat-lbl">Aktif</div></div><div class="exec-stat"><div class="exec-stat-val">'+done+'</div><div class="exec-stat-lbl">Done</div></div><div class="exec-stat"><div class="exec-stat-val">'+ontrack+'</div><div class="exec-stat-lbl">On Track</div></div><div class="exec-stat"><div class="exec-stat-val">'+atRisk+'</div><div class="exec-stat-lbl">At Risk</div></div></div></div></div><div class="exec-right-panel"><div class="exec-card"><div class="exec-card-title">Management Focus</div><div class="exec-narrative"><p><b>'+escapeHTML(immediate)+'</b></p><p>'+escapeHTML(narrative2||'Siapkan baseline plan dan actual untuk memulai monitoring.')+'</p></div></div><div class="exec-card"><div class="exec-card-title">Project Perlu Perhatian</div><div class="exec-risk-list">'+riskHTML+'</div></div><div class="exec-card"><div class="exec-card-title">Analisis Blocker (Project Delay)</div><div class="exec-blocker-list">'+blockerHTML+'</div></div></div></div><div class="exec-bottom-grid"><div class="exec-card"><div class="exec-card-title">Executive Narrative</div><div class="exec-narrative"><p>'+escapeHTML(narrative1)+'</p><p>'+escapeHTML(narrative2||'Belum cukup data untuk menghitung health score portfolio.')+'</p><p>Prioritas rapat berikutnya: validasi blocker, owner, dan target recovery untuk item at risk.</p></div></div><div class="exec-card"><div class="exec-card-title">Portfolio Mix</div><div class="exec-donut-wrap"><canvas id="exec-donut" width="280" height="220"></canvas><div class="exec-donut-center"><div class="edc-num">'+total+'</div><div class="edc-lbl">project aktif</div></div></div><div class="exec-donut-legend">'+mixLegend+'</div></div></div><div class="exec-card exec-done-card"><div class="exec-card-title">Completed Highlights</div>'+doneHTML+'</div></div><div class="exec-footer"><button class="exec-btn-close" onclick="document.getElementById(\'exec-overlay\').remove()">Tutup</button></div></div>';
    document.body.appendChild(overlay);
    setTimeout(()=>{drawExecutiveGauge(healthScore);drawExecutiveChart(done,ontrack,warning,critical);},50);
}
function drawExecutiveGauge(score){
    const canvas=document.getElementById('exec-gauge');if(!canvas)return;
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
    const cx=canvas.width/2,cy=160,r=96,lw=18;
    ctx.lineWidth=lw;ctx.lineCap='round';
    ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,0);ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.stroke();
    const grad=ctx.createLinearGradient(50,0,270,0);grad.addColorStop(0,'#ff7b7b');grad.addColorStop(0.48,'#ffd43b');grad.addColorStop(1,'#5fd38a');
    ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,Math.PI+(Math.max(0,Math.min(100,score))/100)*Math.PI);ctx.strokeStyle=grad;ctx.stroke();
}
function drawExecutiveChart(done,ontrack,warning,critical){
    const canvas=document.getElementById('exec-donut');if(!canvas)return;
    const ctx=canvas.getContext('2d');const total=done+ontrack+warning+critical;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    const cx=canvas.width/2,cy=canvas.height/2,r=66,lw=24;
    ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=lw;ctx.stroke();
    if(!total)return;
    const parts=[{v:done,c:'#6aa9ff'},{v:ontrack,c:'#5fd38a'},{v:warning,c:'#ffd43b'},{v:critical,c:'#ff7b7b'}];
    let a=-Math.PI/2;
    parts.forEach(p=>{if(!p.v)return;const sweep=(p.v/total)*Math.PI*2;ctx.beginPath();ctx.arc(cx,cy,r,a,a+sweep-0.035);ctx.strokeStyle=p.c;ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();a+=sweep;});
}
function openProjectDetail(row){
    _detailCurrentRow=row;
    const projectName=getRowProjectName(row);
    const planPct=getRowPlanPct(row);
    const actPct=getRowActualPct(row);
    const diff=actPct-planPct;
    const diffHTML=diff>0?'<div class="detail-progress-diff diff-pos">Ahead '+Math.abs(diff)+'%</div>':diff<0?'<div class="detail-progress-diff diff-neg">Behind '+Math.abs(diff)+'%</div>':'<div class="detail-progress-diff diff-eq">= On Target</div>';
    // Tampilan view-only Plan/Actual Start-Finish — pakai tanggal ASLI (canonical),
    // bukan metrik bar yg bisa terpotong saat window digeser.
    const _can=(typeof getRowCanonical==='function')?getRowCanonical(row):{};
    const _fmtVal=(v)=> v?((typeof formatMonthYearShort==='function')?formatMonthYearShort(v):v):'–';
    const _planRng={s:_fmtVal(_can.planStart), e:_fmtVal(_can.planEnd)};
    const _actRng={s:_fmtVal(_can.actualStart), e:_fmtVal(_can.actualEnd)};
    const timelineViewHTML='<div class="detail-timeline-view">'+
        '<div class="dtv-cell"><span class="dtv-label">Plan Start</span><span class="dtv-val">'+_planRng.s+'</span></div>'+
        '<div class="dtv-cell"><span class="dtv-label">Plan Finish</span><span class="dtv-val">'+_planRng.e+'</span></div>'+
        '<div class="dtv-cell"><span class="dtv-label">Actual Start</span><span class="dtv-val">'+_actRng.s+'</span></div>'+
        '<div class="dtv-cell"><span class="dtv-label">Actual Finish</span><span class="dtv-val">'+_actRng.e+'</span></div>'+
        '</div>';
    const rag=getRowRag(row);
    const picSel=parsePicValue(row.getAttribute('data-pic')); const blockerSel=parseBlockers(row.getAttribute('data-blockers'));
    const category=row.getAttribute('data-category')||''; const priority=row.getAttribute('data-priority')||''; const notes=row.getAttribute('data-notes')||'';
    const links=(row.getAttribute('data-links')||'').split('|||').filter(Boolean);
    const nextAction=row.getAttribute('data-next-action')||''; const dueDate=row.getAttribute('data-due')||'';
    const prognosa=row.getAttribute('data-prognosa')||'';
    const md=getMasterData();
    // Pertahankan nilai tersimpan walau sudah tidak ada di master data (hindari kehilangan data)
    const catList=[''].concat(md.categories); if(category && md.categories.indexOf(category)<0) catList.push(category);
    const priList=[''].concat(md.priorities); if(priority && md.priorities.indexOf(priority)<0) priList.push(priority);
    const catOpts=catList.map(o=>'<option value="'+escapeAttr(o)+'"'+(o===category?' selected':'')+'>'+(o||'-- Pilih Kategori --')+'</option>').join('');
    const priOpts=priList.map(o=>'<option value="'+escapeAttr(o)+'"'+(o===priority?' selected':'')+'>'+(o||'-- Pilih Prioritas --')+'</option>').join('');
    const buildChecklist=(opts,selected)=>{const sel=selected.slice();selected.forEach(s=>{if(opts.indexOf(s)<0)opts=opts.concat(s);});return opts.length?opts.map(o=>'<label class="md-chk"><input type="checkbox" value="'+escapeAttr(o)+'"'+(sel.indexOf(o)>=0?' checked':'')+'><span>'+escapeHTML(o)+'</span></label>').join(''):'<span class="md-chk-empty">Belum ada data master.</span>';};
    const picChecklist=buildChecklist(md.pics.slice(),picSel);
    const blockerChecklist=buildChecklist(md.blockerCategories.slice(),blockerSel);
    const linksHTML=links.length?links.map(l=>'<div class="detail-link-row"><input type="text" class="detail-link-input" value="'+escapeHTML(l)+'" placeholder="https://..."><button class="detail-link-remove" onclick="this.parentElement.remove()">x</button></div>').join(''):'';
    const statusCell=row.children[row.children.length-1];const statusText=statusCell?statusCell.innerText.trim():'';
    const overlay=document.createElement('div'); overlay.className='detail-overlay'; overlay.id='detail-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeProjectDetail();});
    overlay.innerHTML='<div class="detail-modal"><div class="detail-header"><div class="detail-header-left"><h2>'+(escapeHTML(projectName)||'(Tanpa Nama)')+'</h2><div class="detail-status-badge"><div class="detail-status-dot" style="background:'+rag.color+';"></div>'+rag.label+'</div></div><button class="detail-close" onclick="closeProjectDetail()">&times;</button></div><div class="detail-body"><div class="detail-progress-section"><div class="detail-progress-row"><div class="detail-progress-label">Plan</div><div class="detail-progress-bar-track"><div class="detail-progress-bar-fill dt-plan-fill" style="width:'+planPct+'%;">'+planPct+'%</div></div></div><div class="detail-progress-row"><div class="detail-progress-label">Actual</div><div class="detail-progress-bar-track"><div class="detail-progress-bar-fill dt-actual-fill" style="width:'+actPct+'%;">'+actPct+'%</div></div></div>'+timelineViewHTML+diffHTML+'</div><div class="detail-section"><div class="detail-section-title">Informasi Project</div><div class="detail-field" style="grid-template-columns:1fr;"><label>PIC / Owner</label><div class="detail-checklist" id="detail-pic-list">'+picChecklist+'</div></div><div class="detail-field"><label>Kategori</label><select id="detail-category">'+catOpts+'</select></div><div class="detail-field"><label>Prioritas</label><select id="detail-priority">'+priOpts+'</select></div></div><div class="detail-section"><div class="detail-section-title">Kendala / Blocker</div><div class="detail-field" style="grid-template-columns:1fr;"><label>Kategori Blocker</label><div class="detail-checklist" id="detail-blocker-list">'+blockerChecklist+'</div></div></div><div class="detail-section"><div class="detail-section-title">Tindak Lanjut</div><div class="detail-field" style="grid-template-columns:1fr;"><label>Next Action</label><input type="text" id="detail-next-action" value="'+escapeHTML(nextAction)+'" placeholder="Aksi berikutnya..."></div><div class="detail-field"><label>Due Date</label><input type="date" id="detail-due" value="'+escapeHTML(dueDate)+'"></div><div class="detail-field"><label>Prognosa Selesai <span style="font-weight:400;color:var(--ink-3);">(estimasi selesai utk status delay)</span></label><input type="date" id="detail-prognosa" value="'+escapeHTML(prognosa)+'"></div></div><div class="detail-section"><div class="detail-section-title">Links / Referensi</div><div class="detail-links-list" id="detail-links-list">'+linksHTML+'</div><button class="btn-add-link" onclick="addDetailLink()">+ Tambah Link</button></div><div class="detail-section"><div class="detail-section-title">Catatan / Minutes Meeting</div><div class="detail-field" style="grid-template-columns:1fr;"><textarea id="detail-notes" placeholder="Tulis catatan, minutes meeting, atau informasi tambahan...">'+escapeHTML(notes)+'</textarea></div></div>'+(statusText?'<div class="detail-section"><div class="detail-section-title">Status & Kendala</div><div class="detail-status-display">'+escapeHTML(statusText)+'</div></div>':'')+'</div><div class="detail-footer"><button class="detail-btn-close" onclick="closeProjectDetail()">Tutup</button><button class="detail-btn-save" onclick="saveProjectDetail()">Simpan Detail</button></div></div>';
    document.body.appendChild(overlay);
}
function addDetailLink(){
    const list=document.getElementById('detail-links-list');const r=document.createElement('div');r.className='detail-link-row';
    r.innerHTML='<input type="text" class="detail-link-input" value="" placeholder="https://..."><button class="detail-link-remove" onclick="this.parentElement.remove()">x</button>';
    list.appendChild(r);r.querySelector('input').focus();
}
function saveProjectDetail(){
    if(!_detailCurrentRow)return;
    const picSel=[...document.querySelectorAll('#detail-pic-list input:checked')].map(c=>c.value);
    _detailCurrentRow.setAttribute('data-pic',picSel.join('|||'));
    const blkSel=[...document.querySelectorAll('#detail-blocker-list input:checked')].map(c=>c.value);
    _detailCurrentRow.setAttribute('data-blockers',blkSel.join('|||'));
    _detailCurrentRow.setAttribute('data-category',document.getElementById('detail-category').value);
    _detailCurrentRow.setAttribute('data-priority',document.getElementById('detail-priority').value);
    _detailCurrentRow.setAttribute('data-notes',document.getElementById('detail-notes').value.trim());
    _detailCurrentRow.setAttribute('data-next-action',(document.getElementById('detail-next-action')||{value:''}).value.trim());
    _detailCurrentRow.setAttribute('data-due',(document.getElementById('detail-due')||{value:''}).value);
    _detailCurrentRow.setAttribute('data-prognosa',(document.getElementById('detail-prognosa')||{value:''}).value);
    const links=[];document.querySelectorAll('#detail-links-list .detail-link-input').forEach(inp=>{if(inp.value.trim())links.push(inp.value.trim());});
    _detailCurrentRow.setAttribute('data-links',links.join('|||'));
    const btn=document.querySelector('.detail-btn-save');
    if(btn){const o=btn.innerHTML;btn.innerHTML='✅ Tersimpan!';setTimeout(()=>{btn.innerHTML=o;},1500);}
    if(typeof applyTrafficLight==='function') applyTrafficLight(_detailCurrentRow);
    refreshActiveView();
}
function closeProjectDetail(){
    const ov=document.getElementById('detail-overlay');
    if(ov){ov.style.animation='dtFadeIn 0.15s ease reverse';setTimeout(()=>ov.remove(),150);}
    _detailCurrentRow=null;
}

// ===================================================================
// MASTER DATA MODAL (admin) - kelola PIC, Blocker, Kategori, Prioritas
// ===================================================================
const MASTER_DATA_SECTIONS=[
    {key:'pics',title:'PIC / Owner',placeholder:'Nama PIC...'},
    {key:'blockerCategories',title:'Blocker Category',placeholder:'Kategori blocker...'},
    {key:'categories',title:'Kategori Project',placeholder:'Nama kategori...'},
    {key:'priorities',title:'Prioritas',placeholder:'Nama prioritas...'}
];
function masterItemRowHTML(value,placeholder){
    return '<div class="detail-link-row"><input type="text" class="detail-link-input md-item-input" value="'+escapeAttr(value||'')+'" placeholder="'+escapeAttr(placeholder)+'"><button class="detail-link-remove" onclick="this.parentElement.remove()">x</button></div>';
}
// Baris kategori blocker yang diperluas: nama kategori + owner + rekomendasi aksi (decision support).
function blockerItemRowHTML(cat,owner,action){
    return '<div class="md-blocker-row">'
        + '<input type="text" class="detail-link-input md-item-input" value="'+escapeAttr(cat||'')+'" placeholder="Kategori blocker...">'
        + '<input type="text" class="detail-link-input md-blk-owner" value="'+escapeAttr(owner||'')+'" placeholder="Owner / penanggung jawab...">'
        + '<input type="text" class="detail-link-input md-blk-action" value="'+escapeAttr(action||'')+'" placeholder="Rekomendasi aksi...">'
        + '<button class="detail-link-remove" onclick="this.parentElement.remove()">x</button></div>';
}
function openMasterData(){
    const md=getMasterData();
    const meta=md.blockerMeta||{};
    const sectionsHTML=MASTER_DATA_SECTIONS.map(sec=>{
        if(sec.key==='blockerCategories'){
            const items=(md.blockerCategories||[]).map(c=>{ const m=meta[c]||{}; return blockerItemRowHTML(c,m.owner,m.action); }).join('');
            return '<div class="detail-section"><div class="detail-section-title">'+escapeHTML(sec.title)+' <span class="md-hint-inline">(kategori · owner · rekomendasi aksi)</span></div><div class="detail-links-list" id="md-list-'+sec.key+'">'+items+'</div><button class="btn-add-link" onclick="addBlockerItem()">+ Tambah</button></div>';
        }
        const items=(md[sec.key]||[]).map(v=>masterItemRowHTML(v,sec.placeholder)).join('');
        return '<div class="detail-section"><div class="detail-section-title">'+escapeHTML(sec.title)+'</div><div class="detail-links-list" id="md-list-'+sec.key+'">'+items+'</div><button class="btn-add-link" onclick="addMasterItem(\''+sec.key+'\',\''+escapeAttr(sec.placeholder)+'\')">+ Tambah</button></div>';
    }).join('');
    const overlay=document.createElement('div'); overlay.className='detail-overlay master-overlay'; overlay.id='master-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeMasterData();});
    overlay.innerHTML='<div class="detail-modal master-modal"><div class="detail-header"><div class="detail-header-left"><h2>Master Data</h2><div class="detail-status-badge">🗂️ Admin</div></div><button class="detail-close" onclick="closeMasterData()">&times;</button></div><div class="detail-body"><p class="md-hint">Perubahan hanya tersimpan oleh admin (memerlukan token saat menyimpan).</p>'+sectionsHTML+'</div><div class="detail-footer"><button class="detail-btn-close" onclick="closeMasterData()">Tutup</button><button class="detail-btn-save" onclick="saveMasterData()">Simpan Master Data</button></div></div>';
    document.body.appendChild(overlay);
}
function addMasterItem(key,placeholder){
    const list=document.getElementById('md-list-'+key); if(!list)return;
    const tmp=document.createElement('div'); tmp.innerHTML=masterItemRowHTML('',placeholder);
    const rowEl=tmp.firstChild; list.appendChild(rowEl); const inp=rowEl.querySelector('input'); if(inp)inp.focus();
}
function addBlockerItem(){
    const list=document.getElementById('md-list-blockerCategories'); if(!list)return;
    const tmp=document.createElement('div'); tmp.innerHTML=blockerItemRowHTML('','','');
    const rowEl=tmp.firstChild; list.appendChild(rowEl); const inp=rowEl.querySelector('input'); if(inp)inp.focus();
}
function closeMasterData(){
    const ov=document.getElementById('master-overlay');
    if(ov){ov.style.animation='dtFadeIn 0.15s ease reverse';setTimeout(()=>ov.remove(),150);}
}
async function saveMasterData(){
    const next={};
    const blockerMeta={};
    MASTER_DATA_SECTIONS.forEach(sec=>{
        if(sec.key==='blockerCategories'){
            const seen=new Set(); const arr=[];
            document.querySelectorAll('#md-list-blockerCategories .md-blocker-row').forEach(rowEl=>{
                const cat=(rowEl.querySelector('.md-item-input')||{value:''}).value.trim();
                if(!cat || seen.has(cat.toLowerCase())) return;
                seen.add(cat.toLowerCase()); arr.push(cat);
                const owner=(rowEl.querySelector('.md-blk-owner')||{value:''}).value.trim();
                const action=(rowEl.querySelector('.md-blk-action')||{value:''}).value.trim();
                if(owner||action) blockerMeta[cat]={owner,action};
            });
            next.blockerCategories=arr;
            return;
        }
        const seen=new Set(); const arr=[];
        document.querySelectorAll('#md-list-'+sec.key+' .md-item-input').forEach(inp=>{
            const v=inp.value.trim(); if(v && !seen.has(v.toLowerCase())){seen.add(v.toLowerCase());arr.push(v);}
        });
        next[sec.key]=arr;
    });
    next.blockerMeta=blockerMeta;
    if(!_appData)_appData={};
    _appData.masterData=next;
    closeMasterData();
    if(typeof saveToDatabase==='function'){ await saveToDatabase(); }
    else if(typeof showToast==='function'){ showToast('Master data diperbarui'); }
    if(typeof refreshActiveView==='function') refreshActiveView();
}
