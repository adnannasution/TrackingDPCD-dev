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
    const rows=(typeof getVisibleRows==='function')?getVisibleRows():Array.from(document.querySelectorAll('.gantt-row')); const redItems=[]; const yellowItems=[];
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
    const rows=(typeof getVisibleRows==='function')?getVisibleRows():Array.from(document.querySelectorAll('.gantt-row'));
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
    const dept=row.getAttribute('data-dept')||'';
    const links=(row.getAttribute('data-links')||'').split('|||').filter(Boolean);
    const nextAction=row.getAttribute('data-next-action')||''; const dueDate=row.getAttribute('data-due')||'';
    const prognosa=row.getAttribute('data-prognosa')||'';
    const md=getMasterData();
    const catList=[''].concat(md.categories); if(category && md.categories.indexOf(category)<0) catList.push(category);
    const priList=[''].concat(md.priorities); if(priority && md.priorities.indexOf(priority)<0) priList.push(priority);
    const catOpts=catList.map(o=>'<option value="'+escapeAttr(o)+'"'+(o===category?' selected':'')+'>'+(o||'-- Pilih Kategori --')+'</option>').join('');
    const priOpts=priList.map(o=>'<option value="'+escapeAttr(o)+'"'+(o===priority?' selected':'')+'>'+(o||'-- Pilih Prioritas --')+'</option>').join('');
    const buildChecklist=(opts,selected)=>{const sel=selected.slice();selected.forEach(s=>{if(opts.indexOf(s)<0)opts=opts.concat(s);});return opts.length?opts.map(o=>'<label class="md-chk"><input type="checkbox" value="'+escapeAttr(o)+'"'+(sel.indexOf(o)>=0?' checked':'')+'><span>'+escapeHTML(o)+'</span></label>').join(''):'<span class="md-chk-empty">Belum ada data master.</span>';};
    const picOpts = _systemUsers.length ? _systemUsers.filter(u=>u.is_active).map(u=>u.full_name) : (md.pics||[]);
    const picChecklist=buildChecklist(picOpts.slice(),picSel);
    const blockerChecklist=buildChecklist(md.blockerCategories.slice(),blockerSel);
    const linksHTML=links.length?links.map(l=>'<div class="detail-link-row"><input type="text" class="detail-link-input" value="'+escapeHTML(l)+'" placeholder="https://..."><button class="detail-link-remove" onclick="this.parentElement.remove()">x</button></div>').join(''):'';
    const statusCell=row.children[row.children.length-1];const statusText=statusCell?statusCell.innerText.trim():'';

    // Build dept options from cached departments
    const deptOptsHTML = '<option value="">-- Pilih Bagian --</option>' +
        (_cachedDepts||[]).map(d=>'<option value="'+escapeAttr(d.name)+'"'+(d.name===dept?' selected':'')+'>'+escapeHTML(d.name)+'</option>').join('');

    const overlay=document.createElement('div'); overlay.className='detail-overlay'; overlay.id='detail-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeProjectDetail();});
    overlay.innerHTML='<div class="detail-modal"><div class="detail-header"><div class="detail-header-left"><h2>'+(escapeHTML(projectName)||'(Tanpa Nama)')+'</h2><div class="detail-status-badge"><div class="detail-status-dot" style="background:'+rag.color+';"></div>'+rag.label+'</div></div><button class="detail-close" onclick="closeProjectDetail()">&times;</button></div><div class="detail-body"><div class="detail-progress-section"><div class="detail-progress-row"><div class="detail-progress-label">Plan</div><div class="detail-progress-bar-track"><div class="detail-progress-bar-fill dt-plan-fill" style="width:'+planPct+'%;">'+planPct+'%</div></div></div><div class="detail-progress-row"><div class="detail-progress-label">Actual</div><div class="detail-progress-bar-track"><div class="detail-progress-bar-fill dt-actual-fill" style="width:'+actPct+'%;">'+actPct+'%</div></div></div>'+timelineViewHTML+diffHTML+'</div><div class="detail-section"><div class="detail-section-title">Informasi Project</div><div class="detail-field"><label>Bagian</label><select id="detail-dept" style="padding:8px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:14px;font-family:inherit;background:#f8fafc">'+deptOptsHTML+'</select></div><div class="detail-field" style="grid-template-columns:1fr;"><label>PIC / Owner</label><div class="detail-checklist" id="detail-pic-list">'+picChecklist+'</div></div><div class="detail-field"><label>Kategori</label><select id="detail-category">'+catOpts+'</select></div><div class="detail-field"><label>Prioritas</label><select id="detail-priority">'+priOpts+'</select></div></div><div class="detail-section"><div class="detail-section-title">Kendala / Blocker</div><div class="detail-field" style="grid-template-columns:1fr;"><label>Kategori Blocker</label><div class="detail-checklist" id="detail-blocker-list">'+blockerChecklist+'</div></div></div><div class="detail-section"><div class="detail-section-title">Tindak Lanjut</div><div class="detail-field" style="grid-template-columns:1fr;"><label>Next Action</label><input type="text" id="detail-next-action" value="'+escapeHTML(nextAction)+'" placeholder="Aksi berikutnya..."></div><div class="detail-field"><label>Due Date</label><input type="date" id="detail-due" value="'+escapeHTML(dueDate)+'"></div><div class="detail-field"><label>Prognosa Selesai <span style="font-weight:400;color:var(--ink-3);">(estimasi selesai utk status delay)</span></label><input type="date" id="detail-prognosa" value="'+escapeHTML(prognosa)+'"></div></div><div class="detail-section"><div class="detail-section-title">Links / Referensi</div><div class="detail-links-list" id="detail-links-list">'+linksHTML+'</div><button class="btn-add-link" onclick="addDetailLink()">+ Tambah Link</button></div><div class="detail-section"><div class="detail-section-title">Catatan / Minutes Meeting</div><div class="detail-field" style="grid-template-columns:1fr;"><textarea id="detail-notes" placeholder="Tulis catatan, minutes meeting, atau informasi tambahan...">'+escapeHTML(notes)+'</textarea></div></div>'+(statusText?'<div class="detail-section"><div class="detail-section-title">Status & Kendala</div><div class="detail-status-display">'+escapeHTML(statusText)+'</div></div>':'')+'</div><div class="detail-footer"><button class="detail-btn-close" onclick="closeProjectDetail()">Tutup</button><button class="detail-btn-save" onclick="saveProjectDetail()">Simpan Detail</button></div></div>';
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
    const deptSel=(document.getElementById('detail-dept')||{value:''}).value;
    if(deptSel) _detailCurrentRow.setAttribute('data-dept', deptSel);
    else _detailCurrentRow.removeAttribute('data-dept');
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
    {key:'blockerCategories',title:'Blocker Category',placeholder:'Kategori blocker...'},
    {key:'categories',title:'Kategori Project',placeholder:'Nama kategori...'},
    {key:'priorities',title:'Prioritas',placeholder:'Nama prioritas...'}
];
// Cache system users for PIC checklist
let _systemUsers = [];
async function loadSystemUsers() {
    try {
        const res = await Auth.apiFetch('/api/users');
        if (res && res.ok) _systemUsers = await res.json();
    } catch(e) { /* ignore */ }
}

