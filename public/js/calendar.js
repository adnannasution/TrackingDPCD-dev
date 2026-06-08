// ===================================================================
// DPCD MONITORING — CALENDAR OF EVENT
// Kegiatan di luar project. Disimpan di meta.events, ikut tombol Simpan.
// Event shape (baru):
//   { id, startDate:'YYYY-MM-DD', endDate:'YYYY-MM-DD',
//     startTime:'HH:MM', endTime:'HH:MM', name, pic, color }
// Kompatibel dengan event lama: { date, time } → startDate=endDate, startTime.
// ===================================================================

let _calEvents = [];
let _calCursor = (function(){ const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

const CAL_MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const CAL_COLORS = ['#2563eb','#0e7c86','#15a34a','#d9890b','#dc2626','#7c3aed','#db2777'];

// ---------- state accessors used by core.js serialize/render ----------
function getCalendarEvents(){ return _calEvents.map(e => ({ ...e })); }
function setCalendarEvents(events){
    _calEvents = (Array.isArray(events) ? events : []).map(normalizeEvent).filter(Boolean);
    if (typeof renderCalendar === 'function' && document.getElementById('calendar-container')) renderCalendar();
}
function normalizeEvent(e){
    if (!e || typeof e !== 'object') return null;
    const isISO = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
    const isTime = v => /^\d{1,2}:\d{2}$/.test(String(v || ''));
    // Dukung skema lama (date/time) dan baru (startDate/endDate/...).
    let startDate = isISO(e.startDate) ? e.startDate : (isISO(e.date) ? e.date : '');
    let endDate = isISO(e.endDate) ? e.endDate : startDate;
    if (!startDate) return null;
    if (endDate < startDate) endDate = startDate;
    return {
        id: e.id || ('ev_' + Math.random().toString(36).slice(2, 9)),
        startDate,
        endDate,
        startTime: isTime(e.startTime) ? String(e.startTime) : (isTime(e.time) ? String(e.time) : ''),
        endTime: isTime(e.endTime) ? String(e.endTime) : '',
        name: String(e.name || '').slice(0, 200),
        pic: String(e.pic || '').slice(0, 120),
        color: CAL_COLORS.includes(e.color) ? e.color : CAL_COLORS[0]
    };
}

// ---------- date helpers ----------
function calTodayISO(){ return getLocalTodayISO(); }
function calPad(n){ return String(n).padStart(2, '0'); }
function calDateISO(y, m, d){ return y + '-' + calPad(m + 1) + '-' + calPad(d); }
function calAddDays(iso, n){
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return calDateISO(d.getFullYear(), d.getMonth(), d.getDate());
}
function calFormatLong(iso){
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}
function calTimeRange(ev){
    if (!ev.startTime && !ev.endTime) return '';
    if (ev.startTime && ev.endTime) return ev.startTime + '–' + ev.endTime;
    return ev.startTime || ev.endTime;
}
function calIsMultiDay(ev){ return ev.endDate > ev.startDate; }

// ---------- navigation ----------
function calChangeMonth(delta){
    _calCursor.m += delta;
    while (_calCursor.m < 0) { _calCursor.m += 12; _calCursor.y--; }
    while (_calCursor.m > 11) { _calCursor.m -= 12; _calCursor.y++; }
    renderCalendar();
}
function calGoToday(){
    const d = new Date();
    _calCursor = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
}

// ===================================================================
// RENDER GRID — event multi-hari digambar sebagai bar membentang.
// Strategi: bangun grid per-minggu (baris 7 hari). Untuk tiap event,
// potong rentangnya ke tiap minggu, lalu tempatkan sebagai bar absolut
// yang membentang beberapa kolom. Single-day = bar 1 kolom.
// ===================================================================
function renderCalendar(){
    const grid = document.getElementById('cal-grid');
    if (!grid) return;
    const titleEl = document.getElementById('cal-title');
    if (titleEl) titleEl.textContent = CAL_MONTHS[_calCursor.m] + ' ' + _calCursor.y;

    const y = _calCursor.y, m = _calCursor.m;
    const firstDay = new Date(y, m, 1);
    const lead = (firstDay.getDay() + 6) % 7;          // Senin=0
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const totalCells = lead + daysInMonth;
    const rows = Math.ceil(totalCells / 7);
    const todayISO = calTodayISO();

    // Tanggal ISO untuk setiap sel grid (termasuk lead/trail dari bulan lain).
    const gridStartISO = calDateISO(y, m, 1 - lead);   // tanggal sel pertama
    const cells = [];
    for (let i = 0; i < rows * 7; i++) cells.push(calAddDays(gridStartISO, i));

    // Bangun HTML sel dasar.
    let cellsHTML = '';
    cells.forEach(iso => {
        const d = new Date(iso + 'T00:00:00');
        const inMonth = (d.getMonth() === m && d.getFullYear() === y);
        const dow = d.getDay();
        const isWeekend = dow === 0 || dow === 6;
        const isToday = iso === todayISO;
        cellsHTML += '<div class="cal-cell' + (inMonth ? '' : ' cal-cell-muted') +
            (isWeekend && inMonth ? ' cal-cell-weekend' : '') + (isToday ? ' cal-cell-today' : '') +
            '" data-date="' + iso + '"' + (inMonth ? '' : ' data-muted="1"') + '>' +
            '<span class="cal-date">' + d.getDate() + '</span></div>';
    });
    grid.style.setProperty('--cal-rows', rows);
    grid.innerHTML = cellsHTML;

    // ---- tempatkan bar event per minggu ----
    const gridFirst = gridStartISO;
    const gridLast = cells[cells.length - 1];
    // Event yang beririsan dengan rentang grid, urut mulai lalu durasi panjang dulu.
    const visible = _calEvents
        .filter(ev => ev.endDate >= gridFirst && ev.startDate <= gridLast)
        .sort((a, b) => (a.startDate.localeCompare(b.startDate)) ||
                        (b.endDate.localeCompare(b.startDate) - a.endDate.localeCompare(a.startDate)) ||
                        (a.startTime || '').localeCompare(b.startTime || ''));

    const overlay = document.createElement('div');
    overlay.className = 'cal-bars-overlay';

    // lane tracker per minggu untuk mencegah tumpang tindih bar
    for (let w = 0; w < rows; w++) {
        const weekStart = calAddDays(gridFirst, w * 7);
        const weekEnd = calAddDays(weekStart, 6);
        const lanes = []; // lanes[laneIndex] = endCol terakhir terisi
        visible.forEach(ev => {
            if (ev.endDate < weekStart || ev.startDate > weekEnd) return;
            const segStart = ev.startDate < weekStart ? weekStart : ev.startDate;
            const segEnd = ev.endDate > weekEnd ? weekEnd : ev.endDate;
            const colStart = Math.round((new Date(segStart + 'T00:00:00') - new Date(weekStart + 'T00:00:00')) / 86400000);
            const colEnd = Math.round((new Date(segEnd + 'T00:00:00') - new Date(weekStart + 'T00:00:00')) / 86400000);
            // cari lane bebas
            let lane = 0;
            while (lane < lanes.length && lanes[lane] >= colStart) lane++;
            lanes[lane] = colEnd;
            const span = colEnd - colStart + 1;
            const multi = calIsMultiDay(ev);
            const contLeft = ev.startDate < segStart;   // lanjutan dari minggu sebelumnya
            const contRight = ev.endDate > segEnd;      // berlanjut ke minggu berikutnya
            const tr = calTimeRange(ev);
            const labelTime = tr ? '<b>' + escapeHTML(tr) + '</b> ' : '';
            const bar = document.createElement('div');
            bar.className = 'cal-bar' + (multi ? ' cal-bar-multi' : '') + (contLeft ? ' cont-l' : '') + (contRight ? ' cont-r' : '');
            bar.style.cssText =
                '--pc:' + ev.color + ';' +
                'grid-row:' + (w + 1) + ';' +
                'grid-column:' + (colStart + 1) + ' / span ' + span + ';' +
                '--lane:' + lane + ';';
            bar.dataset.ev = ev.id;
            bar.title = (calIsMultiDay(ev) ? calFormatLong(ev.startDate) + ' – ' + calFormatLong(ev.endDate) + '\n' : '') +
                (tr ? tr + ' · ' : '') + ev.name + (ev.pic ? ' (' + ev.pic + ')' : '');
            bar.innerHTML = '<span class="cal-bar-label">' + labelTime + escapeHTML(ev.name) + '</span>';
            overlay.appendChild(bar);
        });
    }
    grid.appendChild(overlay);

    // ---- interaksi ----
    overlay.querySelectorAll('.cal-bar').forEach(bar => {
        bar.addEventListener('click', function(e){
            e.stopPropagation();
            const ev = _calEvents.find(x => x.id === bar.dataset.ev);
            if (ev) openEventForm(ev);
        });
    });
    grid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
        if (cell.dataset.muted) return;
        cell.addEventListener('click', function(){ openEventForm(null, cell.dataset.date); });
    });

    renderAgenda();
}