// Cache departments for project detail modal
let _cachedDepts = [];
async function loadCachedDepts() {
    try {
        const res = await Auth.apiFetch('/api/departments');
        if (res && res.ok) _cachedDepts = await res.json();
    } catch(e) { /* ignore */ }
}
function masterItemRowHTML(value,placeholder){
    return `<div class="mds-item-row">
        <input type="text" class="mds-item-input md-item-input" value="${escapeAttr(value||'')}" placeholder="${escapeAttr(placeholder)}">
        <button class="mds-item-del" onclick="this.parentElement.remove()" title="Hapus">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}
function blockerItemRowHTML(cat,owner,action){
    return `<div class="mds-blocker-card md-blocker-row">
        <div class="mds-blocker-fields">
            <div class="mds-bf">
                <label>Kategori</label>
                <input type="text" class="mds-item-input md-item-input" value="${escapeAttr(cat||'')}" placeholder="Nama kategori blocker…">
            </div>
            <div class="mds-bf">
                <label>Owner / PIC</label>
                <input type="text" class="mds-item-input md-blk-owner" value="${escapeAttr(owner||'')}" placeholder="Penanggung jawab…">
            </div>
            <div class="mds-bf mds-bf-wide">
                <label>Rekomendasi Aksi</label>
                <input type="text" class="mds-item-input md-blk-action" value="${escapeAttr(action||'')}" placeholder="Langkah penyelesaian yang disarankan…">
            </div>
        </div>
        <button class="mds-item-del" onclick="this.parentElement.remove()" title="Hapus">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}
function openMasterData(){
    const md=getMasterData();
    const meta=md.blockerMeta||{};
    const user = Auth.getUser();
    const isAdmin = user && (user.role === 'admin' || user.role === 'manager');

    const sectionsHTML=MASTER_DATA_SECTIONS.map(sec=>{
        if(sec.key==='blockerCategories'){
            const items=(md.blockerCategories||[]).map(c=>{ const m=meta[c]||{}; return blockerItemRowHTML(c,m.owner,m.action); }).join('');
            return `<div class="mds-section">
                <div class="mds-section-header">
                    <div class="mds-section-title">${escapeHTML(sec.title)}</div>
                    <span class="mds-section-hint">kategori · owner · rekomendasi aksi</span>
                </div>
                <div class="mds-blocker-list" id="md-list-${sec.key}">${items||'<div class="mds-empty">Belum ada kategori.</div>'}</div>
                <button class="mds-btn-add" onclick="addBlockerItem()">+ Tambah Kategori</button>
            </div>`;
        }
        const items=(md[sec.key]||[]).map(v=>masterItemRowHTML(v,sec.placeholder)).join('');
        return `<div class="mds-section">
            <div class="mds-section-header">
                <div class="mds-section-title">${escapeHTML(sec.title)}</div>
            </div>
            <div class="mds-items-list" id="md-list-${sec.key}">${items||'<div class="mds-empty">Belum ada item.</div>'}</div>
            <button class="mds-btn-add" onclick="addMasterItem('${sec.key}','${escapeAttr(sec.placeholder)}')">+ Tambah</button>
        </div>`;
    }).join('');

    const roleBadge = user ? `<span class="mdr-badge mdr-badge-${user.role}">${user.role.toUpperCase()}</span>` : '';

    const deptTabHTML = isAdmin ? `
        <div class="md-tab-content" id="md-tab-bagian">
            <div id="md-dept-list" class="mdr-list">
                <div class="mdr-empty">Memuat...</div>
            </div>
            <div class="mdr-add-card">
                <div class="mdr-add-card-title">Tambah Bagian Baru</div>
                <div class="mdr-form-row">
                    <div class="mdr-field">
                        <label>Nama Bagian <span class="req">*</span></label>
                        <input type="text" id="md-new-dept-name" placeholder="contoh: MSAI, DPCD…">
                    </div>
                    <div class="mdr-field">
                        <label>Deskripsi</label>
                        <input type="text" id="md-new-dept-desc" placeholder="Opsional">
                    </div>
                    <button class="mdr-btn-add" onclick="mdAddDept()">+ Tambah</button>
                </div>
            </div>
        </div>
    ` : '';

    const userTabHTML = isAdmin ? `
        <div class="md-tab-content" id="md-tab-user">
            <div id="md-user-list" class="mdr-list">
                <div class="mdr-empty">Memuat...</div>
            </div>
            <div class="mdr-add-card">
                <div class="mdr-add-card-title">Tambah Pengguna Baru</div>
                <div class="mdr-form-grid">
                    <div class="mdr-field">
                        <label>Nama Lengkap <span class="req">*</span></label>
                        <input type="text" id="md-new-user-name" placeholder="Nama Lengkap">
                    </div>
                    <div class="mdr-field">
                        <label>Username <span class="req">*</span></label>
                        <input type="text" id="md-new-user-username" placeholder="username">
                    </div>
                    <div class="mdr-field">
                        <label>Password <span class="req">*</span></label>
                        <input type="password" id="md-new-user-pw" placeholder="••••••••">
                    </div>
                    <div class="mdr-field">
                        <label>Role <span class="req">*</span></label>
                        <select id="md-new-user-role">
                            <option value="member">Member</option>
                            <option value="manager">Manager</option>
                            <option value="admin">Admin</option>
                        </select>
                    </div>
                    <div class="mdr-field mdr-field-full">
                        <label>Bagian <span class="req">*</span> <span style="font-weight:400;color:#9ca3af">(wajib untuk Manager & Member)</span></label>
                        <select id="md-new-user-dept" onchange="mdUpdateDeptRequired(this)">
                            <option value="">— Pilih Bagian —</option>
                        </select>
                    </div>
                </div>
                <button class="mdr-btn-add" onclick="mdAddUser()">+ Buat Pengguna</button>
            </div>
        </div>
    ` : '';

    const tabNavHTML = isAdmin ? `
        <div class="mdr-tabs">
            <button class="mdr-tab active" onclick="mdSwitchTab('data',this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg> Master Data</button>
            <button class="mdr-tab" onclick="mdSwitchTab('bagian',this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> Bagian</button>
            <button class="mdr-tab" onclick="mdSwitchTab('user',this)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Pengguna</button>
        </div>
    ` : '';

    const overlay=document.createElement('div'); overlay.className='detail-overlay master-overlay'; overlay.id='master-overlay';
    overlay.addEventListener('click',function(e){if(e.target===overlay)closeMasterData();});
    overlay.innerHTML=`<div class="detail-modal master-modal mdr-modal">
        <div class="mdr-header">
            <div class="mdr-header-left">
                <div class="mdr-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></div>
                <div>
                    <div class="mdr-title">Master Data</div>
                    <div class="mdr-sub">Konfigurasi sistem · ${user ? user.full_name || user.username : ''} ${roleBadge}</div>
                </div>
            </div>
            <button class="mdr-close" onclick="closeMasterData()">&times;</button>
        </div>
        <div class="mdr-body">
            ${tabNavHTML}
            <div class="md-tab-content" id="md-tab-data" style="display:block">${sectionsHTML}</div>
            ${deptTabHTML}
            ${userTabHTML}
        </div>
        <div class="mdr-footer">
            <button class="mdr-btn-cancel" onclick="closeMasterData()">Tutup</button>
            <button class="mdr-btn-save" id="md-save-btn" onclick="saveMasterData()">Simpan Master Data</button>
        </div>
    </div>`;
    document.body.appendChild(overlay);

    // Inject modern styles
    if (!document.getElementById('md-tab-styles')) {
        const s = document.createElement('style');
        s.id = 'md-tab-styles';
        s.textContent = `
.mdr-modal{border-radius:16px!important;padding:0!important;overflow:hidden;box-shadow:0 20px 60px rgba(10,34,64,0.18)!important}
.mdr-header{display:flex;align-items:center;justify-content:space-between;padding:20px 24px;background:#0a2240;color:white}
.mdr-header-left{display:flex;align-items:center;gap:14px}
.mdr-icon{width:40px;height:40px;background:rgba(255,255,255,0.1);border-radius:10px;display:flex;align-items:center;justify-content:center;color:white;flex-shrink:0}
.mdr-title{font-size:17px;font-weight:700;color:white}
.mdr-sub{font-size:12px;color:rgba(255,255,255,0.65);margin-top:2px;display:flex;align-items:center;gap:6px}
.mdr-close{background:rgba(255,255,255,0.1);border:none;color:white;width:32px;height:32px;border-radius:8px;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.15s}
.mdr-close:hover{background:rgba(255,255,255,0.2)}
.mdr-badge{padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.5px}
.mdr-badge-admin{background:#fef3c7;color:#92400e}
.mdr-badge-manager{background:#dbeafe;color:#1e40af}
.mdr-badge-member{background:#dcfce7;color:#166534}
.mdr-tabs{display:flex;gap:4px;padding:16px 24px 0;background:#f8fafc;border-bottom:1px solid #e8edf5}
.mdr-tab{display:flex;align-items:center;gap:6px;padding:9px 16px;border:none;background:none;font-size:13px;font-weight:500;color:#6b7a8d;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px;border-radius:8px 8px 0 0;transition:all 0.2s}
.mdr-tab:hover{color:#0a2240;background:rgba(10,34,64,0.04)}
.mdr-tab.active{color:#0a2240;border-bottom-color:#00a99d;font-weight:600;background:white}
.mdr-body{padding:20px 24px;max-height:60vh;overflow-y:auto}
.mdr-footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 24px;background:#f8fafc;border-top:1px solid #e8edf5}
.mdr-btn-cancel{padding:9px 20px;border:1.5px solid #dde3ec;background:white;border-radius:8px;font-size:13px;font-weight:500;color:#6b7a8d;cursor:pointer}
.mdr-btn-save{padding:9px 20px;background:linear-gradient(135deg,#00a99d,#0a7c86);border:none;border-radius:8px;font-size:13px;font-weight:600;color:white;cursor:pointer}
.mdr-list{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;min-height:40px}
.mdr-empty{color:#9ca3af;font-size:13px;padding:12px 0;text-align:center}
.mdr-dept-card{display:flex;align-items:center;gap:12px;padding:12px 16px;background:white;border:1px solid #e8edf5;border-radius:10px;transition:box-shadow 0.15s}
.mdr-dept-card:hover{box-shadow:0 2px 8px rgba(10,34,64,0.08)}
.mdr-dept-icon{width:36px;height:36px;background:linear-gradient(135deg,#e8f4fd,#d4eaf7);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.mdr-dept-info{flex:1;min-width:0}
.mdr-dept-name{font-size:14px;font-weight:600;color:#0a2240}
.mdr-dept-desc{font-size:12px;color:#9ca3af;margin-top:1px}
.mdr-dept-count{font-size:11px;padding:3px 8px;background:#f0f4f8;border-radius:20px;color:#6b7a8d;white-space:nowrap}
.mdr-dept-del{background:none;border:none;cursor:pointer;color:#cbd5e1;font-size:15px;padding:6px;border-radius:6px;transition:color 0.15s}
.mdr-dept-del:hover{color:#e63946;background:#fee2e2}
.mdr-user-card{display:flex;align-items:center;gap:12px;padding:12px 16px;background:white;border:1px solid #e8edf5;border-radius:10px;transition:box-shadow 0.15s}
.mdr-user-card:hover{box-shadow:0 2px 8px rgba(10,34,64,0.08)}
.mdr-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0a2240,#1a4a7c);color:white;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0}
.mdr-user-info{flex:1;min-width:0}
.mdr-user-name{font-size:14px;font-weight:600;color:#0a2240}
.mdr-user-meta{font-size:12px;color:#9ca3af;margin-top:2px}
.mdr-role-pill{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:0.3px;text-transform:uppercase}
.mdr-status-pill{font-size:11px;padding:3px 8px;border-radius:20px}
.mdr-lock-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:6px;font-size:16px;transition:background 0.15s}
.mdr-lock-btn:hover{background:#f0f4f8}
.mdr-add-card{background:#f8fafc;border:1.5px dashed #dde3ec;border-radius:12px;padding:16px}
.mdr-add-card-title{font-size:13px;font-weight:600;color:#0a2240;margin-bottom:12px}
.mdr-form-row{display:flex;gap:10px;align-items:flex-end}
.mdr-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px}
.mdr-field{display:flex;flex-direction:column;gap:4px;flex:1}
.mdr-field-full{grid-column:1/-1}
.mdr-field label{font-size:11px;font-weight:600;color:#6b7a8d;text-transform:uppercase;letter-spacing:0.4px}
.mdr-field input,.mdr-field select{padding:9px 12px;border:1.5px solid #dde3ec;border-radius:8px;font-size:13px;background:white;color:#0a2240;transition:border-color 0.15s;outline:none}
.mdr-field input:focus,.mdr-field select:focus{border-color:#00a99d}
.mdr-btn-add{padding:9px 18px;background:#0a2240;color:white;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:background 0.15s}
.mdr-btn-add:hover{background:#1a3a5c}
.req{color:#e63946}
.md-tab-content{display:none}.md-tab-content[style*="display:block"]{display:block!important}
.mds-section{margin-bottom:22px;background:white;border:1px solid #e8edf5;border-radius:12px;padding:16px}
.mds-section-header{display:flex;align-items:baseline;gap:10px;margin-bottom:12px}
.mds-section-title{font-size:13px;font-weight:700;color:#0a2240;text-transform:uppercase;letter-spacing:0.5px}
.mds-section-hint{font-size:11px;color:#9ca3af;font-style:italic}
.mds-items-list,.mds-blocker-list{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.mds-empty{font-size:12px;color:#c4c9d4;text-align:center;padding:10px 0;font-style:italic}
.mds-item-row{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e8edf5;border-radius:8px;padding:6px 10px;transition:border-color 0.15s}
.mds-item-row:hover{border-color:#c8d5e8}
.mds-item-input{flex:1;border:none;background:transparent;font-size:13px;color:#0a2240;outline:none;padding:2px 0}
.mds-item-input::placeholder{color:#c4c9d4}
.mds-item-del{background:none;border:none;cursor:pointer;color:#cbd5e1;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;flex-shrink:0;transition:color 0.15s,background 0.15s;padding:0}
.mds-item-del:hover{color:#e63946;background:#fee2e2}
.mds-blocker-card{display:flex;align-items:flex-start;gap:10px;background:#f8fafc;border:1px solid #e8edf5;border-radius:10px;padding:10px 12px;transition:border-color 0.15s}
.mds-blocker-card:hover{border-color:#c8d5e8}
.mds-blocker-fields{flex:1;display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px}
.mds-bf{display:flex;flex-direction:column;gap:3px}
.mds-bf-wide{grid-column:span 1}
.mds-bf label{font-size:10px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:0.4px}
.mds-btn-add{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:#f0f4f8;color:#0a2240;border:1.5px dashed #c8d5e8;border-radius:8px;font-size:12px;font-weight:600;cursor:pointer;transition:all 0.15s}
.mds-btn-add:hover{background:#e8f4fd;border-color:#00a99d;color:#00a99d}
`;
        document.head.appendChild(s);
    }

    // Load dept/user data if admin
    if (isAdmin) {
        mdLoadDepts();
        mdLoadUsers();
    }
    // Pre-load system users for PIC checklist
    if (!_systemUsers.length) loadSystemUsers();
}