function renderAgenda(){
    const list = document.getElementById('cal-agenda-list');
    const countEl = document.getElementById('cal-agenda-count');
    if (!list) return;
    const todayISO = calTodayISO();
    // tampilkan event yang belum berakhir (endDate >= hari ini)
    const upcoming = _calEvents
        .filter(ev => ev.endDate >= todayISO)
        .sort((a, b) => (a.startDate + (a.startTime || '99:99')).localeCompare(b.startDate + (b.startTime || '99:99')));
    if (countEl) countEl.textContent = upcoming.length;
    if (upcoming.length === 0) {
        list.innerHTML = '<div class="cal-agenda-empty">Belum ada agenda mendatang.<br>Klik tanggal untuk menambah event.</div>';
        return;
    }
    let html = '';
    let lastDate = '';
    upcoming.slice(0, 40).forEach(ev => {
        if (ev.startDate !== lastDate) {
            const isToday = ev.startDate === todayISO;
            html += '<div class="cal-agenda-day">' + (isToday ? '🟢 Hari ini · ' : '') + calFormatLong(ev.startDate) + '</div>';
            lastDate = ev.startDate;
        }
        const tr = calTimeRange(ev);
        const range = calIsMultiDay(ev)
            ? '<div class="cal-agenda-range">📅 s.d. ' + calFormatLong(ev.endDate) + '</div>' : '';
        html += '<div class="cal-agenda-item" data-ev="' + ev.id + '" style="--pc:' + ev.color + '">' +
            '<div class="cal-agenda-time num">' + escapeHTML(ev.startTime || '—') + '</div>' +
            '<div class="cal-agenda-body"><div class="cal-agenda-name">' + escapeHTML(ev.name) +
            (calIsMultiDay(ev) ? ' <span class="cal-multi-tag">multi-hari</span>' : '') + '</div>' +
            (tr ? '<div class="cal-agenda-pic">🕒 ' + escapeHTML(tr) + '</div>' : '') +
            range +
            (ev.pic ? '<div class="cal-agenda-pic">👤 ' + escapeHTML(ev.pic) + '</div>' : '') +
            '</div></div>';
    });
    list.innerHTML = html;
    list.querySelectorAll('.cal-agenda-item').forEach(item => {
        item.addEventListener('click', function(){
            const ev = _calEvents.find(x => x.id === item.dataset.ev);
            if (ev) openEventForm(ev);
        });
    });
}