function mdUpdateDeptRequired(sel) {
    const role = document.getElementById('md-new-user-role')?.value;
    sel.style.borderColor = ((role === 'manager' || role === 'member') && !sel.value) ? '#e63946' : '#dde3ec';
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

// ─── Master Data: Tab navigation ──────────────────────────────────────────────

function mdSwitchTab(name, btn) {
    document.querySelectorAll('.mdr-tab,.md-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.md-tab-content').forEach(c => { c.style.display = 'none'; });
    if (btn) btn.classList.add('active');
    const tab = document.getElementById('md-tab-' + name);
    if (tab) tab.style.display = 'block';

    // Show/hide save button — only relevant for master data tab
    const saveBtn = document.getElementById('md-save-btn');
    if (saveBtn) saveBtn.style.display = name === 'data' ? '' : 'none';

    if (name === 'bagian') mdLoadDepts();
    if (name === 'user') mdLoadUsers();
}

// ─── Departments ──────────────────────────────────────────────────────────────

async function mdLoadDepts() {
    const list = document.getElementById('md-dept-list');
    if (!list) return;
    try {
        const res = await Auth.apiFetch('/api/departments');
        if (!res || !res.ok) { list.innerHTML = '<span style="color:#e63946;font-size:13px">Gagal memuat bagian</span>'; return; }
        const depts = await res.json();
        if (!depts.length) { list.innerHTML = '<div class="mdr-empty">Belum ada bagian. Tambah di bawah.</div>'; }
        else list.innerHTML = depts.map(d => `
            <div class="mdr-dept-card">
                <div class="mdr-dept-icon">🏢</div>
                <div class="mdr-dept-info">
                    <div class="mdr-dept-name">${escapeHTML(d.name)}</div>
                    ${d.description ? `<div class="mdr-dept-desc">${escapeHTML(d.description)}</div>` : ''}
                </div>
                <span class="mdr-dept-count">👥 ${d.member_count} anggota</span>
                <button class="mdr-dept-del" onclick="mdDeleteDept(${d.id},'${escapeAttr(d.name)}')" title="Hapus">🗑</button>
            </div>`).join('');

        // Also update dept select in user form
        const deptSel = document.getElementById('md-new-user-dept');
        if (deptSel) {
            deptSel.innerHTML = '<option value="">— Pilih Bagian (wajib untuk Manager & Member) —</option>' +
                depts.map(d => `<option value="${d.id}">${escapeHTML(d.name)}</option>`).join('');
        }
    } catch(e) { if(list) list.innerHTML = '<span style="color:#e63946;font-size:13px">Error: '+escapeHTML(e.message)+'</span>'; }
}

async function mdAddDept() {
    const nameEl = document.getElementById('md-new-dept-name');
    const descEl = document.getElementById('md-new-dept-desc');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) { nameEl && nameEl.focus(); return; }
    try {
        const res = await Auth.apiFetch('/api/departments', {
            method: 'POST',
            body: JSON.stringify({ name, description: descEl ? descEl.value.trim() : '' })
        });
        if (!res || !res.ok) { const e = await res?.json(); alert(e?.error || 'Gagal tambah bagian'); return; }
        if (nameEl) nameEl.value = '';
        if (descEl) descEl.value = '';
        await mdLoadDepts();
        showToast('Bagian berhasil ditambahkan');
    } catch(e) { alert(e.message); }
}

async function mdDeleteDept(id, name) {
    if (!confirm('Hapus bagian "' + name + '"?')) return;
    const res = await Auth.apiFetch('/api/departments/' + id, { method: 'DELETE' });
    if (!res || !res.ok) { alert('Gagal hapus bagian'); return; }
    await mdLoadDepts();
    showToast('Bagian dihapus');
}

// ─── Users ────────────────────────────────────────────────────────────────────

async function mdLoadUsers() {
    const list = document.getElementById('md-user-list');
    if (!list) return;
    try {
        const res = await Auth.apiFetch('/api/users');
        if (!res || !res.ok) { list.innerHTML = '<span style="color:#e63946;font-size:13px">Gagal memuat user</span>'; return; }
        const users = await res.json();
        const roleCls = { admin:'mdr-badge-admin', manager:'mdr-badge-manager', member:'mdr-badge-member' };
        list.innerHTML = users.map(u => `
            <div class="mdr-user-card">
                <div class="mdr-avatar">${escapeHTML((u.full_name||'U')[0].toUpperCase())}</div>
                <div class="mdr-user-info">
                    <div class="mdr-user-name">${escapeHTML(u.full_name)} <span style="font-size:12px;font-weight:400;color:#9ca3af">@${escapeHTML(u.username)}</span></div>
                    <div class="mdr-user-meta">${u.dept_name ? '🏢 ' + escapeHTML(u.dept_name) : '<span style="color:#cbd5e1">Tanpa bagian</span>'}</div>
                </div>
                <span class="mdr-role-pill ${roleCls[u.role]||''}">${u.role}</span>
                <span class="mdr-status-pill" style="background:${u.is_active?'#dcfce7;color:#166534':'#fee2e2;color:#991b1b'}">${u.is_active?'Aktif':'Nonaktif'}</span>
                <button class="mdr-lock-btn" onclick="mdToggleUser(${u.id},${u.is_active})" title="${u.is_active?'Nonaktifkan':'Aktifkan'}">${u.is_active?'🔒':'🔓'}</button>
            </div>`).join('') || '<div class="mdr-empty">Belum ada pengguna</div>';
    } catch(e) { if(list) list.innerHTML = '<span style="color:#e63946;font-size:13px">Error: '+escapeHTML(e.message)+'</span>'; }
}