// ===================================================================
// ADD / EDIT MODAL
// ===================================================================
function closeEventForm(){
    const ov = document.getElementById('event-form-overlay');
    if (ov) ov.remove();
}
function openEventForm(existing, presetDate){
    closeEventForm();
    const ev = existing || {
        startDate: presetDate || calTodayISO(),
        endDate: presetDate || calTodayISO(),
        startTime: '', endTime: '', name: '', pic: '', color: CAL_COLORS[0]
    };
    const isEdit = !!existing;
    const colorDots = CAL_COLORS.map(c =>
        '<button type="button" class="cal-color-dot' + (c === ev.color ? ' active' : '') + '" data-color="' + c + '" style="background:' + c + '"></button>'
    ).join('');
    const overlay = document.createElement('div');
    overlay.className = 'milestone-form-overlay';
    overlay.id = 'event-form-overlay';
    overlay.addEventListener('click', function(e){ if (e.target === overlay) closeEventForm(); });
    overlay.innerHTML =
        '<form class="milestone-form-modal event-form-modal">' +
            '<div class="milestone-form-header"><div><h3>' + (isEdit ? 'Edit Event' : 'Tambah Event') + '</h3>' +
                '<p class="bar-form-subtitle">Kegiatan di luar project. Bisa lintas hari.</p></div>' +
                '<button type="button" onclick="closeEventForm()">&times;</button></div>' +
            '<div class="milestone-form-body">' +
                '<label>Nama kegiatan<input id="ev-name" type="text" value="' + escapeAttr(ev.name) + '" placeholder="mis. PI AF Workshop" required></label>' +
                '<div class="event-form-row">' +
                    '<label>Tanggal mulai<input id="ev-start-date" type="date" value="' + escapeAttr(ev.startDate) + '" required></label>' +
                    '<label>Tanggal selesai<input id="ev-end-date" type="date" value="' + escapeAttr(ev.endDate) + '" required></label>' +
                '</div>' +
                '<div class="event-form-row">' +
                    '<label>Jam mulai<input id="ev-start-time" type="time" value="' + escapeAttr(ev.startTime) + '"></label>' +
                    '<label>Jam selesai<input id="ev-end-time" type="time" value="' + escapeAttr(ev.endTime) + '"></label>' +
                '</div>' +
                '<p class="event-form-hint" id="ev-hint"></p>' +
                '<label>PIC / Penanggung jawab<input id="ev-pic" type="text" value="' + escapeAttr(ev.pic) + '" placeholder="Nama PIC..."></label>' +
                '<label>Warna<div class="cal-color-row" id="ev-colors">' + colorDots + '</div></label>' +
            '</div>' +
            '<div class="milestone-form-footer event-form-footer">' +
                (isEdit ? '<button type="button" class="event-btn-delete" id="ev-delete">Hapus</button>' : '<span></span>') +
                '<div class="event-form-footer-right">' +
                    '<button type="button" class="milestone-btn-secondary" onclick="closeEventForm()">Batal</button>' +
                    '<button type="submit" class="milestone-btn-primary">Simpan</button>' +
                '</div>' +
            '</div>' +
        '</form>';
    document.body.appendChild(overlay);

    const startDateInput = overlay.querySelector('#ev-start-date');
    const endDateInput = overlay.querySelector('#ev-end-date');
    const startTimeInput = overlay.querySelector('#ev-start-time');
    const endTimeInput = overlay.querySelector('#ev-end-time');
    const hint = overlay.querySelector('#ev-hint');
    const nameInput = overlay.querySelector('#ev-name');

    function refreshHint(){
        const sd = startDateInput.value, ed = endDateInput.value;
        if (sd && ed && ed > sd) {
            const days = Math.round((new Date(ed + 'T00:00:00') - new Date(sd + 'T00:00:00')) / 86400000) + 1;
            const tr = (startTimeInput.value && endTimeInput.value) ? (' · ' + startTimeInput.value + '–' + endTimeInput.value + ' tiap hari') : '';
            hint.textContent = '📌 Kegiatan ' + days + ' hari' + tr;
            hint.style.display = 'block';
        } else { hint.style.display = 'none'; }
    }
    // tanggal selesai otomatis ikut bila lebih kecil dari mulai
    startDateInput.addEventListener('change', function(){
        if (endDateInput.value < startDateInput.value) endDateInput.value = startDateInput.value;
        refreshHint();
    });
    endDateInput.addEventListener('change', refreshHint);
    startTimeInput.addEventListener('change', refreshHint);
    endTimeInput.addEventListener('change', refreshHint);
    refreshHint();

    let chosenColor = ev.color;
    overlay.querySelectorAll('.cal-color-dot').forEach(dot => {
        dot.addEventListener('click', function(){
            chosenColor = dot.dataset.color;
            overlay.querySelectorAll('.cal-color-dot').forEach(d => d.classList.toggle('active', d === dot));
        });
    });
    nameInput.focus();

    if (isEdit) {
        overlay.querySelector('#ev-delete').addEventListener('click', function(){
            if (confirm('Hapus event ini?')) { deleteEvent(ev.id); closeEventForm(); }
        });
    }
    overlay.querySelector('form').addEventListener('submit', function(e){
        e.preventDefault();
        const name = nameInput.value.trim();
        const startDate = startDateInput.value;
        let endDate = endDateInput.value || startDate;
        if (!name) { nameInput.focus(); return; }
        if (!startDate) { startDateInput.focus(); return; }
        if (endDate < startDate) endDate = startDate;
        const startTime = startTimeInput.value || '';
        let endTime = endTimeInput.value || '';
        // single-day: jika jam selesai < jam mulai, abaikan jam selesai
        if (startDate === endDate && startTime && endTime && endTime < startTime) endTime = '';
        const payload = { id: ev.id, startDate, endDate, startTime, endTime, name, pic: overlay.querySelector('#ev-pic').value.trim(), color: chosenColor };
        if (isEdit) upsertEvent(payload); else addEvent(payload);
        closeEventForm();
    });
}