async function mdAddUser() {
    const fullName = (document.getElementById('md-new-user-name')?.value||'').trim();
    const username = (document.getElementById('md-new-user-username')?.value||'').trim().toLowerCase();
    const password = (document.getElementById('md-new-user-pw')?.value||'').trim();
    const role = document.getElementById('md-new-user-role')?.value || 'member';
    const deptId = document.getElementById('md-new-user-dept')?.value || null;
    if (!fullName || !username || !password) { alert('Nama, username, dan password wajib diisi'); return; }
    if ((role === 'manager' || role === 'member') && !deptId) { alert('Bagian wajib diisi untuk role Manager dan Member'); document.getElementById('md-new-user-dept')?.focus(); return; }
    try {
        const res = await Auth.apiFetch('/api/users', {
            method: 'POST',
            body: JSON.stringify({ full_name: fullName, username, password, role, department_id: deptId || null })
        });
        if (!res || !res.ok) { const e = await res?.json(); alert(e?.error || 'Gagal buat user'); return; }
        document.getElementById('md-new-user-name').value = '';
        document.getElementById('md-new-user-username').value = '';
        document.getElementById('md-new-user-pw').value = '';
        await mdLoadUsers();
        showToast('User berhasil dibuat');
    } catch(e) { alert(e.message); }
}

async function mdToggleUser(id, isActive) {
    if (!confirm((isActive ? 'Nonaktifkan' : 'Aktifkan') + ' user ini?')) return;
    const res = await Auth.apiFetch('/api/users/' + id, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !isActive })
    });
    if (!res || !res.ok) { alert('Gagal update user'); return; }
    await mdLoadUsers();
    showToast('Status user diperbarui');
}