// ===================================================================
// MUTATIONS
// ===================================================================
function addEvent(data){
    const ev = normalizeEvent({ ...data, id: 'ev_' + Math.random().toString(36).slice(2, 9) });
    if (!ev) return;
    _calEvents.push(ev);
    const d = new Date(ev.startDate + 'T00:00:00');
    if (!isNaN(d)) _calCursor = { y: d.getFullYear(), m: d.getMonth() };
    renderCalendar();
    if (typeof showToast === 'function') showToast('Event ditambahkan. Klik 💾 Simpan agar tersimpan ke database.');
}
function upsertEvent(data){
    const idx = _calEvents.findIndex(e => e.id === data.id);
    const ev = normalizeEvent(data);
    if (!ev) return;
    if (idx >= 0) _calEvents[idx] = ev; else _calEvents.push(ev);
    renderCalendar();
    if (typeof showToast === 'function') showToast('Event diperbarui. Klik 💾 Simpan agar tersimpan.');
}
function deleteEvent(id){
    _calEvents = _calEvents.filter(e => e.id !== id);
    renderCalendar();
    if (typeof showToast === 'function') showToast('Event dihapus. Klik 💾 Simpan agar tersimpan.');
}

// Tutup modal event dengan Escape (selaras dengan modal lain).
document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && document.getElementById('event-form-overlay')) closeEventForm();
});
